import { Bot } from '@maxhub/max-bot-api';
import { loadConfig } from '@quiet-chat/config';
import { createDatabase } from '@quiet-chat/database';

import { buildApp } from './app.js';
import { createPersistence } from './persistence.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const persistence = createPersistence(database.db);
const bot = config.MAX_BOT_TOKEN ? new Bot(config.MAX_BOT_TOKEN) : null;
const app = await buildApp({
  config,
  databaseCheck: () => database.check(),
  services: {
    profiles: persistence,
    webhookInbox: persistence,
    membership: {
      async isMember(maxChatId, maxUserId) {
        if (!bot) return false;
        try {
          const response = await bot.api.getChatMembers(maxChatId, { user_ids: [maxUserId] });
          return response.members.some((member: { user_id?: number; id?: number }) => (member.user_id ?? member.id) === maxUserId);
        } catch {
          return false;
        }
      },
    },
  },
});

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
