import { and, asc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

import type { createDatabase } from '@quiet-chat/database';
import { homes, messages, residentProfiles, summaryJobs } from '@quiet-chat/database';
import { summaryResultSchema, type SummaryPeriod, type SummaryResult } from '@quiet-chat/shared';

import type { SummaryRepository } from './summary-service.js';

type DatabaseConnection = ReturnType<typeof createDatabase>;

export class PostgresSummaryRepository implements SummaryRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async findHomeForResident(maxChatId: bigint, maxUserId: bigint) {
    const [row] = await this.database.db
      .select({
        id: homes.id,
        timezone: homes.timezone,
        apartment: residentProfiles.apartment,
        properties: residentProfiles.properties,
        title: homes.title,
        maxChatId: homes.maxChatId,
      })
      .from(residentProfiles)
      .innerJoin(homes, eq(residentProfiles.homeId, homes.id))
      .where(and(
        eq(homes.maxChatId, maxChatId),
        eq(residentProfiles.maxUserId, maxUserId),
        isNotNull(residentProfiles.membershipVerifiedAt),
        eq(homes.isActive, true),
      ))
      .limit(1);
    if (!row) return null;

    return {
      id: row.id,
      timezone: row.timezone,
      apartment: row.apartment,
      title: row.title,
      maxChatId: row.maxChatId,
    };
  }

  async findHomesForResident(maxUserId: bigint) {
    const rows = await this.database.db
      .select({
        id: homes.id,
        timezone: homes.timezone,
        apartment: residentProfiles.apartment,
        title: homes.title,
        maxChatId: homes.maxChatId,
      })
      .from(residentProfiles)
      .innerJoin(homes, eq(residentProfiles.homeId, homes.id))
      .where(and(
        eq(residentProfiles.maxUserId, maxUserId),
        isNotNull(residentProfiles.membershipVerifiedAt),
        eq(homes.isActive, true),
      ));
    return rows.map((row) => ({
      id: row.id,
      timezone: row.timezone,
      apartment: row.apartment,
      title: row.title,
      maxChatId: row.maxChatId,
    }));
  }

  async findHomeById(homeId: string, maxUserId: bigint) {
    const [row] = await this.database.db
      .select({
        id: homes.id,
        timezone: homes.timezone,
        apartment: residentProfiles.apartment,
        title: homes.title,
        maxChatId: homes.maxChatId,
      })
      .from(residentProfiles)
      .innerJoin(homes, eq(residentProfiles.homeId, homes.id))
      .where(and(
        eq(homes.id, homeId),
        eq(residentProfiles.maxUserId, maxUserId),
        isNotNull(residentProfiles.membershipVerifiedAt),
        eq(homes.isActive, true),
      ))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      timezone: row.timezone,
      apartment: row.apartment,
      title: row.title,
      maxChatId: row.maxChatId,
    };
  }

  async revokeMembership(homeId: string, maxUserId: bigint): Promise<void> {
    await this.database.db
      .update(residentProfiles)
      .set({ membershipVerifiedAt: null, updatedAt: new Date() })
      .where(and(
        eq(residentProfiles.homeId, homeId),
        eq(residentProfiles.maxUserId, maxUserId),
      ));
  }

  async revokeMembershipByChatId(maxChatId: bigint, maxUserId: bigint): Promise<void> {
    const [home] = await this.database.db
      .select({ id: homes.id })
      .from(homes)
      .where(eq(homes.maxChatId, maxChatId))
      .limit(1);
    if (home) {
      await this.revokeMembership(home.id, maxUserId);
    }
  }

  async findCached(homeId: string, maxUserId: bigint, period: SummaryPeriod, createdAfter: Date): Promise<SummaryResult | null> {
    const response = await this.database.pool.query<{ result: unknown }>(
      `select sj.result from summary_jobs sj
       where sj.home_id = $1 and sj.status = 'done' and sj.mode = 'yandexgpt'
         and sj.created_at >= $3 and sj.result ->> 'period' = $4
         and not exists (
           select 1 from messages m
           where m.home_id = sj.home_id
             and m.sent_at >= sj.period_from
             and (
               m.created_at > sj.created_at
               or m.updated_at > sj.created_at
               or m.sent_at > sj.created_at
               or (m.edited_at is not null and m.edited_at > sj.created_at)
               or (m.deleted_at is not null and m.deleted_at > sj.created_at)
             )
         )
         and (
           select count(*) from messages m
           where m.home_id = sj.home_id
             and m.sent_at >= sj.period_from
             and m.deleted_at is null
         ) = sj.message_count
       order by (case when sj.requested_by = $2 then 0 else 1 end), sj.created_at desc limit 1`,
      [homeId, maxUserId.toString(), createdAfter, period],
    );
    const parsed = summaryResultSchema.safeParse(response.rows[0]?.result);
    return parsed.success ? parsed.data : null;
  }

  async listMessages(homeId: string, from: Date, to: Date) {
    return this.database.db
      .select({
        id: messages.id,
        senderDisplayName: messages.senderDisplayName,
        text: messages.text,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .where(and(eq(messages.homeId, homeId), gte(messages.sentAt, from), lte(messages.sentAt, to), isNull(messages.deletedAt)))
      .orderBy(asc(messages.sentAt));
  }

  async createJob(input: { homeId: string; requestedBy: bigint; from: Date; to: Date; messageCount: number }): Promise<string> {
    const [row] = await this.database.db.insert(summaryJobs).values({
      homeId: input.homeId,
      requestedBy: input.requestedBy,
      periodFrom: input.from,
      periodTo: input.to,
      messageCount: input.messageCount,
      status: 'processing',
    }).returning({ id: summaryJobs.id });
    if (!row) throw new Error('Summary job was not created');
    return row.id;
  }

  async completeJob(id: string, mode: 'yandexgpt' | 'fallback', result: SummaryResult, error: string | null): Promise<void> {
    await this.database.db.update(summaryJobs).set({
      status: 'done',
      mode,
      result,
      lastError: error,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(summaryJobs.id, id));
  }
}
