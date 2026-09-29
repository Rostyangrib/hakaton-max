import { describe, expect, it, vi } from 'vitest';

import type { SummaryResult } from '@quiet-chat/shared';

import { SummaryAccessError, SummaryService, type SummaryRepository } from './summary-service.js';

const now = new Date('2026-09-21T04:00:00.000Z');

function repository(overrides: Partial<SummaryRepository> = {}): SummaryRepository {
  return {
    findHomeForResident: vi.fn(async () => ({ id: 'home-1', timezone: 'Asia/Irkutsk' })),
    findCached: vi.fn(async () => null),
    listMessages: vi.fn(async () => [{ id: 'm1', senderDisplayName: 'Анна', text: 'Не работает лифт', sentAt: now }]),
    createJob: vi.fn(async () => 'job-1'),
    completeJob: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('SummaryService', () => {
  it('returns a cached result without calling the model', async () => {
    const cached: SummaryResult = {
      housing: [], yard: [], community: [], period: 'week',
      periodFrom: now.toISOString(), periodTo: now.toISOString(),
      messageCount: 1, filteredCount: 1, savedMinutes: 1,
      generatedAt: now.toISOString(), mode: 'yandexgpt', cached: false,
    };
    const repo = repository({ findCached: vi.fn(async () => cached) });
    const model = { summarize: vi.fn(async () => ({ housing: [], yard: [], community: [] })) };
    const result = await new SummaryService(repo, model, 777n, 600, () => now).generate(42n, 'week');
    expect(result.cached).toBe(true);
    expect(model.summarize).not.toHaveBeenCalled();
    expect(repo.listMessages).not.toHaveBeenCalled();
  });

  it('stores a validated AI summary', async () => {
    const repo = repository();
    const model = { summarize: vi.fn(async () => ({
      housing: [{ text: 'Не работает лифт', sourceMessageIds: ['m1'] }], yard: [], community: [],
    })) };
    const result = await new SummaryService(repo, model, 777n, 600, () => now).generate(42n, 'today');
    expect(result.mode).toBe('yandexgpt');
    expect(repo.completeJob).toHaveBeenCalledWith('job-1', 'yandexgpt', result, null);
  });

  it('uses and stores fallback when the model is unavailable', async () => {
    const repo = repository();
    const model = { summarize: vi.fn(async () => { throw new Error('timeout'); }) };
    const result = await new SummaryService(repo, model, 777n, 600, () => now).generate(42n, 'month');
    expect(result.mode).toBe('fallback');
    expect(result.housing[0]?.sourceMessageIds).toEqual(['m1']);
    expect(repo.completeJob).toHaveBeenCalledWith('job-1', 'fallback', result, 'timeout');
  });

  it('generates a fresh summary when cached summary is invalidated by new messages', async () => {
    const repo = repository({ findCached: vi.fn(async () => null) });
    const model = { summarize: vi.fn(async () => ({ housing: [], yard: [], community: [] })) };
    const result = await new SummaryService(repo, model, 777n, 600, () => now).generate(42n, 'today');
    expect(result.cached).toBe(false);
    expect(repo.findCached).toHaveBeenCalled();
    expect(repo.listMessages).toHaveBeenCalled();
    expect(model.summarize).toHaveBeenCalled();
    expect(repo.createJob).toHaveBeenCalled();
  });

  it('bypasses stale today cache when the date rolls over past local midnight', async () => {
    const yesterdayFrom = '2026-09-20T16:00:00.000Z'; // yesterday midnight in Asia/Irkutsk
    const cachedFromYesterday: SummaryResult = {
      housing: [], yard: [], community: [], period: 'today',
      periodFrom: yesterdayFrom, periodTo: '2026-09-20T23:59:00.000Z',
      messageCount: 5, filteredCount: 5, savedMinutes: 1,
      generatedAt: '2026-09-20T23:59:00.000Z', mode: 'yandexgpt', cached: false,
    };
    const repo = repository({ findCached: vi.fn(async () => cachedFromYesterday) });
    const model = { summarize: vi.fn(async () => ({ housing: [], yard: [], community: [] })) };
    // now is 2026-09-21T04:00:00.000Z, so today midnight in Asia/Irkutsk is 2026-09-20T16:00:00.000Z...
    // Let's set a date where local midnight is different:
    const nextDay = new Date('2026-09-22T04:00:00.000Z');
    const result = await new SummaryService(repo, model, 777n, 600, () => nextDay).generate(42n, 'today');
    expect(result.cached).toBe(false);
    expect(repo.listMessages).toHaveBeenCalled();
    expect(model.summarize).toHaveBeenCalled();
  });

  it('rejects users without a verified resident profile', async () => {
    const repo = repository({ findHomeForResident: vi.fn(async () => null) });
    await expect(new SummaryService(repo, null, 777n, 600, () => now).generate(42n, 'today')).rejects.toBeInstanceOf(SummaryAccessError);
  });

  it('performs JIT membership check, revokes verifiedAt in repository and throws LEFT_CHAT when user has left the chat', async () => {
    const revokeMembership = vi.fn(async () => {});
    const repo = repository({
      findHomeForResident: vi.fn(async () => ({ id: 'home-1', timezone: 'Asia/Irkutsk', maxChatId: 777n, title: 'ЖК Уютный' })),
      revokeMembership,
    });
    const membershipChecker = { isMember: vi.fn(async () => false) };
    const service = new SummaryService(repo, null, 777n, 600, () => now, membershipChecker);

    await expect(service.generate(42n, 'today')).rejects.toThrow(SummaryAccessError);
    expect(membershipChecker.isMember).toHaveBeenCalledWith(777, 42);
    expect(revokeMembership).toHaveBeenCalledWith('home-1', 42n);
  });

  it('prompts home choice when resident belongs to multiple homes and no homeId is specified', async () => {
    const repo = repository({
      findHomesForResident: vi.fn(async () => [
        { id: 'home-1', timezone: 'Asia/Irkutsk', title: 'ЖК Северный' },
        { id: 'home-2', timezone: 'Asia/Irkutsk', title: 'ЖК Южный' },
      ]),
      findHomeById: vi.fn(async (id) => ({ id, timezone: 'Asia/Irkutsk', title: id === 'home-1' ? 'ЖК Северный' : 'ЖК Южный' })),
    });
    const model = { summarize: vi.fn(async () => ({ housing: [], yard: [], community: [] })) };
    const service = new SummaryService(repo, model, 777n, 600, () => now);

    // No homeId: should throw MultipleHomesChoiceError with both homes
    await expect(service.generate(42n, 'today')).rejects.toThrow();

    // With homeId: generates summary for the specified home
    const result = await service.generate(42n, 'today', 'home-2');
    expect(result.mode).toBe('yandexgpt');
    expect(result.homeTitle).toBe('ЖК Южный');
    expect(repo.findHomeById).toHaveBeenCalledWith('home-2', 42n);
    expect(repo.createJob).toHaveBeenCalledWith(expect.objectContaining({ homeId: 'home-2' }));
  });

  it('restores membership in repository when user has membershipVerifiedAt=null but JIT check finds them in chat', async () => {
    const verifyMembership = vi.fn(async () => {});
    const repo = repository({
      findHomeForResident: vi.fn(async () => ({
        id: 'home-1',
        timezone: 'Asia/Irkutsk',
        maxChatId: 777n,
        title: 'ЖК Уютный',
        membershipVerifiedAt: null,
      })),
      verifyMembership,
    });
    const membershipChecker = { isMember: vi.fn(async () => true) };
    const model = { summarize: vi.fn(async () => ({ housing: [], yard: [], community: [] })) };
    const service = new SummaryService(repo, model, 777n, 600, () => now, membershipChecker);

    const result = await service.generate(42n, 'today');
    expect(result.mode).toBe('yandexgpt');
    expect(result.homeTitle).toBe('ЖК Уютный');
    expect(verifyMembership).toHaveBeenCalledWith('home-1', 42n);
  });

  it('throws LEFT_CHAT when membershipVerifiedAt is null and no membershipChecker is available', async () => {
    const repo = repository({
      findHomeForResident: vi.fn(async () => ({
        id: 'home-1',
        timezone: 'Asia/Irkutsk',
        maxChatId: 777n,
        title: 'ЖК Уютный',
        chatUrl: 'https://max.ru/chat-uyut',
        membershipVerifiedAt: null,
      })),
    });
    const service = new SummaryService(repo, null, 777n, 600, () => now);

    try {
      await service.generate(42n, 'today');
      expect.fail('Expected SummaryAccessError');
    } catch (err) {
      expect(err).toBeInstanceOf(SummaryAccessError);
      const accessErr = err as SummaryAccessError;
      expect(accessErr.code).toBe('LEFT_CHAT');
      expect(accessErr.homeTitle).toBe('ЖК Уютный');
      expect(accessErr.homeChatUrl).toBe('https://max.ru/chat-uyut');
    }
  });
});
