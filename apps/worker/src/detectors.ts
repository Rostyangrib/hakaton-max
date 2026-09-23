import { normalizeCarPlate } from '@quiet-chat/shared';

export { normalizeCarPlate } from '@quiet-chat/shared';

export type TriggerType = 'apartment' | 'entrance' | 'car_plate' | 'car_description';

export interface MessageTrigger {
  type: TriggerType;
  value: string;
  label: string;
}

const colorForms: Record<string, string> = {
  белая: 'белый', белое: 'белый', белой: 'белый', белого: 'белый', белую: 'белый', белый: 'белый',
  черная: 'черный', черное: 'черный', черной: 'черный', черного: 'черный', черную: 'черный', черный: 'черный',
  чёрная: 'черный', чёрное: 'черный', чёрной: 'черный', чёрного: 'черный', чёрную: 'черный', чёрный: 'черный',
  красная: 'красный', красное: 'красный', красной: 'красный', красного: 'красный', красную: 'красный', красный: 'красный',
  синяя: 'синий', синее: 'синий', синей: 'синий', синего: 'синий', синюю: 'синий', синий: 'синий',
  зеленая: 'зеленый', зеленое: 'зеленый', зеленой: 'зеленый', зеленого: 'зеленый', зеленую: 'зеленый', зеленый: 'зеленый',
  зелёная: 'зеленый', зелёное: 'зеленый', зелёной: 'зеленый', зелёного: 'зеленый', зелёную: 'зеленый', зелёный: 'зеленый',
  серая: 'серый', серое: 'серый', серой: 'серый', серого: 'серый', серую: 'серый', серый: 'серый',
  серебристая: 'серебристый', серебристое: 'серебристый', серебристой: 'серебристый', серебристую: 'серебристый', серебристый: 'серебристый',
  бежевая: 'бежевый', бежевое: 'бежевый', бежевой: 'бежевый', бежевую: 'бежевый', бежевый: 'бежевый',
  желтая: 'желтый', желтое: 'желтый', желтой: 'желтый', желтую: 'желтый', желтый: 'желтый',
  жёлтая: 'желтый', жёлтое: 'желтый', жёлтой: 'желтый', жёлтую: 'желтый', жёлтый: 'желтый',
  оранжевая: 'оранжевый', оранжевое: 'оранжевый', оранжевой: 'оранжевый', оранжевую: 'оранжевый', оранжевый: 'оранжевый',
  коричневая: 'коричневый', коричневое: 'коричневый', коричневой: 'коричневый', коричневую: 'коричневый', коричневый: 'коричневый',
  голубая: 'голубой', голубое: 'голубой', голубой: 'голубой', голубого: 'голубой', голубую: 'голубой',
};

const carStopWords = new Set([
  'авто', 'автомобиль', 'машина', 'цвет', 'госномер', 'номер', 'седан', 'хэтчбек', 'кроссовер',
]);

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function collectNumbers(text: string, patterns: RegExp[]): string[] {
  const values = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) values.add(String(value));
    }
  }
  return [...values];
}

export function detectMessageTriggers(text: string): MessageTrigger[] {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  const apartments = collectNumbers(normalized, [
    /(?:кв(?:артир(?:а|е|у|ы|ой|ах)?|\.)?|кварт(?:ира|ире|иру|иры|а)?|кв-р(?:а|е|у|ы|ой)?)\s*(?:[№#]|no\.?)?\s*[:#-]?\s*(\d{1,4})(?!\d)/gu,
    /(?<!\d)(\d{1,4})\s*(?:-?(?:я|ая|ой|ую|й|ый|ом|ем|ей|ье))?\s*(?:кв(?:артир(?:а|е|у|ы|ой|ах)?|\.)?|кварт(?:ира|ире|иру|иры|а)?|кв-р(?:а|е|у|ы|ой)?)(?![\p{L}])/gu,
  ]);
  const entrances = collectNumbers(normalized, [
    /(?:подъезд(?:е|а|у|ом|ов)?|под\.|под-д)\s*(?:[№#]|no\.?)?\s*[:#-]?\s*(\d{1,3})(?!\d)/gu,
    /(?<!\d)(\d{1,3})\s*(?:-?(?:й|ый|ой|м|го|ем|ом))?\s*(?:подъезд(?:е|а|у|ом|ов)?|под\.|под-д)(?![\p{L}])/gu,
  ]);

  const plates = new Set<string>();
  const platePattern = /(?<![\p{L}\d])([АВЕКМНОРСТУХABEKMHOPCTYX])\s*(\d{3})\s*([АВЕКМНОРСТУХABEKMHOPCTYX]{2})\s*(\d{2,3})(?!\d)/giu;
  for (const match of text.matchAll(platePattern)) {
    const plate = normalizeCarPlate(`${match[1]}${match[2]}${match[3]}${match[4]}`);
    if (plate) plates.add(plate);
  }

  return [
    ...apartments.map((value) => ({ type: 'apartment' as const, value, label: `квартира ${value}` })),
    ...entrances.map((value) => ({ type: 'entrance' as const, value, label: `подъезд ${value}` })),
    ...[...plates].map((value) => ({ type: 'car_plate' as const, value, label: `автомобиль ${value}` })),
  ];
}

function words(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function matchCarDescription(messageText: string, description: string | null): MessageTrigger | null {
  if (!description) return null;
  const profileWords = words(description);
  const profileColors = new Set(profileWords.map((word) => colorForms[word]).filter((word): word is string => Boolean(word)));
  const models = new Set(profileWords.filter((word) => !colorForms[word] && !carStopWords.has(word) && word.length >= 3));
  if (profileColors.size === 0 || models.size === 0) return null;

  const messageWords = words(messageText);
  const messageColors = new Set(messageWords.map((word) => colorForms[word]).filter((word): word is string => Boolean(word)));
  const hasColor = [...profileColors].some((color) => messageColors.has(color));
  const matchedModel = [...models].find((model) => messageWords.includes(model));
  if (!hasColor || !matchedModel) return null;

  const value = `${[...profileColors].sort().join('+')}:${[...models].sort().join('+')}`.slice(0, 100);
  return { type: 'car_description', value, label: description.trim() };
}

export function triggerMatchesProfile(
  trigger: MessageTrigger,
  profile: { apartment: number; entrance: number; carPlateNormalized: string | null },
): boolean {
  if (trigger.type === 'apartment') return trigger.value === String(profile.apartment);
  if (trigger.type === 'entrance') return trigger.value === String(profile.entrance);
  if (trigger.type === 'car_plate') return trigger.value === profile.carPlateNormalized;
  return false;
}
