import 'dotenv/config';
import { createServer } from './orchestrator/server.js';
import { startAllAgents } from './orchestrator/agent-manager.js';
import { startScheduler } from './scheduler.js';

const PORT = Number(process.env.PORT ?? 3001);

startAllAgents();
startScheduler();

const server = createServer();
server.listen(PORT, () => {
  console.log(`[orchestrator] REST API on http://localhost:${PORT}`);
});
