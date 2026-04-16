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

/** Test-only: clear all registered providers. */
export function _resetBrowserProvidersForTests(): void {
  providers.length = 0;
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

export async function resolveBrowserBinary(agentId: string, workspaceDir: string): Promise<BrowserBinaryResolution> {
  // Try registered providers first (supplied by extensions).
  for (const provider of providers) {
    const resolution = await provider(agentId, workspaceDir);
    if (resolution) return resolution;
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
