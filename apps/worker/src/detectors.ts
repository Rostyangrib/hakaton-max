import { matchPlates, normalizeCarPlate } from '@quiet-chat/shared';

export { matchPlates, normalizeCarPlate } from '@quiet-chat/shared';

export type TriggerType = 'apartment' | 'entrance' | 'car_plate' | 'car_description';

export interface MessageTrigger {
  type: TriggerType;
  value: string;
  label: string;
}

const colorForms: Record<string, string> = {
  белая: 'белый', белое: 'белый', белой: 'белый', белого: 'белый', белую: 'белый', белый: 'белый', белом: 'белый', белым: 'белый', белыми: 'белый', белых: 'белый', белые: 'белый',
  черная: 'черный', черное: 'черный', черной: 'черный', черного: 'черный', черную: 'черный', черный: 'черный', черном: 'черный', черным: 'черный', черными: 'черный', черных: 'черный', черные: 'черный',
  чёрная: 'черный', чёрное: 'черный', чёрной: 'черный', чёрного: 'черный', чёрную: 'черный', чёрный: 'черный', чёрном: 'черный', чёрным: 'черный', чёрными: 'черный', чёрных: 'черный', чёрные: 'черный',
  красная: 'красный', красное: 'красный', красной: 'красный', красного: 'красный', красную: 'красный', красный: 'красный', красном: 'красный', красным: 'красный', красными: 'красный', красных: 'красный', красные: 'красный',
  синяя: 'синий', синее: 'синий', синей: 'синий', синего: 'синий', синюю: 'синий', синий: 'синий', синем: 'синий', синим: 'синий', синими: 'синий', синих: 'синий', синие: 'синий',
  зеленая: 'зеленый', зеленое: 'зеленый', зеленой: 'зеленый', зеленого: 'зеленый', зеленую: 'зеленый', зеленый: 'зеленый', зеленом: 'зеленый', зеленым: 'зеленый', зелеными: 'зеленый', зеленых: 'зеленый', зеленые: 'зеленый',
  зелёная: 'зеленый', зелёное: 'зеленый', зелёной: 'зеленый', зелёного: 'зеленый', зелёную: 'зеленый', зелёный: 'зеленый', зелёном: 'зеленый', зелёным: 'зеленый', зелёными: 'зеленый', зелёных: 'зеленый', зелёные: 'зеленый',
  серая: 'серый', серое: 'серый', серой: 'серый', серого: 'серый', серую: 'серый', серый: 'серый', сером: 'серый', серым: 'серый', серыми: 'серый', серых: 'серый', серые: 'серый',
  серебристая: 'серебристый', серебристое: 'серебристый', серебристой: 'серебристый', серебристую: 'серебристый', серебристый: 'серебристый', серебристом: 'серебристый', серебристым: 'серебристый', серебристыми: 'серебристый', серебристых: 'серебристый', серебристые: 'серебристый',
  бежевая: 'бежевый', бежевое: 'бежевый', бежевой: 'бежевый', бежевую: 'бежевый', бежевый: 'бежевый', бежевом: 'бежевый', бежевым: 'бежевый', бежевыми: 'бежевый', бежевых: 'бежевый', бежевые: 'бежевый',
  желтая: 'желтый', желтое: 'желтый', желтой: 'желтый', желтую: 'желтый', желтый: 'желтый', желтом: 'желтый', желтым: 'желтый', желтыми: 'желтый', желтых: 'желтый', желтые: 'желтый',
  жёлтая: 'желтый', жёлтое: 'желтый', жёлтой: 'желтый', жёлтую: 'желтый', жёлтый: 'желтый', жёлтом: 'желтый', жёлтым: 'желтый', жёлтыми: 'желтый', жёлтых: 'желтый', жёлтые: 'желтый',
  оранжевая: 'оранжевый', оранжевое: 'оранжевый', оранжевой: 'оранжевый', оранжевую: 'оранжевый', оранжевый: 'оранжевый', оранжевом: 'оранжевый', оранжевым: 'оранжевый', оранжевыми: 'оранжевый', оранжевых: 'оранжевый', оранжевые: 'оранжевый',
  коричневая: 'коричневый', коричневое: 'коричневый', коричневой: 'коричневый', коричневую: 'коричневый', коричневый: 'коричневый', коричневом: 'коричневый', коричневым: 'коричневый', коричневыми: 'коричневый', коричневых: 'коричневый', коричневые: 'коричневый',
  голубая: 'голубой', голубое: 'голубой', голубой: 'голубой', голубого: 'голубой', голубую: 'голубой', голубом: 'голубой', голубым: 'голубой', голубыми: 'голубой', голубых: 'голубой', голубые: 'голубой',
  темная: 'темный', темное: 'темный', темной: 'темный', темного: 'темный', темную: 'темный', темный: 'темный', темном: 'темный', темным: 'темный', темными: 'темный', темных: 'темный', темные: 'темный',
  тёмная: 'темный', тёмное: 'темный', тёмной: 'темный', тёмного: 'темный', тёмную: 'темный', тёмный: 'темный', тёмном: 'темный', тёмным: 'темный', тёмными: 'темный', тёмных: 'темный', тёмные: 'темный',
  светлая: 'светлый', светлое: 'светлый', светлой: 'светлый', светлого: 'светлый', светлую: 'светлый', светлый: 'светлый', светлом: 'светлый', светлым: 'светлый', светлыми: 'светлый', светлых: 'светлый', светлые: 'светлый',
};

const carStopWords = new Set([
  'авто', 'автомобиль', 'машина', 'тачка', 'цвет', 'госномер', 'номер', 'гн', 'седан', 'хэтчбек',
  'кроссовер', 'купе', 'универсал', 'внедорожник', 'минивэн', 'пикап', 'мой', 'моя', 'мое', 'наш', 'наша',
]);

const brandSynonyms: Record<string, string[]> = {
  toyota: ['тойота', 'тайота'],
  camry: ['камри', 'кемри'],
  corolla: ['королла', 'корола'],
  rav4: ['рав4', 'рав 4', 'раф4'],
  lexus: ['лексус'],
  bmw: ['бмв', 'бэха', 'бумер'],
  mercedes: ['мерседес', 'мерс', 'мерин', 'бенц', 'benz'],
  audi: ['ауди'],
  volkswagen: ['фольксваген', 'фольц', 'vw', 'ваген'],
  polo: ['поло'],
  tiguan: ['тигуан'],
  passat: ['пассат'],
  skoda: ['шкода'],
  octavia: ['октавия'],
  rapid: ['рапид'],
  kodiaq: ['кодиак'],
  hyundai: ['хендай', 'хендэ', 'хундай'],
  solaris: ['солярис'],
  creta: ['крета'],
  tucson: ['туссан', 'тусон'],
  kia: ['киа'],
  rio: ['рио'],
  ceed: ['сид'],
  sportage: ['спортейдж', 'спортаж'],
  k5: ['к5'],
  nissan: ['ниссан', 'нисан'],
  qashqai: ['кашкай'],
  xtrail: ['икстрейл', 'хтрейл'],
  almera: ['альмера'],
  juke: ['жук', 'джук'],
  mazda: ['мазда'],
  cx5: ['сх5', 'сх-5'],
  renault: ['рено'],
  logan: ['логан'],
  duster: ['дастер'],
  sandero: ['сандеро'],
  kaptur: ['каптюр'],
  lada: ['лада', 'ваз'],
  vesta: ['веста'],
  granta: ['гранта'],
  largus: ['ларгус'],
  niva: ['нива'],
  priora: ['приора'],
  haval: ['хавал', 'хавейл'],
  jolion: ['джолион'],
  f7: ['ф7'],
  chery: ['чери'],
  tiggo: ['тигго', 'тиго'],
  geely: ['джили'],
  coolray: ['кулрей'],
  monjaro: ['монжаро'],
  atlas: ['атлас'],
  omoda: ['омода'],
  c5: ['ц5'],
  exeed: ['эксид'],
  changan: ['чанган'],
  subaru: ['субару'],
  forester: ['форестер'],
  mitsubishi: ['митсубиси', 'мицубиси', 'митсубиши'],
  outlander: ['аутлендер', 'аутлэндер'],
  asx: ['асх'],
  lancer: ['лансер'],
  honda: ['хонда'],
  civic: ['цивик', 'сивик'],
  crv: ['црв', 'срв'],
  accord: ['аккорд'],
  ford: ['форд'],
  focus: ['фокус'],
  mondeo: ['мондео'],
  kuga: ['куга'],
  chevrolet: ['шевроле', 'шеви'],
  cruze: ['круз'],
  aveo: ['авео'],
  peugeot: ['пежо'],
  citroen: ['ситроен'],
  opel: ['опель'],
  astra: ['астра'],
  corsa: ['корса'],
  volvo: ['вольво'],
  suzuki: ['сузуки'],
  porsche: ['порше'],
  cayenne: ['кайен', 'кайенн'],
  infiniti: ['инфинити'],
  landrover: ['лендровер', 'лэндровер'],
  rover: ['ровер', 'рейндж', 'рэндж'],
  jeep: ['джип', 'чероки'],
  uaz: ['уаз', 'патриот', 'буханка'],
  gaz: ['газель', 'соболь'],
  tesla: ['тесла'],
  zeekr: ['зикер', 'зикр'],
  voyah: ['воя', 'войя'],
  tank: ['танк'],
  moskvich: ['москвич'],
};

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function generateWordForms(alias: string): string[] {
  const norm = normalizeText(alias);
  const forms = new Set<string>([norm]);
  if (/^[а-я]+$/u.test(norm) && norm.length >= 3) {
    if (norm.endsWith('а')) {
      const stem = norm.slice(0, -1);
      for (const ending of ['а', 'ы', 'е', 'у', 'ой', 'ою', '']) {
        if (stem.length >= 2) forms.add(stem + ending);
      }
    } else if (norm.endsWith('я')) {
      const stem = norm.slice(0, -1);
      for (const ending of ['я', 'и', 'е', 'ю', 'ей', 'ею', '']) {
        if (stem.length >= 2) forms.add(stem + ending);
      }
    } else if (norm.endsWith('й')) {
      const stem = norm.slice(0, -1);
      for (const ending of ['й', 'я', 'ю', 'ем', 'е', 'и', 'ев']) {
        forms.add(stem + ending);
      }
    } else if (/[бвгджзклмнпрстфхцчшщ]$/u.test(norm)) {
      for (const ending of ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']) {
        forms.add(norm + ending);
      }
    }
  }
  return [...forms];
}

const canonicalBrandMap = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(brandSynonyms)) {
  canonicalBrandMap.set(canonical, canonical);
  for (const alias of aliases) {
    const forms = generateWordForms(alias);
    for (const form of forms) {
      if (!carStopWords.has(form) && form.length >= 2) {
        canonicalBrandMap.set(form, canonical);
      }
    }
  }
}

function stemRussian(word: string): string {
  if (word.length <= 3) return word;
  return word.replace(/(?:ами|ями|ов|ев|ей|ой|ою|ем|ом|ах|ях|ам|ям|ую|юю|ы|и|е|у|ю|а|я|о)$/u, '');
}

function canonicalTerm(word: string): string {
  const norm = normalizeText(word);
  const mapped = canonicalBrandMap.get(norm);
  if (mapped) return mapped;
  if (/^[а-я]+$/u.test(norm) && norm.length >= 4) {
    const stemmed = stemRussian(norm);
    if (stemmed.length >= 3) {
      const stemMapped = canonicalBrandMap.get(stemmed);
      if (stemMapped) return stemMapped;
      return stemmed;
    }
  }
  return norm;
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
    /(?:кв(?:артир[а-я]*|\.)?|кварт[а-я]*|кв-р[а-я]*)\s*(?:[№#]|no\.?)?\s*[:#-]?\s*(\d{1,4})(?!\d)/gu,
    /(?<!\d)(\d{1,4})\s*(?:-?(?:я|ая|ой|ую|й|ый|ом|ем|ей|ье))?\s*(?:кв(?:артир[а-я]*|\.)?|кварт[а-я]*|кв-р[а-я]*)(?![\p{L}])/gu,
    /(?<!(?:дом[а-я]*|приказ[а-я]*|заявк[а-я]*|договор[а-я]*|счет[а-я]*|постановлен[а-я]*|заказ[а-я]*|обращен[а-я]*|тикет[а-я]*|акт[а-я]*|ст(?:ат[а-я]*)?|пункт[а-я]*|стр(?:ан[а-я]*)?|автобус[а-я]*|маршрут[а-я]*|школ[а-я]*|сад[а-я]*|кабинет[а-я]*|комнат[а-я]*|офис[а-я]*|гараж[а-я]*|бокс[а-я]*|мест[а-я]*|поезд[а-я]*)\s*)(?:^|[.,!?\n]|(?<![\p{L}\d])(?:в|во|из|у|к|для|соседи|хозяева))\s*(?:[№#]|no\.?)\s*(\d{1,4})(?!\d)/gu,
  ]);
  const entrances = collectNumbers(normalized, [
    /(?:подъезд[а-я]*|под\.?|под-д)\s*(?:[№#]|no\.?)?\s*[:#-]?\s*(\d{1,3})(?!\d|%|(?:\s*(?:процент[а-я]*|градус[а-я]*|утра|дня|дней|ночи|часа|часов|года|лет|месяц[а-я]*|недел[а-я]*|суток|сут[а-я]*|руб[а-я.]*|тыс[а-я.]*|млн[а-я.]*|доллар[а-я]*|евро)))/gu,
    /(?<!\d)(\d{1,3})\s*(?:-?(?:й|ый|ой|ий|м|им|ем|ом|го|его|му|у))?\s*(?:подъезд[а-я]*|под\.|под-д)(?![\p{L}])/gu,
    /(?<!\d)(\d{1,3})\s*(?:-?(?:й|ый|ой|ий|м|им|ем|ом))?\s+под(?:[.]|(?!\p{L}))/gu,
  ]);

  const plates = new Set<string>();
  const platePattern = /(?<![\p{L}\d])([АВЕКМНОРСТУХABEKMHOPCTYX])[\s\-_/|]*(\d{3})[\s\-_/|]*([АВЕКМНОРСТУХABEKMHOPCTYX]{2})(?:[\s\-_/|]*(\d{2,3}))?(?:[\s\-_/|]*(?:rus|рус))?(?![\p{L}\d])/giu;
  const russianPrepositions1 = new Set(['в', 'к', 'с', 'о', 'у']);
  const russianParticles2 = new Set(['во', 'ко', 'со', 'на', 'но', 'от', 'то', 'те', 'их']);
  const carPrefixPattern = /(?:машин[а-я]*|авто[а-я]*|номер[а-я]*|госномер[а-я]*|г\s*\/?\s*н|а\s*\/?\s*м)\s*$/iu;

  for (const match of text.matchAll(platePattern)) {
    if (!match[1] || !match[2] || !match[3]) continue;
    const letter1 = match[1].toLowerCase();
    const letters2 = match[3].toLowerCase();
    const matchedFull = match[0];
    const hasInternalSpaces = /\s/.test(matchedFull);

    if (hasInternalSpaces && russianPrepositions1.has(letter1) && russianParticles2.has(letters2)) {
      const matchIndex = match.index ?? 0;
      const textBefore = text.slice(0, matchIndex);
      if (!carPrefixPattern.test(textBefore.trim())) {
        continue;
      }
    }

    const rawPlate = match[4]
      ? `${match[1]}${match[2]}${match[3]}${match[4]}`
      : `${match[1]}${match[2]}${match[3]}`;
    const plate = normalizeCarPlate(rawPlate);
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
  const profileTerms = new Set(
    profileWords
      .filter((word) => !colorForms[word] && !carStopWords.has(word) && word.length >= 2)
      .map(canonicalTerm),
  );
  if (profileColors.size === 0 && profileTerms.size === 0) return null;

  const messageWords = words(messageText);
  const messageColors = new Set(messageWords.map((word) => colorForms[word]).filter((word): word is string => Boolean(word)));
  const messageTerms = new Set(
    messageWords
      .filter((word) => !colorForms[word] && !carStopWords.has(word) && word.length >= 2)
      .map(canonicalTerm),
  );

  const matchedTerms = [...profileTerms].filter((term) => messageTerms.has(term));

  // If no vehicle brand or model matched, color alone cannot match
  if (matchedTerms.length === 0) return null;

  // If profile has specific colors, ensure message does not contradict
  if (profileColors.size > 0 && messageColors.size > 0) {
    const hasColorMatch = [...profileColors].some((color) => messageColors.has(color));
    if (!hasColorMatch) return null;
  }

  const value = description.trim().toLowerCase().slice(0, 100);
  return { type: 'car_description', value, label: description.trim() };
}

export function triggerMatchesProfile(
  trigger: MessageTrigger,
  profile: {
    apartment: number;
    entrance: number;
    carPlateNormalized: string | null;
    properties?: Array<{ apartment: number; entrance: number }> | null | undefined;
    vehicles?: Array<{ plate?: string | null | undefined; plateNormalized?: string | null | undefined }> | null | undefined;
  },
): boolean {
  if (trigger.type === 'apartment') {
    if (trigger.value === String(profile.apartment)) return true;
    if (profile.properties?.some((p) => String(p.apartment) === trigger.value)) return true;
    return false;
  }
  if (trigger.type === 'entrance') {
    if (trigger.value === String(profile.entrance)) return true;
    if (profile.properties?.some((p) => String(p.entrance) === trigger.value)) return true;
    return false;
  }
  if (trigger.type === 'car_plate') {
    if (profile.carPlateNormalized && matchPlates(trigger.value, profile.carPlateNormalized)) return true;
    if (profile.vehicles?.some((v) => {
      const plate = v.plateNormalized ?? (v.plate ? normalizeCarPlate(v.plate) : null);
      return Boolean(plate && matchPlates(trigger.value, plate));
    })) return true;
    return false;
  }
  return false;
}
