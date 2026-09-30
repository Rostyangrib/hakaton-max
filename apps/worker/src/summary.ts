import type { SummaryCategories, SummaryItem, SummaryPeriod, SummaryResult } from '@quiet-chat/shared';

export interface SummarySourceMessage {
  id: string;
  sourceMessageIds?: string[];
  senderDisplayName: string;
  text: string;
  sentAt: Date;
}

const greetingOnly = /^(?:всем\s+)?(?:привет|доброе\s+утро|добрый\s+(?:день|вечер)|здравствуйте|спасибо|благодарю)[!,.\s]*$/iu;

const spamTrollFilter = /^(?:дайте\s+контакт\s+альтушки|кто\s+(?:может\s+)?скинуть\s+тг\s+дающей\s+альтушки\??|павел\s+спит\s+с\s+моей\s+девушкой|кто\s+может\s+одолжить\s+соли\??)[!,.\s]*$/iu;

export const categoryKeywords: Record<keyof SummaryCategories, RegExp> = {
  housing: /(?:вод[ауые]|свет|электр|отоплен|лифт|труб|протеч|протек|авари|ремонт|сантех|электрик|газ|служб|отключ|топ[яи]|затоп|залив|капает|прорв|стояк|батаре|давлен|котельн|подвал|кровл|крыш|канализац|мусоропровод|домофон|засор|вентшахт|вентиляц)\w*/iu,
  yard: /(?:двор|парков|машин|автомоб|шлагбаум|снег|уборк|эвакуатор|проезд|дорог|мусор|выезд|перекрыл|тротуар|газон|колес|колёс|сигнализац|сугроб|трактор|тачка|госномер|номер[ае]?|камри|солярис|рио|грант|веста|лада|бмв|мерс|ауди|вольво|тиида|тигуан|ваз|шкода|киа|хенда|ниссан|мазда|форд|рено|лексус|рав4|крузак|газель)\w*/iu,
  community: /(?:ключ|наш[её]л|потерял|помощ|опрос|собрани|решени|сосед|голосован|объявлен|шум|музык|детск|площадк|тамбур|подъезд|коляск|велосипед|документ|карт[аы]|найден)\w*/iu,
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  const keys: Array<keyof ZonedParts> = ['year', 'month', 'day', 'hour', 'minute', 'second'];
  if (keys.some((key) => !Number.isInteger(values[key]))) throw new Error(`Unable to calculate date in timezone ${timezone}`);
  return values as unknown as ZonedParts;
}

function localMidnightUtc(now: Date, timezone: string): Date {
  const local = zonedParts(now, timezone);
  const desiredAsUtc = Date.UTC(local.year, local.month - 1, local.day);
  let candidate = new Date(desiredAsUtc);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const actual = zonedParts(candidate, timezone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate = new Date(candidate.getTime() + desiredAsUtc - actualAsUtc);
  }
  return candidate;
}

export function getSummaryPeriodRange(period: SummaryPeriod, now: Date, timezone: string) {
  const to = new Date(now);
  if (period === 'today') return { from: localMidnightUtc(now, timezone), to };
  const days = period === 'week' ? 7 : 30;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1_000), to };
}

export function cleanItemText(rawText: string): { cleanText: string; extractedIds: string[] } {
  const extractedIds: string[] = [];

  // Extract bracketed UUIDs, short IDs, or comma/space-separated combinations: e.g. [0d55612f...], [1], [#2]
  let text = rawText.replace(/\[([^\]]+)\]/g, (_match, group: string) => {
    const parts = group.split(/[,\s]+/).map((s) => s.trim().replace(/^#+/, '')).filter(Boolean);
    for (const part of parts) {
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) ||
        /^[0-9a-f]{8,}$/i.test(part) ||
        /^(?:m|#)?\d+$/i.test(part)
      ) {
        extractedIds.push(part);
      }
    }
    return '';
  });

  // Strip bare UUIDs that might not be in brackets
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (match) => {
    extractedIds.push(match);
    return '';
  });

  // Clean up punctuation and whitespace artifacts
  text = text
    .replace(/\s*([,;:])\s*([,;.!?])/g, '$2')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading/dangling punctuation
  text = text.replace(/^[,;:.!?\-—\s]+/, '').trim();
  text = text.replace(/[,;:\s]+$/, '').trim();

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return { cleanText: text, extractedIds };
}

const housingKeywordsForRebalancing = /(?:водоснабжен|отоплен|канализац|сантехник|электрик|протеч|протек|аварийн|затоп|залив|капает|прорв|стояк|батаре|топ[яи])\w*/iu;
const yardKeywordsForRebalancing = /(?:парковк|стоянк|автомоб|шлагбаум|эвакуатор|перекрыл|заблокиров|тротуар|газон|госномер|камри|солярис|рио|веста|бмв|мерс|ауди|вольво|тиида|тигуан)\w*/iu;

export function deduplicateAndCleanCategories(categories: SummaryCategories): SummaryCategories {
  const categoryOrder: Array<keyof SummaryCategories> = ['housing', 'yard', 'community'];
  const seenTexts = new Set<string>();
  const seenSourceIds = new Set<string>();
  const result: SummaryCategories = { housing: [], yard: [], community: [] };

  const rebalancedHousing = [...(categories.housing ?? [])];
  const rebalancedYard: SummaryItem[] = [];
  const rebalancedCommunity: SummaryItem[] = [];

  for (const item of categories.yard ?? []) {
    const { cleanText } = cleanItemText(item.text);
    if (!cleanText) continue;
    if (housingKeywordsForRebalancing.test(cleanText)) {
      rebalancedHousing.push(item);
    } else {
      rebalancedYard.push(item);
    }
  }

  for (const item of categories.community ?? []) {
    const { cleanText } = cleanItemText(item.text);
    if (!cleanText) continue;
    if (housingKeywordsForRebalancing.test(cleanText)) {
      rebalancedHousing.push(item);
    } else if (yardKeywordsForRebalancing.test(cleanText)) {
      rebalancedYard.push(item);
    } else {
      rebalancedCommunity.push(item);
    }
  }

  const pool: SummaryCategories = {
    housing: rebalancedHousing,
    yard: rebalancedYard,
    community: rebalancedCommunity,
  };

  for (const category of categoryOrder) {
    const items = pool[category] ?? [];
    for (const item of items) {
      const { cleanText, extractedIds } = cleanItemText(item.text);
      if (!cleanText) continue;

      const norm = cleanText.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
      if (norm.length > 0 && seenTexts.has(norm)) {
        continue;
      }

      const allIds = [...new Set([...(item.sourceMessageIds ?? []), ...extractedIds])];
      if (allIds.length > 0 && allIds.every((id) => seenSourceIds.has(id))) {
        // All sources were already covered by a higher-priority category item
        continue;
      }

      if (norm.length > 0) {
        seenTexts.add(norm);
      }
      for (const id of allIds) {
        seenSourceIds.add(id);
      }

      result[category].push({
        text: cleanText.slice(0, 500),
        sourceMessageIds: allIds.length > 0 ? allIds.slice(0, 20) : ['1'],
      });
    }
    result[category] = result[category].slice(0, 10);
  }

  return result;
}

export function prepareSummaryMessages(messages: SummarySourceMessage[]): SummarySourceMessage[] {
  const cleaned = messages.filter((message) => {
    const trimmed = message.text.trim();
    if (greetingOnly.test(trimmed)) return false;
    if (spamTrollFilter.test(trimmed)) return false;
    return true;
  });
  if (messages.length <= 150) return cleaned;

  const grouped: SummarySourceMessage[] = [];
  for (const message of cleaned) {
    const previous = grouped.at(-1);
    if (previous && previous.senderDisplayName === message.senderDisplayName && previous.text.length < 220 && message.text.length < 220 && previous.text.length + message.text.length <= 500) {
      previous.text = `${previous.text} / ${message.text}`;
      previous.sourceMessageIds = [...(previous.sourceMessageIds ?? [previous.id]), message.id];
    } else {
      grouped.push({ ...message });
    }
  }
  return grouped;
}

export function chunkSummaryMessages(messages: SummarySourceMessage[], size = 75): SummarySourceMessage[][] {
  const chunks: SummarySourceMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) chunks.push(messages.slice(index, index + size));
  return chunks;
}

export function createFallbackSummary(messages: SummarySourceMessage[]): SummaryCategories {
  const result: SummaryCategories = { housing: [], yard: [], community: [] };
  const categories: (keyof SummaryCategories)[] = ['housing', 'yard', 'community'];

  for (const message of messages) {
    for (const category of categories) {
      if (result[category].length >= 5 || !categoryKeywords[category].test(message.text)) continue;
      const { cleanText } = cleanItemText(message.text);
      result[category].push({
        text: cleanText.slice(0, 500),
        sourceMessageIds: message.sourceMessageIds ?? [message.id],
      });
      break;
    }
  }
  return deduplicateAndCleanCategories(result);
}

export function assertValidSources(categories: SummaryCategories, allowedIds: Set<string>): SummaryCategories {
  const allowedList = [...allowedIds];
  const validate = (items: SummaryItem[]) => items.map((item) => {
    const { cleanText, extractedIds } = cleanItemText(item.text);
    const combined = [...(item.sourceMessageIds ?? []), ...extractedIds];
    const resolved = combined.map((rawId) => {
      const id = String(rawId).replace(/^[[#\s]+|[\]\s]+$/g, '').trim();
      if (!id) return null;
      if (allowedIds.has(id)) return id;
      const prefix = allowedList.find((allowed) => allowed.startsWith(id) || id.startsWith(allowed));
      if (prefix) return prefix;
      const match = id.match(/^(?:m|#)?(\d+)$/i);
      if (match) {
        const index = parseInt(match[1]!, 10) - 1;
        if (index >= 0 && index < allowedList.length) return allowedList[index]!;
      }
      return null;
    }).filter((id): id is string => id !== null);

    const sourceMessageIds = [...new Set(resolved)];
    if (sourceMessageIds.length === 0) {
      throw new Error('YandexGPT returned an unknown source message id');
    }
    return { text: cleanText, sourceMessageIds };
  });

  const validated: SummaryCategories = {
    housing: validate(categories.housing),
    yard: validate(categories.yard),
    community: validate(categories.community),
  };
  return deduplicateAndCleanCategories(validated);
}

function renderCategory(title: string, items: SummaryItem[]): string[] {
  return [
    title,
    ...(items.length
      ? items.slice(0, 5).map((item) => {
          const { cleanText } = cleanItemText(item.text);
          return `• ${cleanText.slice(0, 200)}`;
        })
      : ['Без происшествий']),
  ];
}

export function renderSummary(result: SummaryResult, homeTitle?: string): string {
  const periodLabels: Record<SummaryPeriod, string> = { today: 'сегодня', week: 'последние 7 дней', month: 'последние 30 дней' };
  const title = homeTitle || result.homeTitle;
  const header = title
    ? `**Сводка по дому «${title}» за ${periodLabels[result.period]}**`
    : `**Сводка за ${periodLabels[result.period]}**`;

  return [
    header, '',
    ...renderCategory('🔴 **ЖКХ и аварии**', result.housing), '',
    ...renderCategory('🟡 **Двор и транспорт**', result.yard), '',
    ...renderCategory('🟢 **Соседские дела и находки**', result.community), '',
    `📊 Отфильтровано ${result.filteredCount} сообщений. Сэкономлено ~${result.savedMinutes} мин.`,
    result.mode === 'fallback' ? '_Резервная сводка: AI временно недоступен._' : '',
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n');
}

export function estimateSavedMinutes(messageCount: number): number {
  return messageCount === 0 ? 0 : Math.max(1, Math.round(messageCount * 8 / 60));
}
