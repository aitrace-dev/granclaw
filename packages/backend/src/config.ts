import fs from 'fs';
import path from 'path';

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  workspaceDir: string;
  allowedTools: string[];
  bigBrother: { enabled: boolean };
}

interface AppConfig {
  agents: AgentConfig[];
}

const CONFIG_PATH = path.resolve(process.cwd(), '../../agents.config.json');

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
