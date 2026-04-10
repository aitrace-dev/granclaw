/**
 * orchestrator/agent-manager.ts
 *
 * Spawns and tracks one agent child process per agent in agents.config.json.
 *
 * Port allocation:
 *   Agent WS — BASE_AGENT_PORT + index (3100, 3101, …)
 *
 * Environment passed to each agent process:
 *   AGENT_ID, AGENT_PORT, CONFIG_PATH
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { getAgents, getAgent, AgentConfig, REPO_ROOT } from '../config.js';
import { getSecrets } from '../secrets-vault.js';

const BASE_AGENT_PORT = Number(process.env.AGENT_BASE_PORT ?? 3100);

export interface ManagedAgent {
  config: AgentConfig;
  wsPort: number;
  bbPort: null;   // Guardian (Big Brother) is not yet implemented — always null
  pid?: number;
}

const registry = new Map<string, ManagedAgent>();

/**
 * Start all agents from agents.config.json.
 */
export function startAllAgents(): void {
  const agents = getAgents();

  agents.forEach((agent, index) => {
    const wsPort = BASE_AGENT_PORT + index;
    const child = spawnAgent(agent, wsPort);
    registry.set(agent.id, { config: agent, wsPort, bbPort: null, pid: child.pid });
    console.log(`[orchestrator] agent "${agent.id}" started on ws port ${wsPort} (pid ${child.pid})`);
  });
}

export function getManagedAgents(): ManagedAgent[] {
  return Array.from(registry.values());
}

export function getManagedAgent(agentId: string): ManagedAgent | undefined {
  return registry.get(agentId);
}

/**
 * Restart an agent to pick up new secrets or config.
 */
export function restartAgent(agentId: string): void {
  const managed = registry.get(agentId);
  if (!managed) return;

  if (managed.pid) try { process.kill(managed.pid); } catch { /* already dead */ }

  const agent = getAgent(agentId) ?? managed.config;
  const child = spawnAgent(agent, managed.wsPort);
  registry.set(agentId, { config: agent, wsPort: managed.wsPort, bbPort: null, pid: child.pid });
  console.log(`[orchestrator] agent "${agentId}" restarted (pid ${child.pid})`);
}

/**
 * Start a new agent. Assigns the next available port.
 */
export function startNewAgent(agent: AgentConfig): ManagedAgent {
  const usedWsPorts = new Set(Array.from(registry.values()).map(m => m.wsPort));
  let wsPort = BASE_AGENT_PORT;
  while (usedWsPorts.has(wsPort)) wsPort++;

  const child = spawnAgent(agent, wsPort);
  const managed: ManagedAgent = { config: agent, wsPort, bbPort: null, pid: child.pid };
  registry.set(agent.id, managed);
  console.log(`[orchestrator] agent "${agent.id}" started on ws port ${wsPort} (pid ${child.pid})`);
  return managed;
}

/**
 * Stop and remove an agent from the registry.
 */
export function stopAndRemoveAgent(agentId: string): boolean {
  const managed = registry.get(agentId);
  if (!managed) return false;

  if (managed.pid) try { process.kill(managed.pid); } catch { /* already dead */ }

  registry.delete(agentId);
  console.log(`[orchestrator] agent "${agentId}" stopped and removed`);
  return true;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function spawnAgent(agent: AgentConfig, wsPort: number): ChildProcess {
  const isTs = __filename.endsWith('.ts');
  const ext = isTs ? '.ts' : '.js';
  const agentScript = path.resolve(__dirname, `../agent/process${ext}`);

  const secrets = getSecrets(agent.id);
  const secretKeys = Object.keys(secrets);
  if (secretKeys.length > 0) {
    console.log(`[orchestrator] injecting ${secretKeys.length} secrets into agent "${agent.id}": ${secretKeys.join(', ')}`);
  }
  const orchestratorPort = process.env.PORT ?? '3001';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...secrets,
    AGENT_ID: agent.id,
    AGENT_PORT: String(wsPort),
    CONFIG_PATH: path.resolve(REPO_ROOT, 'agents.config.json'),
    GRANCLAW_API_URL: `http://localhost:${orchestratorPort}`,
  };

  let child: ChildProcess;
  if (isTs) {
    const tsxBin = path.resolve(__dirname, '../../../../node_modules/.bin/tsx');
    child = spawn(tsxBin, [agentScript], { env, stdio: 'inherit' });
  } else {
    child = spawn(process.execPath, [agentScript], { env, stdio: 'inherit' });
  }

  child.on('exit', (code) => {
    console.warn(`[orchestrator] agent "${agent.id}" exited with code ${code}`);
  });

  return child;
}
