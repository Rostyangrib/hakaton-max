import { describe, expect, it, vi } from 'vitest';

import { createAlertText, sendPrivateAlert } from './private-alert.js';

describe('private alerts', () => {
  const trigger = { type: 'apartment' as const, value: '54', label: 'квартира 54' };

  it('formats a compact alert without a group-chat action', () => {
    const text = createAlertText(trigger, 'Иван Петров', '  Течёт   труба  ');
    expect(text).toContain('квартира 54');
    expect(text).toContain('«Течёт труба»');
    expect(text).toContain('Автор: Иван Петров');
    expect(text).toContain('🔔 В домовом чате упомянули:');
  });

  it('includes home title in the header when homeTitle is provided', () => {
    const text = createAlertText(trigger, 'Иван Петров', 'Течёт труба', 'Тест 2');
    expect(text).toContain('🔔 В домовом чате «Тест 2» упомянули: квартира 54.');
  });

  it('falls back to generic title when homeTitle is Домовой чат', () => {
    const text = createAlertText(trigger, 'Иван Петров', 'Течёт труба', 'Домовой чат');
    expect(text).toContain('🔔 В домовом чате упомянули: квартира 54.');
    expect(text).not.toContain('«Домовой чат»');
  });

  it('uses an API that can address only a user', async () => {
    const api = { sendMessageToUser: vi.fn(async () => ({})) };
    await sendPrivateAlert(api, 42, trigger, 'Иван', 'Проверьте квартиру', 'Тестовый дом');
    expect(api.sendMessageToUser).toHaveBeenCalledWith(42, expect.stringContaining('«Тестовый дом»'));
  });
});
