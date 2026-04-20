/**
 * Unit tests for resolveBrowserBinary — the gateway every agent-browser
 * invocation passes through. This is the *primary* channel between
 * GranClaw and the running Orbita/browser instance, so the resolver
 * contract is load-bearing:
 *
 *   1. Providers (first non-null wins) — e.g. the gologin extension
 *      returns a CDP handoff when Orbita is already running.
 *   2. CDP url file (`/tmp/granclaw-cdp-<agentId>.url`) — fallback
 *      written by the enterprise service so the agent subprocess can
 *      still find the browser even without a registered provider.
 *   3. Default `agent-browser` binary — the open-source path, launches a
 *      fresh browser per session.
 *
 * The enterprise invariant "NO chromium in enterprise — always Orbita"
 * is enforced at two levels:
 *   - The resolver itself never returns a chromium/playwright path.
 *   - The gologin provider only returns a resolution when Orbita is
 *     alive (covered in browser-provider.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveBrowserBinary,
  buildArgv,
  registerBrowserProvider,
  _resetBrowserProvidersForTests,
  type BrowserBinaryResolution,
} from './browser-bin.js';

// ── helpers ─────────────────────────────────────────────────────────────

function cleanCdpFile(agentId: string): void {
  const p = `/tmp/granclaw-cdp-${agentId}.url`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function writeCdpFile(agentId: string, wsUrl: string): void {
  fs.writeFileSync(`/tmp/granclaw-cdp-${agentId}.url`, wsUrl);
}

const makeResolution = (overrides: Partial<BrowserBinaryResolution> = {}): BrowserBinaryResolution => ({
  bin: 'fake-browser',
  preCommandArgs: [],
  postCommandArgs: [],
  env: {},
  isRemote: false,
  recordingSupported: true,
  ...overrides,
});

// ── resolveBrowserBinary ────────────────────────────────────────────────

describe('resolveBrowserBinary', () => {
  let ws: string;
  let agentId: string;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-bb-'));
    agentId = `agent-${Math.random().toString(36).slice(2, 10)}`;
    _resetBrowserProvidersForTests();
    delete process.env.AGENT_BROWSER_BIN;
  });

  afterEach(() => {
    cleanCdpFile(agentId);
    _resetBrowserProvidersForTests();
    delete process.env.AGENT_BROWSER_BIN;
  });

  describe('tier 1 — providers', () => {
    it('uses the first provider that returns non-null', async () => {
      const fake = makeResolution({
        bin: 'orbita-via-provider',
        preCommandArgs: ['--cdp', '43221', '--session', agentId],
        isRemote: false,
      });
      registerBrowserProvider(() => fake);
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('orbita-via-provider');
      expect(r.preCommandArgs).toEqual(['--cdp', '43221', '--session', agentId]);
    });

    it('provider order matters — first non-null wins', async () => {
      registerBrowserProvider(() => makeResolution({ bin: 'first' }));
      registerBrowserProvider(() => makeResolution({ bin: 'second' }));
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('first');
    });

    it('falls through providers that return null to the next one', async () => {
      registerBrowserProvider(() => null);
      registerBrowserProvider(() => null);
      registerBrowserProvider(() => makeResolution({ bin: 'third-wins' }));
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('third-wins');
    });

    it('awaits async providers (Promise<resolution>)', async () => {
      registerBrowserProvider(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return makeResolution({ bin: 'async-orbita' });
      });
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('async-orbita');
    });

    it('awaits async providers that resolve null and falls through', async () => {
      registerBrowserProvider(async () => null);
      registerBrowserProvider(() => makeResolution({ bin: 'after-async-null' }));
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('after-async-null');
    });

    it('passes agentId and workspaceDir to the provider', async () => {
      const seen: Array<{ a: string; w: string }> = [];
      registerBrowserProvider((a, w) => {
        seen.push({ a, w });
        return null;
      });
      await resolveBrowserBinary(agentId, ws);
      expect(seen).toEqual([{ a: agentId, w: ws }]);
    });

    it('AGENT_BROWSER_BIN env does NOT override when a provider matches', async () => {
      registerBrowserProvider(() => makeResolution({ bin: 'provider-wins' }));
      process.env.AGENT_BROWSER_BIN = '/custom/agent-browser';
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('provider-wins');
    });
  });

  describe('tier 2 — CDP url file handoff', () => {
    it('reads /tmp/granclaw-cdp-<agentId>.url and returns --cdp <port> --session <agentId>', async () => {
      writeCdpFile(agentId, 'ws://127.0.0.1:45678/devtools/browser/abc');
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('agent-browser');
      expect(r.preCommandArgs).toEqual(['--cdp', '45678', '--session', agentId]);
      expect(r.postCommandArgs).toEqual([]);
      expect(r.isRemote).toBe(false);
      expect(r.recordingSupported).toBe(true);
    });

    it('trims whitespace/newlines from the CDP file', async () => {
      writeCdpFile(agentId, '  ws://127.0.0.1:51234/devtools/browser/xx  \n');
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.preCommandArgs).toContain('51234');
    });

    it('honours AGENT_BROWSER_BIN on the CDP-file path', async () => {
      writeCdpFile(agentId, 'ws://127.0.0.1:45678/');
      process.env.AGENT_BROWSER_BIN = '/opt/agent-browser';
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('/opt/agent-browser');
    });

    it('falls back to default when CDP file is malformed (unparseable url)', async () => {
      writeCdpFile(agentId, 'not-a-valid-url');
      const r = await resolveBrowserBinary(agentId, ws);
      // Should land in tier 3 — --session but NOT --cdp
      expect(r.preCommandArgs).toContain('--session');
      expect(r.preCommandArgs).toContain(agentId);
      expect(r.preCommandArgs).not.toContain('--cdp');
    });

    it('falls back to default when CDP file has no port', async () => {
      writeCdpFile(agentId, 'ws://127.0.0.1/devtools');
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.preCommandArgs).not.toContain('--cdp');
      expect(r.preCommandArgs).toContain('--session');
    });

    it('provider wins over CDP file even when both are present', async () => {
      writeCdpFile(agentId, 'ws://127.0.0.1:45678/');
      registerBrowserProvider(() => makeResolution({
        bin: 'provider-orbita',
        preCommandArgs: ['--cdp', '99999', '--session', agentId],
      }));
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('provider-orbita');
      expect(r.preCommandArgs).toContain('99999');
    });
  });

  describe('tier 3 — default agent-browser', () => {
    it('returns agent-browser with --session <agentId>', async () => {
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('agent-browser');
      expect(r.preCommandArgs).toContain('--session');
      expect(r.preCommandArgs).toContain(agentId);
      expect(r.postCommandArgs).toEqual([]);
      expect(r.isRemote).toBe(false);
      expect(r.recordingSupported).toBe(true);
    });

    it('adds --profile <workspace>/.browser-profile when the dir exists', async () => {
      const profileDir = path.join(ws, '.browser-profile');
      fs.mkdirSync(profileDir);
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.preCommandArgs).toContain('--profile');
      expect(r.preCommandArgs).toContain(profileDir);
      // --profile must appear after --session (per CLI contract)
      expect(r.preCommandArgs.indexOf('--profile')).toBeGreaterThan(
        r.preCommandArgs.indexOf('--session'),
      );
    });

    it('omits --profile when the .browser-profile dir is missing', async () => {
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.preCommandArgs).not.toContain('--profile');
    });

    it('respects AGENT_BROWSER_BIN env override', async () => {
      process.env.AGENT_BROWSER_BIN = '/custom/path/agent-browser';
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('/custom/path/agent-browser');
    });

    it('appends stealth argv into preCommandArgs', async () => {
      const r = await resolveBrowserBinary(agentId, ws);
      // Session marker comes first — any stealth args follow.
      // Under GRANCLAW_STEALTH_DISABLED the tail is empty; that's fine, we
      // just assert --session is still present.
      expect(r.preCommandArgs[0]).toBe('--session');
      expect(r.preCommandArgs[1]).toBe(agentId);
    });
  });

  describe('enterprise invariant — NEVER return a chromium/playwright path', () => {
    // The enterprise deployment MUST talk to Orbita via agent-browser. The
    // resolver's default path is `agent-browser` (or AGENT_BROWSER_BIN), and
    // there is NO code branch that returns a bundled Playwright Chromium
    // path, a system chrome binary, or similar. These tests codify that.
    it('default bin is literally "agent-browser"', async () => {
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('agent-browser');
    });

    it('default bin does not contain "chromium", "chrome", or "playwright"', async () => {
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin.toLowerCase()).not.toContain('chromium');
      expect(r.bin.toLowerCase()).not.toContain('chrome');
      expect(r.bin.toLowerCase()).not.toContain('playwright');
    });

    it('CDP-file path also uses agent-browser (the tool), not chromium directly', async () => {
      writeCdpFile(agentId, 'ws://127.0.0.1:45678/');
      const r = await resolveBrowserBinary(agentId, ws);
      expect(r.bin).toBe('agent-browser');
      expect(r.bin.toLowerCase()).not.toContain('chromium');
      // --cdp <port> confirms we're re-attaching via agent-browser, not
      // launching a fresh chromium.
      expect(r.preCommandArgs).toContain('--cdp');
    });

    it('every returned preCommandArgs entry is a string (not a resolved path object)', async () => {
      const r = await resolveBrowserBinary(agentId, ws);
      for (const a of r.preCommandArgs) expect(typeof a).toBe('string');
    });
  });
});

// ── buildArgv ───────────────────────────────────────────────────────────

describe('buildArgv', () => {
  it('local tool: flags before the subcommand (agent-browser CLI contract)', () => {
    const argv = buildArgv(
      {
        bin: 'agent-browser', env: {}, isRemote: false, recordingSupported: true,
        preCommandArgs: ['--session', 'a1'],
        postCommandArgs: [],
      },
      'open',
      ['https://example.com'],
    );
    expect(argv).toEqual(['--session', 'a1', 'open', 'https://example.com']);
  });

  it('remote: flags after the subcommand (remote CLI contract)', () => {
    const argv = buildArgv(
      {
        bin: 'remote-browser-cli', env: {}, isRemote: true, recordingSupported: false,
        preCommandArgs: [],
        postCommandArgs: ['--session', 'a1', '--profile', 'prof_x'],
      },
      'open',
      ['https://example.com'],
    );
    expect(argv).toEqual(['open', 'https://example.com', '--session', 'a1', '--profile', 'prof_x']);
  });

  it('interleaves pre- and post-command args correctly when both present', () => {
    const argv = buildArgv(
      {
        bin: 'x', env: {}, isRemote: false, recordingSupported: false,
        preCommandArgs: ['--pre1', '--pre2'],
        postCommandArgs: ['--post1'],
      },
      'cmd',
      ['arg1', 'arg2'],
    );
    expect(argv).toEqual(['--pre1', '--pre2', 'cmd', 'arg1', 'arg2', '--post1']);
  });

  it('handles empty arg arrays cleanly', () => {
    const argv = buildArgv(
      {
        bin: 'x', env: {}, isRemote: false, recordingSupported: false,
        preCommandArgs: [],
        postCommandArgs: [],
      },
      'status',
      [],
    );
    expect(argv).toEqual(['status']);
  });

  it('preserves ordering with multiple positional args', () => {
    const argv = buildArgv(
      {
        bin: 'x', env: {}, isRemote: false, recordingSupported: false,
        preCommandArgs: ['--cdp', '45678'],
        postCommandArgs: [],
      },
      'click',
      ['#btn', '--timeout', '5000'],
    );
    expect(argv).toEqual(['--cdp', '45678', 'click', '#btn', '--timeout', '5000']);
  });
});
