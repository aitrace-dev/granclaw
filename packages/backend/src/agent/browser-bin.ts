/**
 * agent/browser-bin.ts
 *
 * Resolves which browser CLI binary to run for a given agent turn, plus the
 * launch arguments and env overrides needed. Extracted from runner-pi.ts so
 * the GoLogin binary-swap logic is unit-testable and the runner stays
 * focused on session + loop management.
 *
 * Two paths:
 *   - GoLogin active  → gologin-agent-browser-cli + token/profile via env
 *   - Otherwise       → local agent-browser with stealth + .browser-profile
 *
 * Token is passed via env (GOLOGIN_TOKEN) rather than CLI flag so it doesn't
 * appear in process listings or shell history.
 */

import fs from 'fs';
import path from 'path';
import { getActiveProfile } from '../integrations/gologin/service.js';
import { stealthArgv } from '../browser/stealth.js';

export interface BrowserBinaryResolution {
  /** Executable name or absolute path. */
  bin: string;
  /** Args that go BEFORE the subcommand (agent-browser convention). */
  preCommandArgs: string[];
  /** Args that go AFTER the subcommand and its args (gologin-agent-browser convention). */
  postCommandArgs: string[];
  /** Environment overrides to merge into the child process env. */
  env: Record<string, string>;
  /** True when running under GoLogin. Callers use this to skip WebM recording
   *  (gologin-agent-browser does not support per-session recording yet). */
  isGoLogin: boolean;
  /** Whether local WebM recording should be attempted for this session. */
  recordingSupported: boolean;
}

/**
 * Build argv for the browser subprocess. Handles the per-CLI flag-position
 * difference:
 *   - agent-browser expects: <bin> --session X --profile /path <command> <args>
 *   - gologin-agent-browser expects: <bin> <command> <args> --session X --profile P
 */
export function buildArgv(res: BrowserBinaryResolution, command: string, args: string[]): string[] {
  return [...res.preCommandArgs, command, ...args, ...res.postCommandArgs];
}

export function resolveBrowserBinary(agentId: string, workspaceDir: string): BrowserBinaryResolution {
  const gl = getActiveProfile(workspaceDir, agentId);
  if (gl) {
    return {
      bin: 'gologin-agent-browser',
      preCommandArgs: [],
      postCommandArgs: ['--session', agentId, '--profile', gl.profileId],
      env: {
        GOLOGIN_TOKEN: gl.token,
        GOLOGIN_PROFILE_ID: gl.profileId,
      },
      isGoLogin: true,
      recordingSupported: false,
    };
  }

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
    isGoLogin: false,
    recordingSupported: true,
  };
}
