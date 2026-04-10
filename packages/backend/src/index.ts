import 'dotenv/config';
import net from 'net';
import { createServer } from './orchestrator/server.js';
import { startAllAgents } from './orchestrator/agent-manager.js';
import { startScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT ?? 3001);

function checkPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `\n[orchestrator] Port ${port} is already in use.\n` +
          `Another GranClaw instance (or a stale process) is already running.\n` +
          `Run: lsof -i :${port} -P -n  to find and kill it, then restart.\n`
        ));
      } else {
        reject(err);
      }
    });
    tester.once('listening', () => { tester.close(); resolve(); });
    tester.listen(port, '127.0.0.1');
  });
}

checkPortAvailable(PORT)
  .then(() => {
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
