import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const processingStatus = pgEnum('processing_status', [
  'pending',
  'processing',
  'done',
  'failed',
]);
export const summaryMode = pgEnum('summary_mode', ['yandexgpt', 'fallback']);

export const homes = pgTable('homes', {
  id: uuid('id').primaryKey().defaultRandom(),
  maxChatId: bigint('max_chat_id', { mode: 'bigint' }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Irkutsk'),
  chatUrl: text('chat_url'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const users = pgTable('users', {
  maxUserId: bigint('max_user_id', { mode: 'bigint' }).primaryKey(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  botStartedAt: timestamp('bot_started_at', { withTimezone: true }),
  botStoppedAt: timestamp('bot_stopped_at', { withTimezone: true }),
  consentVersion: varchar('consent_version', { length: 32 }),
  consentAcceptedAt: timestamp('consent_accepted_at', { withTimezone: true }),
  ...timestamps,
});

export const residentProfiles = pgTable(
  'resident_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    homeId: uuid('home_id').notNull().references(() => homes.id, { onDelete: 'cascade' }),
    maxUserId: bigint('max_user_id', { mode: 'bigint' })
      .notNull()
      .references(() => users.maxUserId, { onDelete: 'cascade' }),
    apartment: integer('apartment').notNull(),
    entrance: integer('entrance').notNull(),
    floor: integer('floor'),
    carPlateRaw: varchar('car_plate_raw', { length: 32 }),
    carPlateNormalized: varchar('car_plate_normalized', { length: 16 }),
    carDescription: varchar('car_description', { length: 100 }),
    carKeywords: text('car_keywords').array().notNull().default([]),
    alertsEnabled: boolean('alerts_enabled').notNull().default(true),
    membershipVerifiedAt: timestamp('membership_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('resident_profiles_home_user_uidx').on(table.homeId, table.maxUserId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    homeId: uuid('home_id').notNull().references(() => homes.id, { onDelete: 'cascade' }),
    maxMessageId: varchar('max_message_id', { length: 255 }).notNull().unique(),
    senderUserId: bigint('sender_user_id', { mode: 'bigint' }).notNull(),
    senderDisplayName: varchar('sender_display_name', { length: 200 }).notNull(),
    text: text('text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_home_sent_idx').on(table.homeId, table.sentAt)],
);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventKey: varchar('event_key', { length: 128 }).notNull().unique(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: processingStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  ...timestamps,
});

export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => residentProfiles.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    senderUserId: bigint('sender_user_id', { mode: 'bigint' }).notNull(),
    triggerType: varchar('trigger_type', { length: 32 }).notNull(),
    triggerValue: varchar('trigger_value', { length: 100 }).notNull(),
    status: processingStatus('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('alert_antiflood_idx').on(
      table.profileId,
      table.senderUserId,
      table.triggerType,
      table.triggerValue,
      table.sentAt,
    ),
  ],
);

export const summaryJobs = pgTable(
  'summary_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    homeId: uuid('home_id').notNull().references(() => homes.id, { onDelete: 'cascade' }),
    requestedBy: bigint('requested_by', { mode: 'bigint' })
      .notNull()
      .references(() => users.maxUserId, { onDelete: 'cascade' }),
    periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
    periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    status: processingStatus('status').notNull().default('pending'),
    mode: summaryMode('mode'),
    result: jsonb('result'),
    lastError: text('last_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('summary_jobs_period_idx').on(table.homeId, table.periodFrom, table.periodTo)],
);
