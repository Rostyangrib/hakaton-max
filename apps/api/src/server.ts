import { loadConfig } from '@quiet-chat/config';
import { createDatabase } from '@quiet-chat/database';

import { buildApp } from './app.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, databaseCheck: () => database.check() });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await database.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await database.close();
  process.exit(1);
}
