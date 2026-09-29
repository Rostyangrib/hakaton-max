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
  title?: string;
  chatUrl?: string | null;
  maxChatId?: bigint;
  membershipVerifiedAt?: Date | null;
}

export interface SummaryRepository {
  findHomeForResident(maxChatId: bigint, maxUserId: bigint): Promise<SummaryHome | null>;
  findHomesForResident?(maxUserId: bigint): Promise<SummaryHome[]>;
  findHomeById?(homeId: string, maxUserId: bigint): Promise<SummaryHome | null>;
  revokeMembership?(homeId: string, maxUserId: bigint): Promise<void>;
  verifyMembership?(homeId: string, maxUserId: bigint): Promise<void>;
  findCached(homeId: string, maxUserId: bigint, period: SummaryPeriod, createdAfter: Date): Promise<SummaryResult | null>;
  listMessages(homeId: string, from: Date, to: Date): Promise<SummarySourceMessage[]>;
  createJob(input: { homeId: string; requestedBy: bigint; from: Date; to: Date; messageCount: number }): Promise<string>;
  completeJob(id: string, mode: 'yandexgpt' | 'fallback', result: SummaryResult, error: string | null): Promise<void>;
}

export interface SummaryModel {
  summarize(messages: SummarySourceMessage[]): Promise<SummaryCategories>;
}

export interface SummaryMembershipChecker {
  isMember(maxChatId: number, maxUserId: number): Promise<boolean>;
}

export class SummaryAccessError extends Error {
  constructor(
    message: string = 'Access denied',
    public readonly code: 'NOT_REGISTERED' | 'LEFT_CHAT' = 'NOT_REGISTERED',
    public readonly homeTitle?: string,
    public readonly homeChatUrl?: string | null,
  ) {
    super(message);
    this.name = 'SummaryAccessError';
  }
}

export class MultipleHomesChoiceError extends Error {
  constructor(public readonly homes: SummaryHome[]) {
    super('Resident belongs to multiple homes, selection required');
    this.name = 'MultipleHomesChoiceError';
  }
}

export class SummaryService {
  constructor(
    private readonly repository: SummaryRepository,
    private readonly model: SummaryModel | null,
    private readonly homeChatId: bigint,
    private readonly cacheTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly membershipChecker?: SummaryMembershipChecker | null,
  ) {}

  async findHomesForResident(maxUserId: bigint): Promise<SummaryHome[]> {
    if (this.repository.findHomesForResident) {
      const homes = await this.repository.findHomesForResident(maxUserId);
      if (homes.length > 0) return homes;
    }
    const single = await this.repository.findHomeForResident(this.homeChatId, maxUserId);
    return single ? [single] : [];
  }

  async generate(maxUserId: bigint, period: SummaryPeriod, homeId?: string): Promise<SummaryResult> {
    let home: SummaryHome | null = null;
    if (homeId && this.repository.findHomeById) {
      home = await this.repository.findHomeById(homeId, maxUserId);
      if (!home) throw new SummaryAccessError('Дом не найден или профиль не подтвержден', 'NOT_REGISTERED');
    } else if (this.repository.findHomesForResident) {
      const homes = await this.repository.findHomesForResident(maxUserId);
      if (homes.length === 1) {
        home = homes[0]!;
      } else if (homes.length > 1) {
        throw new MultipleHomesChoiceError(homes);
      }
    }

    if (!home) {
      home = await this.repository.findHomeForResident(this.homeChatId, maxUserId);
    }
    if (!home) throw new SummaryAccessError('Resident profile is required to request a summary', 'NOT_REGISTERED');

    const maxChatId = home.maxChatId ?? this.homeChatId;
    if (this.membershipChecker && maxChatId) {
      const isMember = await this.membershipChecker.isMember(Number(maxChatId), Number(maxUserId));
      if (!isMember) {
        if (this.repository.revokeMembership) {
          await this.repository.revokeMembership(home.id, maxUserId);
        }
        throw new SummaryAccessError(
          `Пользователь не состоит в чате «${home.title || 'Домовой чат'}»`,
          'LEFT_CHAT',
          home.title,
          home.chatUrl,
        );
      }
      if (!home.membershipVerifiedAt && this.repository.verifyMembership) {
        await this.repository.verifyMembership(home.id, maxUserId);
      }
    } else if (home.membershipVerifiedAt === null) {
      throw new SummaryAccessError(
        `Пользователь не состоит в чате «${home.title || 'Домовой чат'}»`,
        'LEFT_CHAT',
        home.title,
        home.chatUrl,
      );
    }

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
      homeTitle: home.title,
    };
    await this.repository.completeJob(jobId, mode, result, error);
    return result;
  }
}
