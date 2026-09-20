import { describe, expect, it, vi } from 'vitest';

import { createAlertText, sendPrivateAlert } from './private-alert.js';

describe('private alerts', () => {
  const trigger = { type: 'apartment' as const, value: '54', label: 'квартира 54' };

  it('formats a compact alert without a group-chat action', () => {
    const text = createAlertText(trigger, 'Иван Петров', '  Течёт   труба  ');
    expect(text).toContain('квартира 54');
    expect(text).toContain('«Течёт труба»');
    expect(text).toContain('Автор: Иван Петров');
  });

  it('uses an API that can address only a user', async () => {
    const api = { sendMessageToUser: vi.fn(async () => ({})) };
    await sendPrivateAlert(api, 42, trigger, 'Иван', 'Проверьте квартиру');
    expect(api.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('квартира 54'));
  });
});
