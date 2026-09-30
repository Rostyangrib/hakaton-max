import type { SummaryCategories, SummaryPeriod, SummaryResult } from '@quiet-chat/shared';

import {
  createFallbackSummary,
  deduplicateAndCleanCategories,
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

export interface SummaryJobRecord {
  id: string;
  mode: 'yandexgpt' | 'fallback' | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  result: SummaryResult | null;
  messageCount: number;
  periodFrom: Date;
  periodTo: Date;
  createdAt: Date;
  completedAt: Date | null;
}

export interface SummaryRepository {
  findHomeForResident(maxChatId: bigint, maxUserId: bigint): Promise<SummaryHome | null>;
  findHomesForResident?(maxUserId: bigint): Promise<SummaryHome[]>;
  findHomeById?(homeId: string, maxUserId: bigint): Promise<SummaryHome | null>;
  revokeMembership?(homeId: string, maxUserId: bigint): Promise<void>;
  verifyMembership?(homeId: string, maxUserId: bigint): Promise<void>;
  findCached(homeId: string, maxUserId: bigint, period: SummaryPeriod, createdAfter: Date): Promise<SummaryResult | null>;
  findLatestJob?(homeId: string, period: SummaryPeriod, from: Date): Promise<SummaryJobRecord | null>;
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
    if (sourceMessages.length === 0) {
      return {
        housing: [],
        yard: [],
        community: [],
        period,
        periodFrom: from.toISOString(),
        periodTo: to.toISOString(),
        messageCount: 0,
        filteredCount: 0,
        savedMinutes: 0,
        generatedAt: now.toISOString(),
        mode: 'yandexgpt',
        cached: false,
        homeTitle: home.title,
      };
    }

    // Check if we can perform incremental summarization:
    const latestJob = this.repository.findLatestJob
      ? await this.repository.findLatestJob(home.id, period, from)
      : null;

    const canDoIncremental =
      latestJob &&
      latestJob.status === 'done' &&
      latestJob.result &&
      (latestJob.mode !== 'fallback' || !this.model);

    if (canDoIncremental && latestJob.result) {
      const prevResult = latestJob.result;

      // Identify newly arrived messages using lastMessageId or lastMessageSentAt
      let lastSeenIndex = -1;
      if (prevResult.lastMessageId) {
        lastSeenIndex = sourceMessages.findIndex((m) => m.id === prevResult.lastMessageId);
      }
      if (lastSeenIndex === -1 && prevResult.lastMessageSentAt) {
        const lastSent = new Date(prevResult.lastMessageSentAt).getTime();
        for (let i = sourceMessages.length - 1; i >= 0; i--) {
          if (sourceMessages[i]!.sentAt.getTime() <= lastSent) {
            lastSeenIndex = i;
            break;
          }
        }
      }

      const newMessages =
        lastSeenIndex !== -1
          ? sourceMessages.slice(lastSeenIndex + 1)
          : sourceMessages.length > latestJob.messageCount
            ? sourceMessages.slice(latestJob.messageCount)
            : [];

      if (newMessages.length === 0) {
        return {
          ...prevResult,
          messageCount: sourceMessages.length,
          filteredCount: sourceMessages.length,
          savedMinutes: estimateSavedMinutes(sourceMessages.length),
          periodTo: to.toISOString(),
          generatedAt: now.toISOString(),
          cached: false,
          homeTitle: home.title,
        };
      }

      const preparedNew = prepareSummaryMessages(newMessages);

      if (preparedNew.length === 0) {
        const result: SummaryResult = {
          ...prevResult,
          messageCount: sourceMessages.length,
          filteredCount: sourceMessages.length,
          savedMinutes: estimateSavedMinutes(sourceMessages.length),
          periodTo: to.toISOString(),
          generatedAt: now.toISOString(),
          cached: false,
          homeTitle: home.title,
          lastMessageId: sourceMessages.at(-1)?.id,
          lastMessageSentAt: sourceMessages.at(-1)?.sentAt.toISOString(),
        };

        const jobId = await this.repository.createJob({
          homeId: home.id,
          requestedBy: maxUserId,
          from,
          to,
          messageCount: sourceMessages.length,
        });
        await this.repository.completeJob(jobId, prevResult.mode, result, null);
        return result;
      }

      let newCategories: SummaryCategories;
      let mode: 'yandexgpt' | 'fallback' = prevResult.mode;
      let error: string | null = null;
      try {
        if (!this.model) throw new Error('YandexGPT is not configured');
        newCategories = await this.model.summarize(preparedNew);
        mode = 'yandexgpt';
      } catch (cause) {
        console.warn(JSON.stringify({
          level: 'warn',
          service: 'worker',
          message: 'YandexGPT failed on new messages, using fallback for incremental items',
          error: cause instanceof Error ? cause.message : String(cause),
        }));
        mode = prevResult.mode;
        error = (cause instanceof Error ? cause.message : 'Unknown YandexGPT error').slice(0, 2_000);
        newCategories = createFallbackSummary(preparedNew);
      }

      const mergedCategories: SummaryCategories = {
        housing: [...prevResult.housing, ...newCategories.housing],
        yard: [...prevResult.yard, ...newCategories.yard],
        community: [...prevResult.community, ...newCategories.community],
      };
      const cleaned = deduplicateAndCleanCategories(mergedCategories);

      const result: SummaryResult = {
        ...cleaned,
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
        lastMessageId: sourceMessages.at(-1)?.id,
        lastMessageSentAt: sourceMessages.at(-1)?.sentAt.toISOString(),
      };

      const jobId = await this.repository.createJob({
        homeId: home.id,
        requestedBy: maxUserId,
        from,
        to,
        messageCount: sourceMessages.length,
      });
      await this.repository.completeJob(jobId, mode, result, error);
      return result;
    }

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

    const cleaned = deduplicateAndCleanCategories(categories);
    const result: SummaryResult = {
      ...cleaned,
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
      lastMessageId: sourceMessages.at(-1)?.id,
      lastMessageSentAt: sourceMessages.at(-1)?.sentAt.toISOString(),
    };
    await this.repository.completeJob(jobId, mode, result, error);
    return result;
  }
}
