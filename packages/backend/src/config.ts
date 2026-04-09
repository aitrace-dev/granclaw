import fs from 'fs';
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

const CONFIG_PATH = process.env.CONFIG_PATH
  ? path.resolve(process.env.CONFIG_PATH)
  : path.resolve(process.cwd(), '../../agents.config.json');

export const REPO_ROOT = path.dirname(CONFIG_PATH);

function load(): AppConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

export function getAgents(): AgentConfig[] {
  return load().agents;
}

export function getAgent(id: string): AgentConfig | undefined {
  return getAgents().find((a) => a.id === id);
}

export function saveAgents(agents: AgentConfig[]): void {
  const configPath = process.env.CONFIG_PATH
    ? path.resolve(process.env.CONFIG_PATH)
    : path.resolve(process.cwd(), '../../agents.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ agents }, null, 2) + '\n');
}
