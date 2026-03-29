import 'dotenv/config';
import { connectDb } from './db.js';
import { createServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3001);
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/agent-brother';

async function main() {
  await connectDb(MONGODB_URI);
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[server] running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
