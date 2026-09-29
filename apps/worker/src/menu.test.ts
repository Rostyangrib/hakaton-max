import { describe, expect, it } from 'vitest';

import { createSummaryButtons, createSummaryKeyboard, createWelcomeKeyboard, welcomeText } from './menu.js';

describe('private welcome menu', () => {
  it('contains profile and three summary actions and states that notifications are private', () => {
    const keyboard = createWelcomeKeyboard('https://example.test/profile');
    expect(keyboard.payload.buttons.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'open_app', text: 'Открыть профиль' }),
      { type: 'callback', text: '📅 Сегодня', payload: 'summary:today' },
      { type: 'callback', text: '📆 7 дней', payload: 'summary:week' },
      { type: 'callback', text: '🗓️ 30 дней', payload: 'summary:month' },
    ]));
    expect(welcomeText).toContain('только сюда, в личный диалог');
    expect(welcomeText).toContain('«Тихий Чат»');
  });

  it('supports passing bot username and contact ID with open_app button', () => {
    const keyboard = createWelcomeKeyboard('se14396800_bot', 'https://example.test/profile', 434706322);
    expect(keyboard.payload.buttons.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'open_app', text: 'Открыть профиль', web_app: 'se14396800_bot', contact_id: 434706322 }),
    ]));
    expect(keyboard.payload.buttons.flat().some((b) => 'text' in b && b.text === 'Заполнить профиль')).toBe(false);
  });

  it('creates summary buttons with homeId suffix and change home button when requested', () => {
    const buttons = createSummaryButtons('home-123', true);
    const flat = buttons.flat();
    expect(flat).toEqual(expect.arrayContaining([
      { type: 'callback', text: '📅 Сегодня', payload: 'summary:today:home-123' },
      { type: 'callback', text: '📆 7 дней', payload: 'summary:week:home-123' },
      { type: 'callback', text: '🗓️ 30 дней', payload: 'summary:month:home-123' },
      { type: 'callback', text: '🏠 Сменить дом', payload: 'summary:choose_home' },
    ]));

    const keyboard = createSummaryKeyboard('home-123', false);
    expect(keyboard.payload.buttons.flat().some((b) => b.text === '🏠 Сменить дом')).toBe(false);
  });
});
