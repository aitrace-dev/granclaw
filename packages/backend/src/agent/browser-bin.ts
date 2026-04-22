/**
 * agent/browser-bin.ts
 *
 * Resolves which browser CLI binary to run for a given agent turn, plus the
 * launch arguments and env overrides needed. Extracted from runner-pi.ts so
 * the binary-swap logic is unit-testable and extensible.
 *
 * Extension hook: external modules register browser providers via
 * registerBrowserProvider(). Providers are tried in registration order —
 * the first one that returns a non-null resolution wins. If none match,
 * the local agent-browser path is used.
 *
 * Flag-position note: the local daemon expects launch flags BEFORE the
 * subcommand; remote CLIs may expect them AFTER. The resolution carries
 * preCommandArgs + postCommandArgs so buildArgv() can assemble in the
 * right order.
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { stealthArgv } from '../browser/stealth.js';

export interface BrowserBinaryResolution {
  /** Executable name or absolute path. */
  bin: string;
  /** Args that go BEFORE the subcommand (agent-browser convention). */
  preCommandArgs: string[];
  /** Args that go AFTER the subcommand and its args (remote-CLI convention). */
  postCommandArgs: string[];
  /** Environment overrides to merge into the child process env. */
  env: Record<string, string>;
  /** True when running under a remote/cloud browser. Callers use this to
   *  skip local WebM recording (remote browsers don't support it). */
  isRemote: boolean;
  /** Whether local WebM recording should be attempted for this session. */
  recordingSupported: boolean;
  /** CDP port when running against an existing browser (enterprise/Orbita).
   *  Used by the browser tool to navigate the existing tab directly instead
   *  of letting agent-browser create a new one. */
  cdpPort?: string;
}

/**
 * Extension hook. A provider returns a resolution for an agent, or null to
 * pass (let the next provider or the default try). First non-null wins.
 */
export type BrowserProvider = (agentId: string, workspaceDir: string) => BrowserBinaryResolution | null | Promise<BrowserBinaryResolution | null>;

const providers: BrowserProvider[] = [];

export function registerBrowserProvider(provider: BrowserProvider): void {
  providers.push(provider);
}

/**
 * Extension hook for browser teardown. Extensions register a callback that
 * kills their managed browser process (e.g. Orbita). Called by killBrowser().
 */
export type BrowserKiller = (agentId: string) => void | Promise<void>;
const killers: BrowserKiller[] = [];

export function registerBrowserKiller(killer: BrowserKiller): void {
  killers.push(killer);
}

/**
 * Kill the browser for an agent — calls extension killers (Orbita), removes
 * the CDP bridge file, and shuts down agent-browser's daemon. The next
 * browser tool call will spawn a fresh instance.
 */
export async function killBrowser(agentId: string): Promise<void> {
  for (const killer of killers) {
    try { await killer(agentId); } catch {}
  }
  try { fs.unlinkSync(`/tmp/granclaw-cdp-${agentId}.url`); } catch {}
  try {
    const { execFileSync } = await import('child_process');
    const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
    execFileSync(bin, ['--session', agentId, 'close'], { timeout: 5000, stdio: 'pipe' });
  } catch {}
}

/** Test-only: clear all registered providers. */
export function _resetBrowserProvidersForTests(): void {
  providers.length = 0;
  killers.length = 0;
}

/**
 * Build argv for the browser subprocess. Handles the per-CLI flag-position
 * difference:
 *   - local daemon: <bin> --session X --profile /path <command> <args>
 *   - remote CLI:   <bin> <command> <args> --session X --profile P
 */
export function buildArgv(res: BrowserBinaryResolution, command: string, args: string[]): string[] {
  return [...res.preCommandArgs, command, ...args, ...res.postCommandArgs];
}

/**
 * Navigate the first existing page tab via CDP Page.navigate — same approach
 * Social Logins verify uses. Prevents agent-browser from creating a new tab
 * for every `open`, which causes tab accumulation and may trigger anti-bot
 * heuristics on sites that fingerprint rapid new-tab creation.
 */
export function cdpNavigate(port: string, url: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cdpNavigate: timeout')), 15_000);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const page = targets.find(t => t.type === 'page');
      if (!page) { clearTimeout(timer); reject(new Error('cdpNavigate: no page target')); return; }

      const ws = new WebSocket(page.webSocketDebuggerUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
      });
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(`cdpNavigate: ${msg.error.message}`));
          else resolve(url);
        }
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

export async function resolveBrowserBinary(agentId: string, workspaceDir: string): Promise<BrowserBinaryResolution> {
  // Try registered providers first (supplied by extensions).
  for (const provider of providers) {
    const resolution = await provider(agentId, workspaceDir);
    if (resolution) return resolution;
  }

  // Extension-bridge: per-agent CDP URL file written by an orchestrator-side
  // extension. Lets agent subprocesses (which don't load extensions) still
  // connect to a provider-managed browser — read the file, extract the port,
  // connect via --cdp. Enterprise (GoLogin) uses this to route agent browsing
  // through Orbita started in the orchestrator process.
  const cdpFile = `/tmp/granclaw-cdp-${agentId}.url`;
  if (fs.existsSync(cdpFile)) {
    try {
      const wsUrl = fs.readFileSync(cdpFile, 'utf8').trim();
      const port = new URL(wsUrl.replace('ws://', 'http://')).port;
      if (port) {
        return {
          bin: process.env.AGENT_BROWSER_BIN ?? 'agent-browser',
          preCommandArgs: ['--cdp', port, '--session', agentId],
          postCommandArgs: [],
          env: {},
          isRemote: false,
          recordingSupported: true,
          cdpPort: port,
        };
      }
    } catch {}
  }

  // Default: local agent-browser with stealth + workspace profile dir.
  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  const profileDir = path.join(workspaceDir, '.browser-profile');
  const preCommandArgs: string[] = ['--session', agentId];
  if (fs.existsSync(profileDir)) {
    preCommandArgs.push('--profile', profileDir);
  }
  preCommandArgs.push(...stealthArgv());

  return {
    bin,
    preCommandArgs,
    postCommandArgs: [],
    env: {},
    isRemote: false,
    recordingSupported: true,
  };
}
