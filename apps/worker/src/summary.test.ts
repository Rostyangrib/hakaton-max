import { describe, expect, it } from 'vitest';

import {
  cleanItemText,
  createFallbackSummary,
  deduplicateAndCleanCategories,
  estimateSavedMinutes,
  getSummaryPeriodRange,
  prepareSummaryMessages,
  renderSummary,
  renderSummaryPages,
  type SummarySourceMessage,
} from './summary.js';

const at = new Date('2026-09-21T04:00:00.000Z');

function message(id: string, text: string, senderDisplayName = 'Житель'): SummarySourceMessage {
  return { id, text, senderDisplayName, sentAt: at };
}

describe('summary coverage regressions', () => {
  it.each([
    ['Сегодня травят тараканов', 'housing'],
    ['Внимание: сегодня будет проведена санитарная обработка от насекомых', 'housing'],
    ['Сегодня перекрывают лестницы', 'housing'],
    ['Необходимо сдать 2500 на благоустройство двора', 'yard'],
    ['Кто из жильцов может посидеть с ребенком', 'community'],
    ['Необходимо сдать деньги на ремонт', 'housing'],
    ['В пятницу дезинсекция с 10:00 до 12:00', 'housing'],
    ['Дератизация подвала перенесена на завтра', 'housing'],
    ['Обработка от клопов отменена', 'housing'],
    ['Сдать 1500 рублей на ремонт до 5 октября', 'housing'],
    ['Сбор средств на праздник до пятницы', 'community'],
    ['Взносы на охрану — 500 рублей', 'community'],
    ['Собрание собственников завтра в 19:00', 'community'],
    ['Найдены документы в подъезде', 'community'],
    ['Просьба убрать машины, завтра уборка снега', 'yard'],
    ['В подвале обнаружена плесень', 'housing'],
  ] as const)('retains announcement: %s', (text, category) => {
    const result = createFallbackSummary([message('event', text)]);
    expect(result[category]).toEqual([{ text, sourceMessageIds: ['event'] }]);
  });

  it('keeps distinct facts from the same source and facts differing by amount, apartment or negation', () => {
    const texts = ['Сдать 500 рублей на ремонт', 'Сдать 1500 рублей на ремонт',
      'В квартире 54 капает труба', 'В квартире 93 капает труба',
      'Сегодня травят тараканов', 'Сегодня не травят тараканов'];
    const result = deduplicateAndCleanCategories({
      housing: texts.map((text) => ({ text, sourceMessageIds: ['one'] })), yard: [], community: [],
    });
    expect(result.housing.map((item) => item.text)).toEqual(texts);
  });

  it('keeps multiple categories from a single source without inventing ids', () => {
    const result = createFallbackSummary([message('only-id', 'Сегодня травят тараканов; Необходимо сдать деньги на ремонт; Найдены ключи')]);
    expect(result.housing).toHaveLength(2);
    expect(result.community).toHaveLength(1);
    expect(Object.values(result).flat().every((item) => item.sourceMessageIds.join() === 'only-id')).toBe(true);
  });

  it('preserves factual messages containing a noise keyword and strips pure noise', () => {
    const result = createFallbackSummary([message('noise', 'Спасибо!'), message('fact', 'В подвале ремонт, найдены закладки')]);
    expect(result.housing).toHaveLength(1);
    expect(result.housing[0]?.sourceMessageIds).toEqual(['fact']);
  });

  it('preserves all 160 distinct events through preparation, fallback and paginated rendering', () => {
    const input = Array.from({ length: 160 }, (_, i) => message(`event-${i}`, `Ремонт в квартире ${i + 1}, взнос ${i + 500} рублей до 5 октября`));
    const categories = createFallbackSummary(prepareSummaryMessages(input));
    expect(categories.housing).toHaveLength(160);
    const pages = renderSummaryPages({ ...categories, period: 'month', periodFrom: at.toISOString(), periodTo: at.toISOString(),
      generatedAt: at.toISOString(), messageCount: 160, filteredCount: 0, savedMinutes: 1, mode: 'fallback', cached: false });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 4000)).toBe(true);
    for (const item of input) expect(pages.join('\n')).toContain(item.text);
  });

  it('preserves non-citation brackets and parenthesized amounts', () => {
    expect(cleanItemText('Ремонт [перенесён] — взнос (500 рублей)').cleanText).toBe('Ремонт [перенесён] — взнос (500 рублей)');
  });
});

describe('summary preparation', () => {
  it('starts today at local midnight and uses rolling 7/30 day ranges', () => {
    expect(getSummaryPeriodRange('today', at, 'Asia/Irkutsk').from.toISOString()).toBe('2026-09-20T16:00:00.000Z');
    expect(getSummaryPeriodRange('week', at, 'Asia/Irkutsk').from.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect(getSummaryPeriodRange('month', at, 'Asia/Irkutsk').from.toISOString()).toBe('2026-08-22T04:00:00.000Z');
  });

  it('removes greetings without merging unrelated facts or authors with identical display names', () => {
    const input = Array.from({ length: 151 }, (_, index) => message(String(index), index === 0 ? 'Всем привет!' : `Сообщение ${index}`, 'Анна'));
    const prepared = prepareSummaryMessages(input);
    expect(prepared).toHaveLength(150);
    expect(prepared.some((item) => item.text.includes('Всем привет'))).toBe(false);
    expect(prepared.map((item) => item.id)).toEqual(input.slice(1).map((item) => item.id));
  });

  it('filters out spam and provocative trolling messages that trigger AI content filters', () => {
    const input = [
      message('1', 'Всем привет!'),
      message('2', 'дайте контакт альтушки'),
      message('3', 'кто может скинуть тг дающей альтушки?'),
      message('4', 'павел спит с моей девушкой'),
      message('5', 'кто может одолжить соли?'),
      message('6', 'В третьем подъезде сломался домофон'),
    ];
    const prepared = prepareSummaryMessages(input);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.id).toBe('6');
    expect(prepared[0]?.text).toContain('сломался домофон');
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

describe('cleanItemText and citation stripping', () => {
  it('strips UUID brackets and normalizes punctuation', () => {
    const raw = 'Замечания по парковке автомобилей [0d55612f-bf7a-43a1-ba75-269c55939522], [4289508e-0cee-4a9e-9613-82c5bdd3834e].';
    const { cleanText, extractedIds } = cleanItemText(raw);
    expect(cleanText).toBe('Замечания по парковке автомобилей.');
    expect(extractedIds).toEqual(['0d55612f-bf7a-43a1-ba75-269c55939522', '4289508e-0cee-4a9e-9613-82c5bdd3834e']);
  });

  it('strips short IDs like [1], [#2], [m3] and bare UUIDs', () => {
    const raw = 'Соседи жалуются на затопление [1], в подъезде найдены ключи [#2]';
    const { cleanText, extractedIds } = cleanItemText(raw);
    expect(cleanText).toBe('Соседи жалуются на затопление, в подъезде найдены ключи');
    expect(extractedIds).toEqual(['1', '2']);
  });

  it('renderSummary strips any bracketed citations if present in raw item text', () => {
    const rendered = renderSummary({
      housing: [],
      yard: [{ text: 'Замечания по парковке автомобилей [0d55612f-bf7a-43a1-ba75-269c55939522].', sourceMessageIds: ['0d55612f-bf7a-43a1-ba75-269c55939522'] }],
      community: [],
      period: 'today',
      periodFrom: at.toISOString(),
      periodTo: at.toISOString(),
      messageCount: 1,
      filteredCount: 1,
      savedMinutes: 1,
      generatedAt: at.toISOString(),
      mode: 'yandexgpt',
      cached: false,
      homeTitle: 'Тест 2',
    });
    expect(rendered).toContain('• Замечания по парковке автомобилей.');
    expect(rendered).not.toContain('0d55612f');
    expect(rendered).not.toContain('[');
  });
});

describe('deduplicateAndCleanCategories and cross-category exclusivity', () => {
  it('strictly enforces category priority and prevents duplicates across categories', () => {
    const rawCategories = {
      housing: [
        { text: '67 квартира вы топите соседей снизу', sourceMessageIds: ['m1'] },
      ],
      yard: [
        { text: 'Красный вольво стоит в неположенном месте', sourceMessageIds: ['m2'] },
        { text: 'Бежевая тиида стоит на тротуаре', sourceMessageIds: ['m3'] },
      ],
      community: [
        { text: '67 квартира вы топите соседей снизу', sourceMessageIds: ['m1'] },
        { text: 'чёрный карандаш мешает моей жене выехать', sourceMessageIds: ['m4'] },
        { text: 'Красный вольво стоит в неположенном месте', sourceMessageIds: ['m2'] },
        { text: 'Бежевая тиида стоит на тротуаре', sourceMessageIds: ['m3'] },
        { text: 'Нашел ключи в подъезде', sourceMessageIds: ['m5'] },
      ],
    };

    const cleaned = deduplicateAndCleanCategories(rawCategories);

    // Housing keeps the leak
    expect(cleaned.housing).toHaveLength(1);
    expect(cleaned.housing[0]?.text).toContain('67 квартира');

    // Yard keeps parking
    expect(cleaned.yard).toHaveLength(2);
    expect(cleaned.yard.some((item) => item.text.includes('вольво'))).toBe(true);
    expect(cleaned.yard.some((item) => item.text.includes('тиида'))).toBe(true);

    // Community must NOT have duplicates of m1, m2, m3
    expect(cleaned.community.some((item) => item.text.includes('67 квартира'))).toBe(false);
    expect(cleaned.community.some((item) => item.text.includes('вольво'))).toBe(false);
    expect(cleaned.community.some((item) => item.text.includes('тиида'))).toBe(false);

    // Community keeps unique neighbor issues
    expect(cleaned.community.some((item) => item.text.includes('карандаш'))).toBe(true);
    expect(cleaned.community.some((item) => item.text.includes('ключи'))).toBe(true);
  });

  it('fallback accurately categorizes leaks into housing and car brands into yard without duplication', () => {
    const rawMessages: SummarySourceMessage[] = [
      message('1', '67 квартира вы топите соседей снизу'),
      message('2', 'Соседская камри уже меня достала'),
      message('3', 'Красный вольво стоит в неположенном месте'),
      message('4', 'Бежевая тиида стоит на тротуаре'),
      message('5', 'Нашел ключи в подъезде'),
    ];

    const fallback = createFallbackSummary(rawMessages);

    expect(fallback.housing).toHaveLength(1);
    expect(fallback.housing[0]?.text).toContain('67 квартира');

    expect(fallback.yard).toHaveLength(3);
    expect(fallback.yard.some((i) => i.text.includes('камри'))).toBe(true);
    expect(fallback.yard.some((i) => i.text.includes('вольво'))).toBe(true);
    expect(fallback.yard.some((i) => i.text.includes('тиида'))).toBe(true);

    expect(fallback.community).toHaveLength(1);
    expect(fallback.community[0]?.text).toContain('ключи');
  });

  it('rebalances items placed in community to housing or yard when text clearly indicates utilities or parking', () => {
    const rawCategories = {
      housing: [],
      yard: [],
      community: [
        { text: '67 квартира топит соседей снизу', sourceMessageIds: ['m1'] },
        { text: 'Бежевая тиида стоит на тротуаре', sourceMessageIds: ['m2'] },
        { text: 'В подъезде найдены ключи от домофона', sourceMessageIds: ['m3'] },
      ],
    };

    const cleaned = deduplicateAndCleanCategories(rawCategories);

    expect(cleaned.housing).toHaveLength(1);
    expect(cleaned.housing[0]?.text).toBe('67 квартира топит соседей снизу');
    expect(cleaned.yard).toHaveLength(1);
    expect(cleaned.yard[0]?.text).toBe('Бежевая тиида стоит на тротуаре');
    expect(cleaned.community).toHaveLength(1);
    expect(cleaned.community[0]?.text).toBe('В подъезде найдены ключи от домофона');
  });

  it('rebalances transport from community to yard category', () => {
    const rawCategories = {
      housing: [],
      yard: [],
      community: [
        { text: 'Замечания по транспорту во дворе', sourceMessageIds: ['m1'] },
        { text: 'Собрание жильцов дома в воскресенье', sourceMessageIds: ['m2'] },
      ],
    };

    const cleaned = deduplicateAndCleanCategories(rawCategories);

    expect(cleaned.housing).toHaveLength(0);
    expect(cleaned.yard).toHaveLength(1);
    expect(cleaned.yard[0]?.text).toBe('Замечания по транспорту во дворе');
    expect(cleaned.community).toHaveLength(1);
    expect(cleaned.community[0]?.text).toBe('Собрание жильцов дома в воскресенье');
  });

  it('splits compound item combining flooding complaint and found keys into housing and community', () => {
    const rawCategories = {
      housing: [],
      yard: [],
      community: [
        {
          text: 'Соседи жалуются на затопление [22919a14-0f27-42dc-9607-7016cc48217a], в подъезде найдены ключи [6a2ba82b-f574-4403-924b-4e66f4ba20b2].',
          sourceMessageIds: ['22919a14-0f27-42dc-9607-7016cc48217a', '6a2ba82b-f574-4403-924b-4e66f4ba20b2'],
        },
      ],
    };

    const cleaned = deduplicateAndCleanCategories(rawCategories);

    expect(cleaned.housing).toHaveLength(1);
    expect(cleaned.housing[0]?.text).toContain('Соседи жалуются на затопление');
    expect(cleaned.community).toHaveLength(1);
    expect(cleaned.community[0]?.text).toContain('В подъезде найдены ключи');
  });

  it('eliminates exact repeated facts across categories', () => {
    const rawCategories = {
      housing: [
        { text: '67 квартира вы топите соседей снизу', sourceMessageIds: ['m1'] },
      ],
      yard: [],
      community: [
        { text: '67 квартира вы топите соседей снизу', sourceMessageIds: ['m1'] },
      ],
    };

    const cleaned = deduplicateAndCleanCategories(rawCategories);
    expect(cleaned.housing).toHaveLength(1);
    expect(cleaned.housing[0]?.text).toBe('67 квартира вы топите соседей снизу');
    expect(cleaned.community).toHaveLength(0);
  });

  it('strips parenthesized citations like (сообщение 1) and cleans empty parentheses', () => {
    const raw = cleanItemText('Замечания по парковке (сообщения 1, 2).');
    expect(raw.cleanText).toBe('Замечания по парковке.');
  });
});


