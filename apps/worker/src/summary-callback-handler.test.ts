import { describe, expect, it, vi } from 'vitest';
import type { SummaryResult } from '@quiet-chat/shared';

import {
  SummaryCallbackHandler,
  getMessageMid,
  readUser,
  type SummaryBotApi,
} from './summary-callback-handler.js';
import { SummaryAccessError } from './summary-service.js';

function createMockUpdate(payload = 'summary:today', userId = 215608884) {
  return {
    update_type: 'message_callback',
    callback: {
      callback_id: 'cb-12345',
      payload,
      user: {
        user_id: userId,
        first_name: 'Ростислав',
        last_name: 'Затопляев',
      },
    },
    message: {
      body: { mid: 'mid-welcome-1' },
      recipient: {
        chat_id: 355531174,
        user_id: userId,
        chat_type: 'dialog',
      },
    },
  };
}

const dummySummary: SummaryResult = {
  period: 'today',
  periodFrom: '2026-09-23T00:00:00Z',
  periodTo: '2026-09-23T12:00:00Z',
  messageCount: 5,
  filteredCount: 5,
  savedMinutes: 1,
  generatedAt: '2026-09-23T12:00:00Z',
  mode: 'yandexgpt',
  cached: false,
  housing: [{ text: 'Лифт работает', sourceMessageIds: ['msg-1'] }],
  yard: [],
  community: [],
};

describe('SummaryCallbackHandler', () => {
  it('ignores updates that are not dialog callbacks with summary payload', async () => {
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn(),
      sendMessageToUser: vi.fn(),
      editMessage: vi.fn(),
      deleteMessage: vi.fn(),
    };
    const summaryService = { generate: vi.fn() };
    const handler = new SummaryCallbackHandler({ botApi, summaryService });

    const nonCallback = { update_type: 'message_created' };
    expect(await handler.handle(nonCallback)).toBe(false);

    const groupCallback = createMockUpdate();
    (groupCallback.message.recipient as { chat_type: string }).chat_type = 'chat';
    expect(await handler.handle(groupCallback)).toBe(false);

    const unknownPayload = createMockUpdate('other:action');
    expect(await handler.handle(unknownPayload)).toBe(false);

    expect(botApi.answerOnCallback).not.toHaveBeenCalled();
    expect(botApi.sendMessageToUser).not.toHaveBeenCalled();
  });

  it('answers callback without message, sends status at bottom, and edits it into summary', async () => {
    const calls: string[] = [];
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockImplementation(async (cbId, extra) => {
        calls.push(`answerOnCallback:${cbId}:${JSON.stringify(extra)}`);
        return { success: true };
      }),
      sendMessageToUser: vi.fn().mockImplementation(async (userId, text) => {
        calls.push(`sendMessageToUser:${userId}:${text}`);
        return { body: { mid: 'mid-status-999' } };
      }),
      editMessage: vi.fn().mockImplementation(async (mid, _extra) => {
        calls.push(`editMessage:${mid}`);
        return { success: true };
      }),
      deleteMessage: vi.fn(),
    };
    const summaryService = {
      generate: vi.fn().mockImplementation(async () => {
        calls.push('generate');
        return dummySummary;
      }),
    };
    const onUserSeen = vi.fn();
    const handler = new SummaryCallbackHandler({ botApi, summaryService, onUserSeen });

    const update = createMockUpdate();
    const result = await handler.handle(update);

    expect(result).toBe(true);
    expect(onUserSeen).toHaveBeenCalledWith({
      user_id: 215608884,
      first_name: 'Ростислав',
      last_name: 'Затопляев',
    });

    // answerOnCallback MUST NOT have extra message (avoids permanent untracked status)
    expect(botApi.answerOnCallback).toHaveBeenCalledWith('cb-12345');
    // Status message posted at bottom
    expect(botApi.sendMessageToUser).toHaveBeenCalledWith(215608884, 'Готовлю сводку…');
    // Generation occurred
    expect(summaryService.generate).toHaveBeenCalledWith(215608884n, 'today');
    // Status message was edited into summary
    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-999', expect.objectContaining({
      format: 'markdown',
      text: expect.stringContaining('Сводка за сегодня'),
      attachments: expect.any(Array),
    }));
    // No delete needed because edit succeeded
    expect(botApi.deleteMessage).not.toHaveBeenCalled();
    // Pending tracking cleared
    expect(handler.getPendingStatusMid(215608884)).toBeUndefined();
  });

  it('falls back to sending new message and deleting status if editMessage fails', async () => {
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn()
        .mockResolvedValueOnce({ body: { mid: 'mid-status-1' } }) // status message
        .mockResolvedValueOnce({ body: { mid: 'mid-summary-1' } }), // summary fallback
      editMessage: vi.fn().mockRejectedValue(new Error('Edit not supported')),
      deleteMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    const summaryService = {
      generate: vi.fn().mockResolvedValue(dummySummary),
    };
    const handler = new SummaryCallbackHandler({ botApi, summaryService });

    const result = await handler.handle(createMockUpdate());
    expect(result).toBe(true);

    // Edit was attempted
    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-1', expect.anything());
    // Fallback: sent summary as new message
    expect(botApi.sendMessageToUser).toHaveBeenCalledTimes(2);
    // Deleted original status message so it does not linger
    expect(botApi.deleteMessage).toHaveBeenCalledWith('mid-status-1');
    expect(handler.getPendingStatusMid(215608884)).toBeUndefined();
  });

  it('deletes previous in-flight status message and ignores completion when superseded', async () => {
    const deletedMids = new Set<string>();
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn()
        .mockResolvedValueOnce({ body: { mid: 'mid-status-first' } })
        .mockResolvedValueOnce({ body: { mid: 'mid-status-second' } }),
      editMessage: vi.fn().mockImplementation(async (mid) => {
        if (deletedMids.has(mid)) throw new Error('Message not found (deleted)');
        return { success: true };
      }),
      deleteMessage: vi.fn().mockImplementation(async (mid) => {
        deletedMids.add(mid);
        return { success: true };
      }),
    };
    let resolveFirstGenerate: (res: SummaryResult) => void;
    const firstGeneratePromise = new Promise<SummaryResult>((resolve) => {
      resolveFirstGenerate = resolve;
    });

    const summaryService = {
      generate: vi.fn()
        .mockReturnValueOnce(firstGeneratePromise)
        .mockResolvedValueOnce(dummySummary),
    };

    const handler = new SummaryCallbackHandler({ botApi, summaryService });

    // First click starts generating
    const firstPromise = handler.handle(createMockUpdate('summary:today'));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(handler.getPendingStatusMid(215608884)).toBe('mid-status-first');

    // Second click arrives while first is still generating
    const secondPromise = handler.handle(createMockUpdate('summary:week'));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    // Previous status message mid-status-first must be deleted immediately!
    expect(botApi.deleteMessage).toHaveBeenCalledWith('mid-status-first');

    // Finish second request
    await secondPromise;
    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-second', expect.anything());

    // Finish first (now superseded) request
    resolveFirstGenerate!(dummySummary);
    await firstPromise;

    // Superseded request must NOT have edited the deleted message or sent a fallback message
    expect(botApi.editMessage).not.toHaveBeenCalledWith('mid-status-first', expect.anything());
    expect(botApi.sendMessageToUser).toHaveBeenCalledTimes(2); // Only status-first and status-second
    expect(handler.getPendingStatusMid(215608884)).toBeUndefined();
  });

  it('cancels and cleans up when second callback arrives before first status message finishes sending', async () => {
    let resolveFirstSend: (res: unknown) => void;
    const firstSendPromise = new Promise((resolve) => {
      resolveFirstSend = resolve;
    });

    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn()
        .mockReturnValueOnce(firstSendPromise)
        .mockResolvedValueOnce({ body: { mid: 'mid-status-second' } }),
      editMessage: vi.fn().mockResolvedValue({ success: true }),
      deleteMessage: vi.fn().mockResolvedValue({ success: true }),
    };

    const summaryService = {
      generate: vi.fn().mockResolvedValue(dummySummary),
    };

    const handler = new SummaryCallbackHandler({ botApi, summaryService });

    const firstPromise = handler.handle(createMockUpdate('summary:today'));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    const secondPromise = handler.handle(createMockUpdate('summary:week'));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    // First send finishes after second request has already started
    resolveFirstSend!({ body: { mid: 'mid-status-first' } });

    await Promise.all([firstPromise, secondPromise]);

    // First status message must be deleted once sent since it was superseded
    expect(botApi.deleteMessage).toHaveBeenCalledWith('mid-status-first');
    // Only one summary was generated for the second request
    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-second', expect.anything());
  });

  it('handles SummaryAccessError by updating status message with error notice and keyboard', async () => {
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn().mockResolvedValue({ body: { mid: 'mid-status-access' } }),
      editMessage: vi.fn().mockResolvedValue({ success: true }),
      deleteMessage: vi.fn(),
    };
    const summaryService = {
      generate: vi.fn().mockRejectedValue(new SummaryAccessError()),
    };
    const getUserDirectUrl = vi.fn().mockReturnValue('https://app.test/?token=xyz');
    const getWelcomeKeyboard = vi.fn().mockReturnValue({ type: 'keyboard' });

    const handler = new SummaryCallbackHandler({
      botApi,
      summaryService,
      getUserDirectUrl,
      getWelcomeKeyboard,
    });

    const result = await handler.handle(createMockUpdate());
    expect(result).toBe(true);

    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-access', {
      text: 'Сначала заполните профиль и подтвердите принадлежность к домовому чату.',
      attachments: [{ type: 'keyboard' }],
    });
    expect(handler.getPendingStatusMid(215608884)).toBeUndefined();
  });

  it('handles SummaryAccessError with LEFT_CHAT code by sending polite revocation notice in Russian', async () => {
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn().mockResolvedValue({ body: { mid: 'mid-status-left' } }),
      editMessage: vi.fn().mockResolvedValue({ success: true }),
      deleteMessage: vi.fn(),
    };
    const summaryService = {
      generate: vi.fn().mockRejectedValue(new SummaryAccessError('left chat', 'LEFT_CHAT', 'ЖК Северный')),
    };

    const handler = new SummaryCallbackHandler({ botApi, summaryService });
    const result = await handler.handle(createMockUpdate());
    expect(result).toBe(true);

    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-left', expect.objectContaining({
      text: expect.stringContaining('Вы больше не состоите в домовом чате «ЖК Северный»'),
    }));
  });

  it('renders home selection keyboard when MultipleHomesChoiceError is thrown', async () => {
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn().mockResolvedValue({ body: { mid: 'mid-status-multi' } }),
      editMessage: vi.fn().mockResolvedValue({ success: true }),
      deleteMessage: vi.fn(),
    };
    const { MultipleHomesChoiceError } = await import('./summary-service.js');
    const summaryService = {
      generate: vi.fn().mockRejectedValue(new MultipleHomesChoiceError([
        { id: 'h1', timezone: 'Asia/Irkutsk', title: 'ЖК Северный' },
        { id: 'h2', timezone: 'Asia/Irkutsk', title: 'ЖК Южный' },
      ])),
    };

    const handler = new SummaryCallbackHandler({ botApi, summaryService });
    const result = await handler.handle(createMockUpdate('summary:today'));
    expect(result).toBe(true);

    expect(botApi.editMessage).toHaveBeenCalledWith('mid-status-multi', expect.objectContaining({
      text: expect.stringContaining('Вы состоите в нескольких домах'),
    }));
  });

  it('deletes status message and cleans up when unexpected error occurs during generation', async () => {
    const botApi: SummaryBotApi = {
      answerOnCallback: vi.fn().mockResolvedValue({ success: true }),
      sendMessageToUser: vi.fn().mockResolvedValue({ body: { mid: 'mid-status-err' } }),
      editMessage: vi.fn(),
      deleteMessage: vi.fn().mockResolvedValue({ success: true }),
    };
    const summaryService = {
      generate: vi.fn().mockRejectedValue(new Error('YandexGPT is down')),
    };

    const handler = new SummaryCallbackHandler({ botApi, summaryService });

    await expect(handler.handle(createMockUpdate())).rejects.toThrow('YandexGPT is down');

    // Status message must be deleted so no ghost message remains in chat
    expect(botApi.deleteMessage).toHaveBeenCalledWith('mid-status-err');
    expect(handler.getPendingStatusMid(215608884)).toBeUndefined();
  });
});

describe('getMessageMid', () => {
  it('extracts mid from various response shapes including numeric mids', () => {
    expect(getMessageMid({ body: { mid: 'mid-123' } })).toBe('mid-123');
    expect(getMessageMid({ mid: 'mid-456' })).toBe('mid-456');
    expect(getMessageMid({ message: { body: { mid: 'mid-789' } } })).toBe('mid-789');
    expect(getMessageMid({ message: { mid: 'mid-012' } })).toBe('mid-012');
    expect(getMessageMid({ body: { mid: 998877 } })).toBe('998877');
    expect(getMessageMid({ body: { mid: '  mid-trimmed  ' } })).toBe('mid-trimmed');
    expect(getMessageMid(null)).toBeUndefined();
    expect(getMessageMid({})).toBeUndefined();
    expect(getMessageMid({ body: { mid: '' } })).toBeUndefined();
  });
});

describe('readUser', () => {
  it('correctly parses user with various id formats and defaults', () => {
    expect(readUser({ user_id: 12345, first_name: 'Иван', last_name: 'Иванов' })).toEqual({
      user_id: 12345,
      first_name: 'Иван',
      last_name: 'Иванов',
    });

    expect(readUser({ id: '67890', first_name: '  Петр  ' })).toEqual({
      user_id: 67890,
      first_name: 'Петр',
    });

    expect(readUser({ user_id: 100n })).toEqual({
      user_id: 100,
      first_name: 'Жилец',
    });

    expect(readUser(null)).toBeNull();
    expect(readUser({ user_id: 0 })).toBeNull();
    expect(readUser({ user_id: -5 })).toBeNull();
    expect(readUser({ user_id: 'invalid' })).toBeNull();
  });
});
