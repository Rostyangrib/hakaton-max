import { describe, expect, it } from 'vitest';

import {
  detectMessageTriggers,
  matchCarDescription,
  normalizeCarPlate,
  normalizeText,
  triggerMatchesProfile,
} from './detectors.js';

describe('message detectors', () => {
  it.each([
    ['Хозяин кв. 54, у вас течёт труба', 'apartment', '54'],
    ['54 кварта, заберите ключи', 'apartment', '54'],
    ['В 3-м подъезде не работает лифт', 'entrance', '3'],
    ['Подъезд №12 временно без воды', 'entrance', '12'],
    ['А 123 ВС 77 перекрыл проезд', 'car_plate', 'А123ВС77'],
    ['A123BC 777 мешает проезду', 'car_plate', 'А123ВС777'],
  ])('detects %s', (text, type, value) => {
    expect(detectMessageTriggers(text)).toContainEqual(expect.objectContaining({ type, value }));
  });

  it('does not treat a time as an apartment', () => {
    expect(detectMessageTriggers('Встречаемся в 15:54')).toEqual([]);
    expect(detectMessageTriggers('Дом 54, встречаемся в 18:30')).toEqual([]);
    expect(detectMessageTriggers('Позвоните 8 999 123 45 67')).toEqual([]);
  });

  it('deduplicates repeated mentions', () => {
    expect(detectMessageTriggers('кв. 54, квартира 54')).toHaveLength(1);
  });

  it('normalizes text and visually equivalent plate letters', () => {
    expect(normalizeText('  ТечЁт — ТРУБА! ')).toBe('течет труба');
    expect(normalizeCarPlate('A 123 BC-77')).toBe('А123ВС77');
    expect(normalizeCarPlate('А12ВС77')).toBeNull();
  });

  it('matches car description only when both color and model are present', () => {
    expect(matchCarDescription('Белая Camry перекрыла проезд', 'Белая Toyota Camry')).toEqual(
      expect.objectContaining({ type: 'car_description' }),
    );
    expect(matchCarDescription('Белая машина стоит у дома', 'Белая Toyota Camry')).toBeNull();
    expect(matchCarDescription('Camry стоит у подъезда', 'Белая Toyota Camry')).toBeNull();
  });

  it('matches a trigger only to the corresponding profile field', () => {
    const profile = { apartment: 54, entrance: 3, carPlateNormalized: 'А123ВС77' };
    expect(triggerMatchesProfile({ type: 'apartment', value: '54', label: '' }, profile)).toBe(true);
    expect(triggerMatchesProfile({ type: 'entrance', value: '4', label: '' }, profile)).toBe(false);
  });
});
