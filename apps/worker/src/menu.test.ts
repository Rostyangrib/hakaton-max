import { describe, expect, it } from 'vitest';

import { createWelcomeKeyboard, welcomeText } from './menu.js';

describe('private welcome menu', () => {
  it('contains only an open-app button and states that notifications are private', () => {
    const keyboard = createWelcomeKeyboard('https://example.test/profile');
    expect(keyboard).toEqual({
      type: 'inline_keyboard',
      payload: { buttons: [[{ type: 'open_app', text: 'Открыть профиль', web_app: 'https://example.test/profile', contact_id: undefined, payload: undefined }]] },
    });
    expect(welcomeText).toContain('только сюда, в личный диалог');
  });
});
