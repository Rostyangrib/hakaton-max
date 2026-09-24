import type { SummaryCategories, SummaryItem, SummaryPeriod, SummaryResult } from '@quiet-chat/shared';

export interface SummarySourceMessage {
  id: string;
  sourceMessageIds?: string[];
  senderDisplayName: string;
  text: string;
  sentAt: Date;
}

const greetingOnly = /^(?:всем\s+)?(?:привет|доброе\s+утро|добрый\s+(?:день|вечер)|здравствуйте|спасибо|благодарю)[!,.\s]*$/iu;

const categoryKeywords: Record<keyof SummaryCategories, RegExp> = {
  housing: /(?:вод[ауы]|свет|электр|отоплен|лифт|труб|протеч|авари|ремонт|сантех|электрик|газ|служб|отключ)\w*/iu,
  yard: /(?:двор|парков|машин|автомоб|шлагбаум|снег|уборк|эвакуатор|проезд|дорог|мусор)\w*/iu,
  community: /(?:ключ|наш[её]л|потерял|помощ|опрос|собрани|решени|сосед|голосован|объявлен)\w*/iu,
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

export function prepareSummaryMessages(messages: SummarySourceMessage[]): SummarySourceMessage[] {
  const cleaned = messages.filter((message) => !greetingOnly.test(message.text.trim()));
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
  for (const message of messages) {
    for (const category of Object.keys(categoryKeywords) as (keyof SummaryCategories)[]) {
      if (result[category].length >= 5 || !categoryKeywords[category].test(message.text)) continue;
      result[category].push({ text: message.text.trim().slice(0, 500), sourceMessageIds: message.sourceMessageIds ?? [message.id] });
      break;
    }
  }
  return result;
}

export function assertValidSources(categories: SummaryCategories, allowedIds: Set<string>): SummaryCategories {
  const allowedList = [...allowedIds];
  const validate = (items: SummaryItem[]) => items.map((item) => {
    const resolved = item.sourceMessageIds.map((id) => {
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
    return { ...item, sourceMessageIds };
  });
  return { housing: validate(categories.housing), yard: validate(categories.yard), community: validate(categories.community) };
}

function renderCategory(title: string, items: SummaryItem[]): string[] {
  return [title, ...(items.length ? items.slice(0, 5).map((item) => `• ${item.text.slice(0, 200)}`) : ['Без происшествий'])];
}

export function renderSummary(result: SummaryResult): string {
  const periodLabels: Record<SummaryPeriod, string> = { today: 'сегодня', week: 'последние 7 дней', month: 'последние 30 дней' };
  const header = `**Сводка за ${periodLabels[result.period]}**`;

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
