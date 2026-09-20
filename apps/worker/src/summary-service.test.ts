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

  it('rejects users without a verified resident profile', async () => {
    const repo = repository({ findHomeForResident: vi.fn(async () => null) });
    await expect(new SummaryService(repo, null, 777n, 600, () => now).generate(42n, 'today')).rejects.toBeInstanceOf(SummaryAccessError);
  });
});
