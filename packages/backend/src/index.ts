import 'dotenv/config';
import net from 'net';
import { createServer } from './orchestrator/server.js';
import { startAllAgents, plannedAgentPorts } from './orchestrator/agent-manager.js';
import { startScheduler } from './scheduler.js';
import { initTelemetry, capture, shutdownTelemetry } from './telemetry.js';

const PORT = Number(process.env.PORT ?? 3001);

function checkPortAvailable(port: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `\n[orchestrator] ${label} port ${port} is already in use.\n` +
          `Another GranClaw instance (or a stale process) is already running.\n` +
          `Run: lsof -i :${port} -P -n  to find the holder.\n` +
          `For agent WS ports, set AGENT_BASE_PORT=<free base> before starting.\n`
        ));
      } else {
        reject(err);
      }
    });
    tester.once('listening', () => { tester.close(); resolve(); });
    tester.listen(port, '127.0.0.1');
  });
}

async function preflight(): Promise<void> {
  // Orchestrator REST/WS port must be free.
  await checkPortAvailable(PORT, 'REST');

  // Every agent's WS port must be free too — otherwise the agent
  // child process would crash on startup with EADDRINUSE and the
  // user would get a half-broken server serving the UI over a dead
  // agent. Better to refuse to start.
  for (const { agentId, port } of plannedAgentPorts()) {
    await checkPortAvailable(port, `agent "${agentId}"`);
  }
}

preflight()
  .then(() => {
    initTelemetry();
    capture('server_started', { port: PORT, nodeVersion: process.version });
    startAllAgents();
    startScheduler();
    const server = createServer();
    server.listen(PORT, () => {
      console.log(`[orchestrator] REST API on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

process.on('SIGTERM', () => { void shutdownTelemetry(); });
process.on('SIGINT',  () => { void shutdownTelemetry(); });
