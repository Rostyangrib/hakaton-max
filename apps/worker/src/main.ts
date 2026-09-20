import { Bot } from '@maxhub/max-bot-api';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@quiet-chat/config';
import { createDatabase, users } from '@quiet-chat/database';
import { maxUpdateSchema } from '@quiet-chat/shared';

import { createWelcomeKeyboard, welcomeText } from './menu.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const bot = config.MAX_BOT_TOKEN ? new Bot(config.MAX_BOT_TOKEN) : null;
let stopping = false;
let polling = false;

type ClaimedEvent = { id: string; payload: unknown; attempts: number };
type MaxUserPayload = { user_id: number; first_name: string; last_name?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readUser(value: unknown): MaxUserPayload | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.user_id) || typeof value.first_name !== 'string') return null;
  return {
    user_id: value.user_id as number,
    first_name: value.first_name,
    ...(typeof value.last_name === 'string' ? { last_name: value.last_name } : {}),
  };
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

async function sendWelcome(user: MaxUserPayload): Promise<void> {
  if (!bot || !config.MAX_MINI_APP_URL) throw new Error('MAX bot or mini-app URL is not configured');
  await bot.api.sendMessageToUser(user.user_id, welcomeText, {
    attachments: [createWelcomeKeyboard(config.MAX_MINI_APP_URL)],
  });
}

async function processUpdate(payload: unknown): Promise<void> {
  const parsed = maxUpdateSchema.parse(payload);
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
    const body = isRecord(message.body) ? message.body : null;
    const text = typeof body?.text === 'string' ? body.text.trim().toLowerCase() : '';
    if (sender && recipient?.chat_type === 'dialog' && (text === '/start' || text.startsWith('/start '))) {
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
    if (!bot || !config.MAX_MINI_APP_URL) return;
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
