import { describe, expect, it } from 'vitest';

import {
  detectMessageTriggers,
  matchCarDescription,
  matchPlates,
  normalizeCarPlate,
  normalizeText,
  triggerMatchesProfile,
} from './detectors.js';

describe('message detectors', () => {
  it.each([
    ['Хозяин кв. 54, у вас течёт труба', 'apartment', '54'],
    ['54 кварта, заберите ключи', 'apartment', '54'],
    ['Квартира 54, у вас, кажется, тамбурная дверь приоткрыта, проверьте, пожалуйста.', 'apartment', '54'],
    ['Квартира: 54', 'apartment', '54'],
    ['В 54-й квартире приоткрыта дверь', 'apartment', '54'],
    ['кв-ра 54', 'apartment', '54'],
    ['54 квартира, вы заливаете', 'apartment', '54'],
    ['54 кв закройте окно', 'apartment', '54'],
    ['кв 54 шумит', 'apartment', '54'],
    ['квартира №54', 'apartment', '54'],
    ['В 3-м подъезде не работает лифт', 'entrance', '3'],
    ['Соседи, в 3 подъезде с утра не работает грузовой лифт', 'entrance', '3'],
    ['3й подъезд', 'entrance', '3'],
    ['3-й подъезд', 'entrance', '3'],
    ['в 3-ем подъезде грязно', 'entrance', '3'],
    ['подъезд: 3', 'entrance', '3'],
    ['под. 3 не горит свет', 'entrance', '3'],
    ['3-й под без домофона', 'entrance', '3'],
    ['Подъезд №12 временно без воды', 'entrance', '12'],
    ['А 123 ВС 77 перекрыл проезд', 'car_plate', 'А123ВС77'],
    ['A123BC 777 мешает проезду', 'car_plate', 'А123ВС777'],
    ['Чья а 123 вс во дворе?', 'car_plate', 'А123ВС'],
    ['Машина a123bc загородила мусорку', 'car_plate', 'А123ВС'],
    ['А-123-ВС 77 стоит на газоне', 'car_plate', 'А123ВС77'],
    ['а123вс77rus припарковался криво', 'car_plate', 'А123ВС77'],
    ['А123ВС77 рус мешает выезду', 'car_plate', 'А123ВС77'],
    ['а 123 вс 77 rus во дворе', 'car_plate', 'А123ВС77'],
    ['3 под шумит', 'entrance', '3'],
    ['под 3 не закрыта дверь', 'entrance', '3'],
    ['в №54 шумно ночью', 'apartment', '54'],
    ['соседи из №54, тише', 'apartment', '54'],
    ['№54, закройте дверь в карман', 'apartment', '54'],
  ])('detects %s', (text, type, value) => {
    expect(detectMessageTriggers(text)).toContainEqual(expect.objectContaining({ type, value }));
  });

  it('does not treat a time or phone as an apartment', () => {
    expect(detectMessageTriggers('Встречаемся в 15:54')).toEqual([]);
    expect(detectMessageTriggers('Дом 54, встречаемся в 18:30')).toEqual([]);
    expect(detectMessageTriggers('Позвоните 8 999 123 45 67')).toEqual([]);
    expect(detectMessageTriggers('автобус №54 уехал')).toEqual([]);
    expect(detectMessageTriggers('заявка №54 принята в работу')).toEqual([]);
    expect(detectMessageTriggers('взял кредит под 3% годовых')).toEqual([]);
    expect(detectMessageTriggers('цена под 3 доллара')).toEqual([]);
    expect(detectMessageTriggers('под 3 дня задерживают')).toEqual([]);
  });

  it('deduplicates repeated mentions', () => {
    expect(detectMessageTriggers('кв. 54, квартира 54')).toHaveLength(1);
  });

  it('normalizes text and visually equivalent plate letters', () => {
    expect(normalizeText('  ТечЁт — ТРУБА! ')).toBe('течет труба');
    expect(normalizeCarPlate('A 123 BC-77')).toBe('А123ВС77');
    expect(normalizeCarPlate('a123bc 777')).toBe('А123ВС777');
    expect(normalizeCarPlate('a 123 bc')).toBe('А123ВС');
    expect(normalizeCarPlate('А123ВС')).toBe('А123ВС');
    expect(normalizeCarPlate('А123ВС77RUS')).toBe('А123ВС77');
    expect(normalizeCarPlate('а 123 вс 77 рус')).toBe('А123ВС77');
    expect(normalizeCarPlate('а123вс рус')).toBe('А123ВС');
    expect(normalizeCarPlate('А12ВС77')).toBeNull();
  });

  it('matches plates with flexible region and formatting', () => {
    expect(matchPlates('А123ВС77', 'A123BC 77')).toBe(true);
    expect(matchPlates('А123ВС', 'А123ВС77')).toBe(true); // plate without region matches profile with region
    expect(matchPlates('А123ВС77', 'А123ВС')).toBe(true); // trigger with region matches profile without region
    expect(matchPlates('А123ВС77', 'А123ВС99')).toBe(false); // different regions do not match
    expect(matchPlates('А123ВС77', 'В456ОР77')).toBe(false);
  });

  it('matches car description with relaxed matching', () => {
    // Both brand/model and color present
    expect(matchCarDescription('Белая Camry перекрыла проезд', 'Белая Toyota Camry')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Standalone model without color
    expect(matchCarDescription('Camry стоит у подъезда', 'Белая Toyota Camry')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Standalone brand with transliteration
    expect(matchCarDescription('Тойота перекрыла проезд', 'Белая Toyota Camry')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Brand with color
    expect(matchCarDescription('Белая тойота во дворе', 'Белая Toyota Camry')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Flexible word order
    expect(matchCarDescription('Camry белая мешает', 'Белая Toyota Camry')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Color alone without brand or model must NOT match
    expect(matchCarDescription('Белая машина стоит у дома', 'Белая Toyota Camry')).toBeNull();
    // Conflicting color must NOT match
    expect(matchCarDescription('Красная Camry перекрыла проезд', 'Белая Toyota Camry')).toBeNull();
    // Profile without color matches any mention of model
    expect(matchCarDescription('Haval стоит у ворот', 'Haval Jolion')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    expect(matchCarDescription('Черный Haval стоит у ворот', 'Haval Jolion')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Synonyms and transliterations
    expect(matchCarDescription('Солярис перекрыл выезд', 'Hyundai Solaris')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Russian grammatical inflections
    expect(matchCarDescription('Кто-то поцарапал мазду', 'Mazda CX-5')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    expect(matchCarDescription('В шкоде орет сигналка', 'Skoda Octavia')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    expect(matchCarDescription('У весты спущено колесо', 'Lada Vesta')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    expect(matchCarDescription('В гранте забыли сумку', 'Lada Granta')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Slang names
    expect(matchCarDescription('бумер перекрыл выезд', 'BMW X5')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    expect(matchCarDescription('мерин стоит у ворот', 'Mercedes E-Class')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    // Color cases
    expect(matchCarDescription('на белом солярисе', 'Черный Solaris')).toBeNull();
    expect(matchCarDescription('на белом солярисе', 'Белый Solaris')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
  });

  it('matches a trigger to corresponding profile fields including multiple properties and vehicles', () => {
    const profile = {
      apartment: 54,
      entrance: 3,
      carPlateNormalized: 'А123ВС77',
      properties: [
        { apartment: 54, entrance: 3 },
        { apartment: 102, entrance: 5 },
      ],
      vehicles: [
        { plateNormalized: 'А123ВС77' },
        { plateNormalized: 'В456ОР77' },
      ],
    };

    // Primary apartment & secondary apartment
    expect(triggerMatchesProfile({ type: 'apartment', value: '54', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'apartment', value: '102', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'apartment', value: '99', label: '' }, profile)).toBe(false);

    // Primary entrance & secondary entrance
    expect(triggerMatchesProfile({ type: 'entrance', value: '3', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'entrance', value: '5', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'entrance', value: '4', label: '' }, profile)).toBe(false);

    // Primary vehicle & secondary vehicle
    expect(triggerMatchesProfile({ type: 'car_plate', value: 'А123ВС77', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'car_plate', value: 'А123ВС', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'car_plate', value: 'В456ОР77', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'car_plate', value: 'В456ОР', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'car_plate', value: 'С789ТТ77', label: '' }, profile)).toBe(false);
  });
});
