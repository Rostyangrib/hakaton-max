import { Bot } from '@maxhub/max-bot-api';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@quiet-chat/config';
import { createDatabase, users } from '@quiet-chat/database';
import { maxUpdateSchema, summaryPeriodSchema } from '@quiet-chat/shared';

import { createSummaryKeyboard, createWelcomeKeyboard, welcomeText } from './menu.js';
import { MessagePipeline } from './message-pipeline.js';
import { PostgresMessageRepository } from './postgres-message-repository.js';
import { PostgresSummaryRepository } from './postgres-summary-repository.js';
import { createSession } from './session.js';
import { renderSummary } from './summary.js';
import { SummaryCallbackHandler } from './summary-callback-handler.js';
import { SummaryAccessError, SummaryService } from './summary-service.js';
import { YandexGptClient } from './yandex-gpt.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const bot = config.MAX_BOT_TOKEN ? new Bot(config.MAX_BOT_TOKEN) : null;
const configuredHomeChatId = Number(config.MAX_HOME_CHAT_ID);
const messagePipeline = bot && Number.isSafeInteger(configuredHomeChatId)
  ? new MessagePipeline(
      new PostgresMessageRepository(database, config.HOME_TIMEZONE),
      bot.api,
      configuredHomeChatId,
      config.ALERT_ANTIFLOOD_MINUTES,
    )
  : null;
const summaryModel = config.YANDEX_CLOUD_API_KEY && config.YANDEX_CLOUD_FOLDER_ID
  ? new YandexGptClient({
      apiKey: config.YANDEX_CLOUD_API_KEY,
      folderId: config.YANDEX_CLOUD_FOLDER_ID,
      ...(config.YANDEXGPT_MODEL_URI ? { modelUri: config.YANDEXGPT_MODEL_URI } : {}),
      apiUrl: config.YANDEXGPT_API_URL,
      timeoutMs: config.YANDEXGPT_TIMEOUT_MS,
    })
  : null;
const summaryService = bot && Number.isSafeInteger(configuredHomeChatId)
  ? new SummaryService(
      new PostgresSummaryRepository(database),
      summaryModel,
      BigInt(configuredHomeChatId),
      config.SUMMARY_CACHE_TTL_SECONDS,
    )
  : null;
let botUsername = config.MAX_BOT_USERNAME || 'se14396800_bot';
let botContactId: number | undefined;

const summaryCallbackHandler = bot && summaryService
  ? new SummaryCallbackHandler({
      botApi: bot.api,
      summaryService,
      onUserSeen: (user) => upsertUser(user, true),
      getUserDirectUrl: (userId) => getUserDirectUrl(userId),
      getWelcomeKeyboard: (directUrl) => (config.MAX_MINI_APP_URL ? createWelcomeKeyboard(botUsername, directUrl, botContactId) : undefined),
    })
  : null;

async function initBotInfo(): Promise<void> {
  if (!bot) return;
  try {
    const info = await bot.api.getMyInfo();
    if (info?.username) botUsername = info.username;
    if (typeof info?.user_id === 'number') botContactId = info.user_id;
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', service: 'worker', message: 'Failed to fetch bot info on start', error: String(error) }));
  }
}
let stopping = false;
let polling = false;

type ClaimedEvent = { id: string; payload: unknown; attempts: number };
type MaxUserPayload = { user_id: number; first_name: string; last_name?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readUser(value: unknown): MaxUserPayload | null {
  if (!isRecord(value)) return null;
  const rawId = value.user_id ?? value.id;
  const userId =
    typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string' && /^\d+$/.test(rawId)
        ? Number(rawId)
        : null;
  if (!userId || !Number.isSafeInteger(userId) || userId <= 0) return null;
  const firstName =
    typeof value.first_name === 'string' && value.first_name.trim()
      ? value.first_name.trim()
      : 'Жилец';
  return {
    user_id: userId,
    first_name: firstName,
    ...(typeof value.last_name === 'string' && value.last_name.trim()
      ? { last_name: value.last_name.trim() }
      : {}),
  };
}

function isGroupMessageUpdate(update: Record<string, unknown>): boolean {
  if (update.update_type === 'message_removed') return true;
  if (update.update_type !== 'message_created' && update.update_type !== 'message_edited') return false;
  const message = isRecord(update.message) ? update.message : null;
  const recipient = message && isRecord(message.recipient) ? message.recipient : null;
  return recipient?.chat_type === 'chat';
}

async function claimEvent(): Promise<ClaimedEvent | null> {
  const result = await database.pool.query<ClaimedEvent>(`
    with next_event as (
      select id from webhook_events
      where status = 'pending' and available_at <= now()
      order by created_at
      for update skip locked
      limit 1
    )
    update webhook_events
    set status = 'processing', attempts = attempts + 1, updated_at = now()
    where id in (select id from next_event)
    returning id, payload, attempts
  `);
  return result.rows[0] ?? null;
}

async function markDone(id: string): Promise<void> {
  await database.pool.query(
    "update webhook_events set status = 'done', processed_at = now(), last_error = null, updated_at = now() where id = $1",
    [id],
  );
}

async function markFailed(event: ClaimedEvent, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown worker error';
  await database.pool.query(
    `update webhook_events
     set status = case when attempts >= 5 then 'failed'::processing_status else 'pending'::processing_status end,
         available_at = now() + make_interval(secs => least(300, power(2, attempts)::integer)),
         last_error = $2,
         updated_at = now()
     where id = $1`,
    [event.id, message.slice(0, 2_000)],
  );
}

async function upsertUser(user: MaxUserPayload, started: boolean): Promise<void> {
  const now = new Date();
  await database.db
    .insert(users)
    .values({
      maxUserId: BigInt(user.user_id),
      displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
      ...(started ? { botStartedAt: now } : {}),
    })
    .onConflictDoUpdate({
      target: users.maxUserId,
      set: {
        displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
        ...(started ? { botStartedAt: now, botStoppedAt: null } : {}),
        updatedAt: now,
      },
    });
}

function getUserDirectUrl(userId: number): string | undefined {
  if (!config.MAX_MINI_APP_URL) return undefined;
  if (!config.SESSION_SECRET) return config.MAX_MINI_APP_URL;
  const token = createSession(BigInt(userId), config.SESSION_SECRET, config.SESSION_TTL_SECONDS);
  const base = config.MAX_MINI_APP_URL.replace(/\/+$/, '');
  return `${base}/?token=${token}`;
}

async function sendWelcome(user: MaxUserPayload): Promise<void> {
  if (!bot) throw new Error('MAX bot is not configured');
  const directUrl = getUserDirectUrl(user.user_id);
  const keyboard = config.MAX_MINI_APP_URL
    ? createWelcomeKeyboard(botUsername, directUrl, botContactId)
    : undefined;
  try {
    await bot.api.sendMessageToUser(user.user_id, welcomeText, keyboard ? { attachments: [keyboard] } : undefined);
  } catch (error) {
    if (directUrl) {
      await bot.api.sendMessageToUser(user.user_id, `${welcomeText}\n\nЗаполнить профиль: ${directUrl}`);
      return;
    }
    throw error;
  }
}

async function processSummaryCallback(update: Record<string, unknown>): Promise<boolean> {
  if (update.update_type !== 'message_callback' || !bot) return false;
  if (!summaryService || !summaryCallbackHandler) {
    const callback = isRecord(update.callback) ? update.callback : null;
    const payload = callback && typeof callback.payload === 'string' ? callback.payload : '';
    if (payload.startsWith('summary:')) {
      throw new Error('MAX_HOME_CHAT_ID is not configured');
    }
    return false;
  }
  return summaryCallbackHandler.handle(update);
}

async function processUpdate(payload: unknown): Promise<void> {
  const parsed = maxUpdateSchema.parse(payload);
  if (messagePipeline && await messagePipeline.handle(parsed)) return;
  if (await processSummaryCallback(parsed)) return;
  if (!messagePipeline && isGroupMessageUpdate(parsed)) {
    throw new Error('MAX_HOME_CHAT_ID is not configured');
  }

  if (parsed.update_type === 'bot_started') {
    const user = readUser(parsed.user);
    if (!user) throw new Error('bot_started update has invalid user');
    await upsertUser(user, true);
    await sendWelcome(user);
    return;
  }

  if (parsed.update_type === 'bot_stopped') {
    const user = readUser(parsed.user);
    if (user) {
      await upsertUser(user, false);
      await database.db
        .update(users)
        .set({ botStoppedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.maxUserId, BigInt(user.user_id)));
    }
    return;
  }

  if (parsed.update_type === 'message_created' && isRecord(parsed.message)) {
    const message = parsed.message;
    const sender = readUser(message.sender);
    const recipient = isRecord(message.recipient) ? message.recipient : null;
    if (sender && recipient?.chat_type === 'dialog') {
      await upsertUser(sender, true);
      await sendWelcome(sender);
    }
  }
}

async function poll(): Promise<void> {
  if (polling || stopping) return;
  polling = true;
  try {
    await database.check();
    if (!bot) return;
    for (let processed = 0; processed < 25; processed += 1) {
      const event = await claimEvent();
      if (!event) break;
      try {
        await processUpdate(event.payload);
        await markDone(event.id);
      } catch (error) {
        await markFailed(event, error);
        console.error(JSON.stringify({ level: 'error', service: 'worker', message: 'MAX event failed', eventId: event.id }));
      }
    }
  } catch {
    console.error(JSON.stringify({ level: 'error', service: 'worker', message: 'poll failed' }));
  } finally {
    polling = false;
  }
}

await initBotInfo();
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
