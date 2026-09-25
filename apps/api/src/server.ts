import { Bot } from '@maxhub/max-bot-api';
import { loadConfig } from '@quiet-chat/config';
import { createDatabase } from '@quiet-chat/database';

import { buildApp } from './app.js';
import type { MembershipService } from './contracts.js';
import { createPersistence } from './persistence.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const persistence = createPersistence(database.db);
const bot = config.MAX_BOT_TOKEN ? new Bot(config.MAX_BOT_TOKEN) : null;
class CachedMembership implements MembershipService {
  private readonly cache = new Map<string, { isMember: boolean; expiresAt: number }>();
  constructor(private readonly ttlMs: number = 30_000) {}

  async isMember(maxChatId: number, maxUserId: number): Promise<boolean> {
    const key = `${maxChatId}:${maxUserId}`;
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.isMember;
    }
    if (!bot) return false;
    try {
      const response = await bot.api.getChatMembers(maxChatId, { user_ids: [maxUserId] });
      const isMember = response.members.some((member: { user_id?: number; id?: number }) => (member.user_id ?? member.id) === maxUserId);
      this.cache.set(key, { isMember, expiresAt: now + this.ttlMs });
      return isMember;
    } catch {
      return false;
    }
  }

  async getChatInfo(maxChatId: number) {
    if (!bot) return null;
    try {
      const chat = await bot.api.getChat(maxChatId);
      return {
        title: chat.title ?? null,
        chatUrl: chat.link ?? null,
      };
    } catch {
      return null;
    }
  }
}

const app = await buildApp({
  config,
  databaseCheck: () => database.check(),
  services: {
    profiles: persistence,
    webhookInbox: persistence,
    membership: new CachedMembership(),
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
