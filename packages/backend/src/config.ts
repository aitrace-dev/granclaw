import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  workspaceDir: string;
  allowedTools: string[];
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
 * The CLI entrypoint honors a --home flag by setting GRANCLAW_HOME before
 * importing this module, so we only need to read the env var here.
 */
export function resolveGranclawHome(): string {
  if (process.env.GRANCLAW_HOME) {
    return path.resolve(process.env.GRANCLAW_HOME);
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
