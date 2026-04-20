/**
 * browser-bluggie.failing.test.ts
 *
 * Failing-test dossier for the bluggie enterprise incident (2026-04-20).
 * Each test codifies the EXPECTED behaviour. They all fail against today's
 * code — the failure message explains the observed symptom on bluggie.
 *
 * Symptoms the user saw:
 *   1. /agents/bluggie/view/browser livestream shows nothing.
 *   2. Orbita is alive even though the user never opened chat or
 *      Social Logins.
 *   3. /agents/bluggie/browser-sessions returns status:"active" for a
 *      session whose meta.json on disk says status:"crashed".
 *   4. recording.webm has an mtime that predates the session createdAt
 *      (orphan from a previous container lifecycle).
 *   5. session-manager logs "record start succeeded but recording.webm did
 *      not materialize within 1500ms — is ffmpeg installed on the host?"
 *      even though ffmpeg IS installed (slow cold start, 1500ms too tight).
 *   6. sync-server-image container recreate kills the backend without
 *      flipping in-flight browser sessions to 'crashed'.
 *
 * DO NOT fix anything until the user authorizes.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── Shared helpers ─────────────────────────────────────────────────────────

function fakeMeta(dir: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const meta = {
    id: path.basename(dir),
    name: null,
    status: 'active',
    createdAt: now,
    closedAt: null,
    heartbeat: now,
    video: 'recording.webm',
    commands: [],
    ...overrides,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

function writeValidWebm(dir: string, mtime?: Date) {
  const filePath = path.join(dir, 'recording.webm');
  fs.writeFileSync(filePath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]));
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

// ── Issue 4 + Issue 3 — browser-sessions.ts: orphan mtime & liveness drift ──

describe('browser-sessions — bluggie data-model drift', () => {
  let tmp: string;
  let sessionsDir: string;
  let origHome: string | undefined;
  let mod: typeof import('./browser-sessions.js');

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bluggie-test-'));
    origHome = process.env.GRANCLAW_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-home-bluggie-'));
    process.env.GRANCLAW_HOME = home;
    fs.writeFileSync(path.join(home, 'agents.config.json'), JSON.stringify({
      agents: [{ id: 'bluggie', name: 'bluggie', model: 'claude-sonnet-4-5', workspaceDir: tmp, bigBrother: { enabled: false } }],
    }));
    mod = await import('./browser-sessions.js');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (origHome) process.env.GRANCLAW_HOME = origHome;
    else delete process.env.GRANCLAW_HOME;
  });

  beforeEach(() => {
    sessionsDir = path.join(tmp, '.browser-sessions');
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    fs.mkdirSync(sessionsDir);
  });

  // ── Issue 4: orphan recording.webm ─────────────────────────────────────
  it('FAILING: videoValid is false when recording.webm mtime predates session.createdAt (orphan from prior container lifecycle)', () => {
    const createdAt = Date.now();
    const dir = path.join(sessionsDir, 'sess-orphan-video');
    fakeMeta(dir, { status: 'closed', createdAt, closedAt: createdAt + 30_000 });
    // Orphan recording.webm left over from a previous container instance
    // (the named volume `granclaw-data-inst_<id>` survives recreate):
    writeValidWebm(dir, new Date(createdAt - 60 * 60 * 1000)); // 1h BEFORE this session was created

    const sessions = mod.listSessions('bluggie');
    expect(sessions).toHaveLength(1);

    // EXPECTED: backend must detect that the file was written before this
    // session even began and mark it invalid. Currently isWebmValid only
    // checks the EBML magic bytes, so this returns videoValid=true and the
    // replay view shows the PREVIOUS session's video under this session's
    // URL — a silent correctness bug we observed on bluggie.
    expect(sessions[0].videoValid, 'orphan recording from an older container should NOT count as videoValid').toBe(false);
  });

  // ── Issue 3: liveness drift — API "active" vs meta.json on disk ───────
  it('FAILING: reconcile flips status to crashed when Orbita is demonstrably dead, without waiting the full 15-min heartbeat timeout', () => {
    // The watchdog in enterprise/extensions/gologin/src/service.ts knows
    // whether the browser is alive (HTTP probe to /json/version). If it is
    // dead, meta.json should be reconciled immediately, not 15 min later.
    //
    // Observed on bluggie: API returned status:"active" for an 8-min-old
    // session whose underlying Orbita was killed by a sync-server-image
    // container recreate. The UI advertised "active" browser sessions that
    // the user could not actually stream or close.
    const dir = path.join(sessionsDir, 'sess-dead-but-fresh');
    fakeMeta(dir, {
      status: 'active',
      heartbeat: Date.now() - 60_000,   // 1 min ago — far under the 15-min threshold
      createdAt: Date.now() - 90_000,
    });

    // Caller asserts liveness is false (browser is dead). There is
    // currently no hook for the liveness signal — listSessions reads
    // meta.json verbatim and reconciles only on heartbeat age. When the
    // backend gains a liveness probe, the signature will be something like
    // `listSessions(agentId, { probeAlive })`. This test expects that
    // extension point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listWithProbe = (mod as any).listSessions as (a: string, opts?: { probeAlive?: (sid: string) => boolean }) => Array<{ status: string }>;
    const sessions = listWithProbe('bluggie', { probeAlive: () => false });
    expect(sessions[0].status, 'a session whose underlying browser is known-dead should flip to crashed, not advertise "active"').toBe('crashed');
  });

  // ── Issue 6: finalize-on-shutdown ───────────────────────────────────────
  it('FAILING: backend exposes finalizeAllActiveSessions(agentId) so container recreate can flip every active session to crashed at boot', async () => {
    // sync-server-image step 3 does `docker compose up --pull always` (or
    // `docker rm -f`) without an intermediate graceful shutdown. The
    // backend dies with no chance to write. On the next container start,
    // every previously-active session is left in meta.json status:"active"
    // with a stale heartbeat.
    //
    // A boot-time finalizer (run on startup before /browser-sessions
    // routes are mounted) would flip every active session to 'crashed' —
    // this makes the API consistent with reality from the first request.
    const dir = path.join(sessionsDir, 'sess-leftover-after-recreate');
    fakeMeta(dir, { status: 'active', heartbeat: Date.now() - 30_000 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalizer = (mod as any).finalizeAllActiveSessions as ((agentId: string) => number) | undefined;
    expect(finalizer, 'backend must export a finalizeAllActiveSessions() to run at boot after sync-server-image recreate').toBeTypeOf('function');

    const flipped = finalizer!('bluggie');
    expect(flipped).toBe(1);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
    expect(onDisk.status).toBe('crashed');
    expect(onDisk.closedAt).toBeGreaterThan(0);
  });
});

// ── Issue 5 — 1500ms ffmpeg materialization race ──────────────────────────

type ExecFileHandler = (bin: string, args: string[], opts: unknown) => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string };
let execFileHandler: ExecFileHandler;

vi.mock('child_process', () => ({
  execFile: (bin: string, args: string[], opts: unknown, cb: (err: Error | null, r?: { stdout: string; stderr: string }) => void) => {
    Promise.resolve()
      .then(() => execFileHandler(bin, args, opts))
      .then((r) => cb(null, r))
      .catch((err) => cb(err as Error));
  },
}));

describe('session-manager — ffmpeg cold-start materialization race (bluggie 1500ms bug)', () => {
  let sm: typeof import('./browser/session-manager.js');
  let tmp: string;

  beforeAll(async () => {
    sm = await import('./browser/session-manager.js');
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bluggie-sm-'));
    delete process.env.AGENT_BROWSER_BIN;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('FAILING: startRecording waits long enough for ffmpeg on a slow host (file materializes at ~2.5s)', async () => {
    // Observed on bluggie: session-manager.ts:230 logs "record start
    // succeeded but recording.webm did not materialize within 1500ms —
    // is ffmpeg installed on the host?" even though ffmpeg IS installed.
    // ffmpeg cold-starts under Docker can take 2-3 seconds when the host
    // is under load (which is exactly what /sync-server-image creates).
    //
    // EXPECTED: the poll window is at least 4-5 seconds, OR the log
    // message does not misattribute the delay to "ffmpeg missing".
    execFileHandler = (_bin, args) => {
      if (args.includes('start')) {
        const outPath = args[args.length - 1];
        // ffmpeg writes the EBML header 2500ms after launch (slow cold start).
        setTimeout(() => {
          try { fs.writeFileSync(outPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00])); } catch {}
        }, 2500);
        return { stdout: '✓ Recording started\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const handle = sm.createSession('bluggie', tmp);
    const ok = await sm.startRecording(handle);
    expect(ok, 'slow ffmpeg cold start must not be misclassified as "ffmpeg missing"').toBe(true);
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.video).toBe('recording.webm');
  }, 10_000);
});

// ── Chat messages — turn-internal structure lost (bluggie /agents/bluggie/chat) ──

describe('agent/process — assistant-message turn structure (bluggie chat-looks-wrong)', () => {
  it('FAILING: multiple text blocks separated by tool_calls must include a separator in the persisted assistant message', async () => {
    // Observed on bluggie: the assistant message stored for the Reddit
    // takeover turn reads:
    //   "Still getting the network security block. Let me try logging
    //    in explicitly first.I can see the Reddit login form now. I need
    //    your credentials to log in. I'm handing this over to you.I can
    //    see the Reddit login form with email/username..."
    //
    // The ".I" collisions are two separate content blocks fused without
    // whitespace because agent/process.ts:210 just does
    //     fullResponse += chunk.text
    // for every text chunk, ignoring the fact that tool_calls fired
    // BETWEEN text blocks. The UI renders one run-on paragraph.
    //
    // EXPECTED: a helper that assembles assistant text with explicit
    // block separators (e.g. "\n\n" between text blocks that bracket a
    // tool_call) — so chat renders the turn as the user perceived it.
    //
    // Checked via a file probe, not a dynamic import: agent/process.ts
    // self-executes on load (reads AGENT_ID/AGENT_PORT, calls
    // process.exit if missing), so it's not safe to require into a
    // vitest worker. The fix will extract the helper to its own module.
    const helperPath = path.resolve(__dirname, 'agent', 'message-assembly.ts');
    expect(
      fs.existsSync(helperPath),
      'agent/message-assembly.ts must exist and export assembleAssistantMessage(chunks) — today, agent/process.ts:210 does fullResponse += chunk.text with no block separator, fusing "first." and "I can see" from the observed bluggie turn',
    ).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('./agent/message-assembly.js')) as any;
    const chunks = [
      { type: 'text', text: 'Still getting the network security block. Let me try logging in explicitly first.' },
      { type: 'tool_call', tool: 'browser', input: { command: 'open', args: ['https://reddit.com/login'] } },
      { type: 'text', text: 'I can see the Reddit login form now. I need your credentials to log in.' },
    ];
    const persisted = mod.assembleAssistantMessage(chunks);
    expect(persisted).not.toContain('first.I can see');
    expect(persisted).toMatch(/first\.\s+I can see/);
  });
});

// ── Issue 1 — livestream empty (WS relay fails silently) ──────────────────

describe('browser-live relay — empty-livestream diagnosis (bluggie /view/browser)', () => {
  it('FAILING: WS relay sends a typed error frame when CDP URL cannot be resolved, instead of hanging silent', async () => {
    // The user observed /agents/bluggie/view/browser showing an empty
    // livestream. The WebSocket upgrades, but nothing ever arrives — no
    // frame, no error, no placeholder. The frontend has no hint to show
    // "browser not available" or "no active tab".
    //
    // EXPECTED: browser-live exports (or exposes via module API) a
    // helper that returns a structured "unavailable" message when the
    // CDP URL is missing. Currently this responsibility is not factored
    // out and the relay is a silent black-hole.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('./orchestrator/browser-live.js')) as any;
    expect(
      typeof mod.buildUnavailableFrame,
      'browser-live.ts must export a `buildUnavailableFrame({reason})` helper so the relay and the frontend can agree on a typed fallback message — currently the relay is silent when CDP is unreachable',
    ).toBe('function');

    const frame = mod.buildUnavailableFrame({ reason: 'cdp_url_missing' });
    expect(frame).toEqual(expect.objectContaining({
      type: 'unavailable',
      reason: 'cdp_url_missing',
    }));
  });
});
