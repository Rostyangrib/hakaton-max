import { describe, expect, it, vi } from 'vitest';

import { PostgresMessageRepository } from './postgres-message-repository.js';
import { PostgresSummaryRepository } from './postgres-summary-repository.js';

describe('Postgres repositories', () => {
  it('findAlertProfiles does not filter out sender user id', async () => {
    const mockWhere = vi.fn().mockReturnValue(Promise.resolve([
      {
        id: 'p-1',
        maxUserId: 215608884n,
        apartment: 54,
        entrance: 3,
        carPlateNormalized: null,
        carDescription: null,
      },
    ]));
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    const fakeDb = {
      db: { select: mockSelect },
      pool: { query: vi.fn(), connect: vi.fn() },
    } as any;

    const repo = new PostgresMessageRepository(fakeDb, 'Asia/Irkutsk');
    const profiles = await repo.findAlertProfiles('home-uuid', 215608884n);

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.maxUserId).toBe(215608884n);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });

  it('findCached queries summary_jobs and validates message freshness in the period', async () => {
    const validResult = {
      housing: [{ text: 'Отключение воды', sourceMessageIds: ['m1'] }],
      yard: [],
      community: [],
      period: 'today' as const,
      periodFrom: '2026-09-23T00:00:00.000Z',
      periodTo: '2026-09-23T10:00:00.000Z',
      messageCount: 5,
      filteredCount: 5,
      savedMinutes: 1,
      generatedAt: '2026-09-23T10:00:00.000Z',
      mode: 'yandexgpt' as const,
      cached: false,
    };

    const mockQuery = vi.fn(async (query: string, _params: unknown[]) => {
      // Verify SQL contains the freshness and message count verification
      expect(query).toContain('not exists');
      expect(query).toContain('m.home_id = sj.home_id');
      expect(query).toContain('m.sent_at >= sj.period_from');
      expect(query).toContain('sj.message_count');
      return { rows: [{ result: validResult }] };
    });

    const fakeDb = {
      db: {},
      pool: { query: mockQuery },
    } as any;

    const repo = new PostgresSummaryRepository(fakeDb);
    const cached = await repo.findCached('home-uuid', 215608884n, 'today', new Date('2026-09-23T09:50:00.000Z'));

    expect(cached).not.toBeNull();
    expect(cached?.period).toBe('today');
    expect(cached?.messageCount).toBe(5);
    expect(mockQuery).toHaveBeenCalled();
  });

  it('findCached returns null when query returns empty rows (invalidated cache)', async () => {
    const mockQuery = vi.fn(async () => ({ rows: [] }));

    const fakeDb = {
      db: {},
      pool: { query: mockQuery },
    } as any;

    const repo = new PostgresSummaryRepository(fakeDb);
    const cached = await repo.findCached('home-uuid', 215608884n, 'today', new Date('2026-09-23T09:50:00.000Z'));

    expect(cached).toBeNull();
  });
});
