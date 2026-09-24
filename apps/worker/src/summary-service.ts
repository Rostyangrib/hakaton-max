import type { SummaryCategories, SummaryPeriod, SummaryResult } from '@quiet-chat/shared';

import {
  createFallbackSummary,
  estimateSavedMinutes,
  getSummaryPeriodRange,
  prepareSummaryMessages,
  type SummarySourceMessage,
} from './summary.js';

export interface SummaryHome {
  id: string;
  timezone: string;
  apartment?: number;
}

export interface SummaryRepository {
  findHomeForResident(maxChatId: bigint, maxUserId: bigint): Promise<SummaryHome | null>;
  findCached(homeId: string, maxUserId: bigint, period: SummaryPeriod, createdAfter: Date): Promise<SummaryResult | null>;
  listMessages(homeId: string, from: Date, to: Date): Promise<SummarySourceMessage[]>;
  createJob(input: { homeId: string; requestedBy: bigint; from: Date; to: Date; messageCount: number }): Promise<string>;
  completeJob(id: string, mode: 'yandexgpt' | 'fallback', result: SummaryResult, error: string | null): Promise<void>;
}

export interface SummaryModel {
  summarize(messages: SummarySourceMessage[]): Promise<SummaryCategories>;
}

export class SummaryAccessError extends Error {}

export class SummaryService {
  constructor(
    private readonly repository: SummaryRepository,
    private readonly model: SummaryModel | null,
    private readonly homeChatId: bigint,
    private readonly cacheTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(maxUserId: bigint, period: SummaryPeriod): Promise<SummaryResult> {
    const home = await this.repository.findHomeForResident(this.homeChatId, maxUserId);
    if (!home) throw new SummaryAccessError('Resident profile is required to request a summary');

    const now = this.now();
    const { from, to } = getSummaryPeriodRange(period, now, home.timezone);
    const cached = await this.repository.findCached(
      home.id,
      maxUserId,
      period,
      new Date(now.getTime() - this.cacheTtlSeconds * 1_000),
    );
    if (cached && (period !== 'today' || cached.periodFrom === from.toISOString())) {
      return { ...cached, cached: true };
    }

    const sourceMessages = await this.repository.listMessages(home.id, from, to);
    const prepared = prepareSummaryMessages(sourceMessages);
    const jobId = await this.repository.createJob({
      homeId: home.id,
      requestedBy: maxUserId,
      from,
      to,
      messageCount: sourceMessages.length,
    });

    let categories: SummaryCategories;
    let mode: 'yandexgpt' | 'fallback' = 'yandexgpt';
    let error: string | null = null;
    try {
      if (!this.model) throw new Error('YandexGPT is not configured');
      categories = await this.model.summarize(prepared);
    } catch (cause) {
      console.warn(JSON.stringify({
        level: 'warn',
        service: 'worker',
        message: 'YandexGPT failed, using fallback summary',
        error: cause instanceof Error ? cause.message : String(cause),
      }));
      mode = 'fallback';
      error = (cause instanceof Error ? cause.message : 'Unknown YandexGPT error').slice(0, 2_000);
      categories = createFallbackSummary(prepared);
    }

    const result: SummaryResult = {
      ...categories,
      period,
      periodFrom: from.toISOString(),
      periodTo: to.toISOString(),
      messageCount: sourceMessages.length,
      filteredCount: sourceMessages.length,
      savedMinutes: estimateSavedMinutes(sourceMessages.length),
      generatedAt: now.toISOString(),
      mode,
      cached: false,
    };
    await this.repository.completeJob(jobId, mode, result, error);
    return result;
  }
}
