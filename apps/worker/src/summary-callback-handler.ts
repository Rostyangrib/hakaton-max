import { summaryPeriodSchema, type SummaryPeriod, type SummaryResult } from '@quiet-chat/shared';

import { createSummaryKeyboard } from './menu.js';
import { renderSummary } from './summary.js';
import { SummaryAccessError } from './summary-service.js';

export interface MaxUserPayload {
  user_id: number;
  first_name: string;
  last_name?: string;
}

export interface SummaryBotApi {
  answerOnCallback(callbackId: string, extra?: unknown): Promise<unknown>;
  sendMessageToUser(userId: number, text: string, extra?: unknown): Promise<unknown>;
  editMessage(messageId: string, extra?: unknown): Promise<unknown>;
  deleteMessage(messageId: string, extra?: unknown): Promise<unknown>;
}

export interface SummaryCallbackOptions {
  botApi: SummaryBotApi;
  summaryService: {
    generate(userId: bigint, period: SummaryPeriod): Promise<SummaryResult>;
  };
  onUserSeen?: (user: MaxUserPayload) => Promise<void>;
  getUserDirectUrl?: (userId: number) => string | undefined;
  getWelcomeKeyboard?: (directUrl?: string) => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readUser(value: unknown): MaxUserPayload | null {
  if (!isRecord(value)) return null;
  const rawId = value.user_id ?? value.id;
  const userId =
    typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string' && /^\d+$/.test(rawId)
        ? Number(rawId)
        : null;
  if (!userId || !Number.isSafeInteger(userId) || userId <= 0) return null;
  const firstName =
    typeof value.first_name === 'string' && value.first_name.trim()
      ? value.first_name.trim()
      : 'Жилец';
  return {
    user_id: userId,
    first_name: firstName,
    ...(typeof value.last_name === 'string' && value.last_name.trim()
      ? { last_name: value.last_name.trim() }
      : {}),
  };
}

export function getMessageMid(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const msg = response as {
    body?: { mid?: unknown };
    mid?: unknown;
    message?: { body?: { mid?: unknown }; mid?: unknown };
  };
  if (typeof msg.body?.mid === 'string') return msg.body.mid;
  if (typeof msg.mid === 'string') return msg.mid;
  if (typeof msg.message?.body?.mid === 'string') return msg.message.body.mid;
  if (typeof msg.message?.mid === 'string') return msg.message.mid;
  return undefined;
}

export class SummaryCallbackHandler {
  private readonly pendingStatusMids = new Map<number, string>();

  constructor(private readonly options: SummaryCallbackOptions) {}

  getPendingStatusMid(userId: number): string | undefined {
    return this.pendingStatusMids.get(userId);
  }

  async handle(update: Record<string, unknown>): Promise<boolean> {
    if (update.update_type !== 'message_callback') return false;
    const callback = isRecord(update.callback) ? update.callback : null;
    const callbackMessage = isRecord(update.message) ? update.message : null;
    const recipient = callbackMessage && isRecord(callbackMessage.recipient) ? callbackMessage.recipient : null;
    const user = callback ? readUser(callback.user) : null;
    const callbackId = callback?.callback_id;
    const payload = callback?.payload;
    if (!user || recipient?.chat_type !== 'dialog' || typeof callbackId !== 'string' || typeof payload !== 'string') {
      return false;
    }
    const period = summaryPeriodSchema.safeParse(payload.startsWith('summary:') ? payload.slice(8) : '');
    if (!period.success) return false;

    if (this.options.onUserSeen) {
      await this.options.onUserSeen(user);
    }

    // 1. Снимаем индикатор загрузки с кнопки без отправки неуправляемого сообщения от платформы MAX
    await this.options.botApi.answerOnCallback(callbackId).catch(() => undefined);

    // 2. Если у пользователя оставалось незавершенное статусное сообщение от предыдущего клика, удаляем его
    const prevMid = this.pendingStatusMids.get(user.user_id);
    if (prevMid) {
      this.pendingStatusMids.delete(user.user_id);
      await this.options.botApi.deleteMessage(prevMid).catch(() => undefined);
    }

    // 3. Отправляем статусное сообщение в самый низ диалога (ниже последнего сообщения)
    let statusMid: string | undefined;
    try {
      const statusMsg = await this.options.botApi.sendMessageToUser(user.user_id, 'Готовлю сводку…');
      statusMid = getMessageMid(statusMsg);
      if (statusMid) {
        this.pendingStatusMids.set(user.user_id, statusMid);
      }
    } catch {
      // При ошибке отправки статуса продолжаем генерацию
    }

    try {
      const summary = await this.options.summaryService.generate(BigInt(user.user_id), period.data);
      const summaryText = renderSummary(summary);
      const summaryKeyboard = createSummaryKeyboard();

      let edited = false;
      if (statusMid) {
        try {
          await this.options.botApi.editMessage(statusMid, {
            text: summaryText,
            format: 'markdown',
            attachments: [summaryKeyboard],
          });
          edited = true;
        } catch {
          edited = false;
        }
      }

      if (!edited) {
        await this.options.botApi.sendMessageToUser(user.user_id, summaryText, {
          format: 'markdown',
          attachments: [summaryKeyboard],
        });
        if (statusMid) {
          await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
        }
      }

      if (statusMid && this.pendingStatusMids.get(user.user_id) === statusMid) {
        this.pendingStatusMids.delete(user.user_id);
      }
    } catch (error) {
      if (error instanceof SummaryAccessError) {
        const text = 'Сначала заполните профиль и подтвердите принадлежность к домовому чату.';
        const directUrl = this.options.getUserDirectUrl?.(user.user_id);
        const keyboard = this.options.getWelcomeKeyboard?.(directUrl);

        let edited = false;
        if (statusMid) {
          try {
            await this.options.botApi.editMessage(statusMid, {
              text,
              attachments: keyboard ? [keyboard] : undefined,
            });
            edited = true;
          } catch {
            edited = false;
          }
        }

        if (!edited) {
          if (keyboard) {
            try {
              await this.options.botApi.sendMessageToUser(user.user_id, text, { attachments: [keyboard] });
            } catch {
              await this.options.botApi.sendMessageToUser(
                user.user_id,
                directUrl ? `${text}\n\nЗаполнить профиль: ${directUrl}` : text,
              );
            }
          } else {
            await this.options.botApi.sendMessageToUser(user.user_id, text);
          }
          if (statusMid) {
            await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
          }
        }

        if (statusMid && this.pendingStatusMids.get(user.user_id) === statusMid) {
          this.pendingStatusMids.delete(user.user_id);
        }
        return true;
      }

      // При непредвиденной ошибке генерации удаляем статусное сообщение, чтобы оно не висело в чате
      if (statusMid) {
        await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
        if (this.pendingStatusMids.get(user.user_id) === statusMid) {
          this.pendingStatusMids.delete(user.user_id);
        }
      }
      throw error;
    }

    return true;
  }
}
