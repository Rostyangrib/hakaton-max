import { describe, expect, it } from 'vitest';

import { createWelcomeKeyboard, welcomeText } from './menu.js';

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
  });
});
