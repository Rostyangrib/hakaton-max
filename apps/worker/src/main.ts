import { loadConfig } from '@quiet-chat/config';
import { createDatabase } from '@quiet-chat/database';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
let stopping = false;

async function poll(): Promise<void> {
  try {
    await database.check();
    console.info(JSON.stringify({ level: 'info', service: 'worker', message: 'poll completed' }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'worker', message: 'poll failed', error }));
  }
}

const timer = setInterval(() => void poll(), config.WORKER_POLL_INTERVAL_MS);
timer.unref();
await poll();

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.info(JSON.stringify({ level: 'info', service: 'worker', message: 'shutting down', signal }));
  await database.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await new Promise<void>(() => {});
