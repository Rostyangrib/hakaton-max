import { and, eq, isNotNull } from 'drizzle-orm';

import type { createDatabase } from '@quiet-chat/database';
import { homes, messages, residentProfiles } from '@quiet-chat/database';

import type {
  AlertProfile,
  DeliveryReservation,
  IncomingMessage,
  MessageRepository,
  StoredMessage,
} from './message-pipeline.js';

type DatabaseConnection = ReturnType<typeof createDatabase>;

function toStoredMessage(row: typeof messages.$inferSelect, chatId: number, chatType: string): StoredMessage {
  return {
    id: row.id,
    homeId: row.homeId,
    maxMessageId: row.maxMessageId,
    chatId,
    chatType,
    senderUserId: Number(row.senderUserId),
    senderDisplayName: row.senderDisplayName,
    text: row.text,
    sentAt: row.sentAt,
  };
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly homeTimezone: string,
  ) {}

  async ensureHome(maxChatId: bigint): Promise<string> {
    await this.database.db
      .insert(homes)
      .values({ maxChatId, title: 'Тестовый дом', timezone: this.homeTimezone })
      .onConflictDoNothing();
    const [home] = await this.database.db.select({ id: homes.id }).from(homes).where(eq(homes.maxChatId, maxChatId)).limit(1);
    if (!home) throw new Error('Configured home could not be created');
    return home.id;
  }

  async upsertCreated(
    homeId: string,
    message: IncomingMessage,
    normalizedText: string,
    payloadHash: string,
  ): Promise<StoredMessage> {
    const values = {
      homeId,
      maxMessageId: message.maxMessageId,
      senderUserId: BigInt(message.senderUserId),
      senderDisplayName: message.senderDisplayName,
      text: message.text,
      normalizedText,
      payloadHash,
      sentAt: message.sentAt,
      deletedAt: null,
      updatedAt: new Date(),
    };
    const updateValues = {
      homeId,
      senderUserId: BigInt(message.senderUserId),
      senderDisplayName: message.senderDisplayName,
      text: message.text,
      normalizedText,
      payloadHash,
      sentAt: message.sentAt,
      updatedAt: new Date(),
    };
    const [row] = await this.database.db
      .insert(messages)
      .values(values)
      .onConflictDoUpdate({
        target: messages.maxMessageId,
        set: updateValues,
      })
      .returning();
    if (!row) throw new Error('Message was not saved');
    return toStoredMessage(row, message.chatId, message.chatType);
  }

  async updateEdited(
    homeId: string,
    message: IncomingMessage,
    normalizedText: string,
    payloadHash: string,
  ): Promise<StoredMessage | null> {
    const [row] = await this.database.db
      .update(messages)
      .set({
        senderUserId: BigInt(message.senderUserId),
        senderDisplayName: message.senderDisplayName,
        text: message.text,
        normalizedText,
        payloadHash,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(messages.homeId, homeId), eq(messages.maxMessageId, message.maxMessageId)))
      .returning();
    return row ? toStoredMessage(row, message.chatId, message.chatType) : null;
  }

  async markDeleted(homeId: string, maxMessageId: string, deletedAt: Date): Promise<boolean> {
    const rows = await this.database.db
      .update(messages)
      .set({ deletedAt, updatedAt: new Date() })
      .where(and(eq(messages.homeId, homeId), eq(messages.maxMessageId, maxMessageId)))
      .returning({ id: messages.id });
    return rows.length > 0;
  }

  async findAlertProfiles(homeId: string, _senderUserId?: bigint): Promise<AlertProfile[]> {
    return this.database.db
      .select({
        id: residentProfiles.id,
        maxUserId: residentProfiles.maxUserId,
        apartment: residentProfiles.apartment,
        entrance: residentProfiles.entrance,
        carPlateNormalized: residentProfiles.carPlateNormalized,
        carDescription: residentProfiles.carDescription,
      })
      .from(residentProfiles)
      .where(and(
        eq(residentProfiles.homeId, homeId),
        eq(residentProfiles.alertsEnabled, true),
        isNotNull(residentProfiles.membershipVerifiedAt),
      ));
  }

  async reserveDelivery(input: {
    profileId: string;
    messageId: string;
    senderUserId: bigint;
    trigger: { type: string; value: string };
    antifloodMinutes: number;
  }): Promise<DeliveryReservation | null> {
    const client = await this.database.pool.connect();
    const lockKey = `${input.profileId}:${input.senderUserId}:${input.trigger.type}:${input.trigger.value}`;
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey]);

      const existing = await client.query<{ id: string; status: string }>(
        `select id, status from alert_deliveries
         where profile_id = $1 and message_id = $2 and trigger_type = $3 and trigger_value = $4
         order by created_at desc limit 1`,
        [input.profileId, input.messageId, input.trigger.type, input.trigger.value],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.status === 'failed') {
          await client.query(
            "update alert_deliveries set status = 'processing', last_error = null where id = $1",
            [previous.id],
          );
          await client.query('commit');
          return { id: previous.id };
        }
        await client.query('commit');
        return null;
      }

      const recent = await client.query(
        `select 1 from alert_deliveries
         where profile_id = $1
           and sender_user_id = $2
           and trigger_type = $3
           and trigger_value = $4
           and status in ('pending', 'processing', 'done')
           and created_at >= now() - ($5::integer * interval '1 minute')
         limit 1`,
        [input.profileId, input.senderUserId.toString(), input.trigger.type, input.trigger.value, input.antifloodMinutes],
      );
      if (recent.rowCount) {
        await client.query('commit');
        return null;
      }

      const inserted = await client.query<{ id: string }>(
        `insert into alert_deliveries
           (profile_id, message_id, sender_user_id, trigger_type, trigger_value, status)
         values ($1, $2, $3, $4, $5, 'processing')
         returning id`,
        [input.profileId, input.messageId, input.senderUserId.toString(), input.trigger.type, input.trigger.value],
      );
      await client.query('commit');
      const row = inserted.rows[0];
      if (!row) throw new Error('Alert delivery reservation was not created');
      return row;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDeliveryDone(id: string, sentAt: Date): Promise<void> {
    await this.database.pool.query(
      "update alert_deliveries set status = 'done', sent_at = $2, last_error = null where id = $1",
      [id, sentAt],
    );
  }

  async markDeliveryFailed(id: string, error: string): Promise<void> {
    await this.database.pool.query(
      "update alert_deliveries set status = 'failed', last_error = $2 where id = $1",
      [id, error],
    );
  }
}
