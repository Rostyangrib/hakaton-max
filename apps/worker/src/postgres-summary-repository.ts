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
      .select({ id: homes.id, timezone: homes.timezone })
      .from(residentProfiles)
      .innerJoin(homes, eq(residentProfiles.homeId, homes.id))
      .where(and(
        eq(homes.maxChatId, maxChatId),
        eq(residentProfiles.maxUserId, maxUserId),
        isNotNull(residentProfiles.membershipVerifiedAt),
        eq(homes.isActive, true),
      ))
      .limit(1);
    return row ?? null;
  }

  async findCached(homeId: string, maxUserId: bigint, period: SummaryPeriod, createdAfter: Date): Promise<SummaryResult | null> {
    const response = await this.database.pool.query<{ result: unknown }>(
      `select result from summary_jobs
       where home_id = $1 and requested_by = $2 and status = 'done'
         and created_at >= $3 and result ->> 'period' = $4
       order by created_at desc limit 1`,
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
