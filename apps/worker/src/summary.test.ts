import { describe, expect, it } from 'vitest';

import {
  createFallbackSummary,
  estimateSavedMinutes,
  getSummaryPeriodRange,
  prepareSummaryMessages,
  renderSummary,
  type SummarySourceMessage,
} from './summary.js';

const at = new Date('2026-09-21T04:00:00.000Z');

function message(id: string, text: string, senderDisplayName = 'Житель'): SummarySourceMessage {
  return { id, text, senderDisplayName, sentAt: at };
}

describe('summary preparation', () => {
  it('starts today at local midnight and uses rolling 7/30 day ranges', () => {
    expect(getSummaryPeriodRange('today', at, 'Asia/Irkutsk').from.toISOString()).toBe('2026-09-20T16:00:00.000Z');
    expect(getSummaryPeriodRange('week', at, 'Asia/Irkutsk').from.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect(getSummaryPeriodRange('month', at, 'Asia/Irkutsk').from.toISOString()).toBe('2026-08-22T04:00:00.000Z');
  });

  it('removes greeting-only messages and groups short adjacent messages only above 150 inputs', () => {
    const input = Array.from({ length: 151 }, (_, index) => message(String(index), index === 0 ? 'Всем привет!' : `Сообщение ${index}`, 'Анна'));
    const prepared = prepareSummaryMessages(input);
    expect(prepared.length).toBeLessThan(150);
    expect(prepared.some((item) => item.text.includes('Всем привет'))).toBe(false);
    expect(prepared[0]?.sourceMessageIds?.length).toBeGreaterThan(1);
  });

  it('builds a deterministic three-category fallback and renders empty categories', () => {
    const categories = createFallbackSummary([
      message('1', 'В третьем подъезде сломался лифт'),
      message('2', 'На парковке будут убирать снег'),
      message('3', 'Нашли ключи у первого подъезда'),
    ]);
    expect(categories.housing[0]?.sourceMessageIds).toEqual(['1']);
    expect(categories.yard[0]?.sourceMessageIds).toEqual(['2']);
    expect(categories.community[0]?.sourceMessageIds).toEqual(['3']);

    const rendered = renderSummary({
      housing: [], yard: [], community: [], period: 'today',
      periodFrom: at.toISOString(), periodTo: at.toISOString(),
      messageCount: 0, filteredCount: 0, savedMinutes: 0,
      generatedAt: at.toISOString(), mode: 'yandexgpt', cached: false,
    });
    expect(rendered.match(/Без происшествий/g)).toHaveLength(3);
    expect(estimateSavedMinutes(60)).toBe(8);
  });

  it('keeps the MAX message below the 4000 character limit', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ text: `${index} ${'а'.repeat(500)}`, sourceMessageIds: [String(index)] }));
    const rendered = renderSummary({
      housing: items, yard: items, community: items, period: 'month',
      periodFrom: at.toISOString(), periodTo: at.toISOString(),
      messageCount: 100, filteredCount: 100, savedMinutes: 13,
      generatedAt: at.toISOString(), mode: 'yandexgpt', cached: false,
    });
    expect(rendered.length).toBeLessThanOrEqual(4_000);
  });
});
