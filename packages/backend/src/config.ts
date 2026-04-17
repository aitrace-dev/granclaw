import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  /** Which provider's API key to use (e.g. "google", "openrouter"). Falls back to first configured. */
  provider?: string;
  workspaceDir: string;
  /** @deprecated Guardian not yet implemented — kept for legacy configs */
  bigBrother?: { enabled: boolean };
}

interface AppConfig {
  agents: AgentConfig[];
}

/**
 * Resolve the GranClaw home directory.
 *
 * Priority (highest first):
 *   1. GRANCLAW_HOME env var
 *   2. ~/.granclaw
 *
 * Note: the exported GRANCLAW_HOME const is a snapshot of this function's
 * return value at module load time. Calling resolveGranclawHome() directly
 * AFTER startup may return a different value if process.env.GRANCLAW_HOME
 * has changed since load — prefer importing GRANCLAW_HOME for stable reads.
 *
 * The CLI entrypoint honors a --home flag by setting GRANCLAW_HOME before
 * importing this module, so normal callers only need the const.
 */
export function resolveGranclawHome(): string {
  const envHome = process.env.GRANCLAW_HOME?.trim();
  if (envHome) {
    return path.resolve(envHome);
  }
  return path.join(os.homedir(), '.granclaw');
}

/** The resolved GranClaw home directory (runtime state, agents.config.json, data/, workspaces/). */
export const GRANCLAW_HOME = resolveGranclawHome();

/** @deprecated Legacy alias. New code should use GRANCLAW_HOME. Kept so existing consumers do not need edits. */
export const REPO_ROOT = GRANCLAW_HOME;

function configPath(): string {
  if (process.env.CONFIG_PATH) return path.resolve(process.env.CONFIG_PATH);
  return path.join(GRANCLAW_HOME, 'agents.config.json');
}

function load(): AppConfig {
  const raw = fs.readFileSync(configPath(), 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

export function getAgents(): AgentConfig[] {
  return load().agents;
}

export function getAgent(id: string): AgentConfig | undefined {
  return getAgents().find((a) => a.id === id);
}

export function saveAgents(agents: AgentConfig[]): void {
  fs.writeFileSync(configPath(), JSON.stringify({ agents }, null, 2) + '\n');
}
