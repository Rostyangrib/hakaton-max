import { Keyboard } from '@maxhub/max-bot-api';
import { summaryPeriodSchema, type SummaryPeriod, type SummaryResult } from '@quiet-chat/shared';

import { createSummaryKeyboard } from './menu.js';
import { renderSummary } from './summary.js';
import { MultipleHomesChoiceError, SummaryAccessError, type SummaryHome } from './summary-service.js';

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
    generate(userId: bigint, period: SummaryPeriod, homeId?: string): Promise<SummaryResult>;
    findHomesForResident?(userId: bigint): Promise<SummaryHome[]>;
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
      : typeof rawId === 'bigint'
        ? Number(rawId)
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
  const rawMid = msg.body?.mid ?? msg.mid ?? msg.message?.body?.mid ?? msg.message?.mid;
  if (typeof rawMid === 'string' && rawMid.trim().length > 0) return rawMid.trim();
  if (typeof rawMid === 'number' && Number.isFinite(rawMid)) return String(rawMid);
  return undefined;
}

export class SummaryCallbackHandler {
  private readonly pendingStatusMids = new Map<number, string>();
  private readonly activeRequestSeq = new Map<number, number>();

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
    const isGroupChat = recipient?.chat_type === 'chat' || recipient?.chat_type === 'channel';
    if (!user || isGroupChat || typeof callbackId !== 'string' || typeof payload !== 'string') {
      return false;
    }
    if (!payload.startsWith('summary:')) return false;
    const rawPayload = payload.slice(8);

    if (this.options.onUserSeen) {
      await this.options.onUserSeen(user);
    }

    if (rawPayload === 'choose_home') {
      await this.options.botApi.answerOnCallback(callbackId).catch(() => undefined);
      const homes = this.options.summaryService.findHomesForResident
        ? await this.options.summaryService.findHomesForResident(BigInt(user.user_id)).catch(() => [])
        : [];
      if (homes.length === 0) {
        const text = 'Сначала заполните профиль и подтвердите принадлежность к домовому чату.';
        const directUrl = this.options.getUserDirectUrl?.(user.user_id);
        const keyboard = this.options.getWelcomeKeyboard?.(directUrl);
        await this.options.botApi.sendMessageToUser(user.user_id, text, keyboard ? { attachments: [keyboard] } : undefined);
        return true;
      }
      const keyboard = Keyboard.inlineKeyboard(
        homes.map((h) => [Keyboard.button.callback(h.title || 'Дом', `summary:today:${h.id}`)])
      );
      await this.options.botApi.sendMessageToUser(user.user_id, 'Выберите дом для получения сводки:', {
        attachments: [keyboard],
      });
      return true;
    }

    const [periodStr, targetHomeId] = rawPayload.split(':');
    const period = summaryPeriodSchema.safeParse(periodStr);
    if (!period.success) return false;

    // Инкрементируем порядковый номер запроса пользователя для защиты от гонок и повторных кликов
    const requestId = (this.activeRequestSeq.get(user.user_id) ?? 0) + 1;
    this.activeRequestSeq.set(user.user_id, requestId);

    // 1. Снимаем индикатор загрузки с кнопки без отправки неуправляемого сообщения от платформы MAX
    await this.options.botApi.answerOnCallback(callbackId).catch(() => undefined);

    // 2. Если у пользователя оставалось незавершенное статусное сообщение от предыдущего клика, удаляем его
    const prevMid = this.pendingStatusMids.get(user.user_id);
    if (prevMid) {
      this.pendingStatusMids.delete(user.user_id);
      await this.options.botApi.deleteMessage(prevMid).catch(() => undefined);
    }

    // Если во время снятия спиннера или удаления пришел более новый запрос — прерываемся
    if (this.activeRequestSeq.get(user.user_id) !== requestId) {
      return true;
    }

    // 3. Отправляем статусное сообщение в самый низ диалога (ниже последнего сообщения)
    let statusMid: string | undefined;
    try {
      const statusMsg = await this.options.botApi.sendMessageToUser(user.user_id, 'Готовлю сводку…');
      statusMid = getMessageMid(statusMsg);
    } catch {
      // При ошибке отправки статуса продолжаем генерацию
    }

    // Если во время отправки статуса пришел более новый запрос — удаляем статус и прерываемся
    if (this.activeRequestSeq.get(user.user_id) !== requestId) {
      if (statusMid) {
        await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
      }
      return true;
    }

    if (statusMid) {
      this.pendingStatusMids.set(user.user_id, statusMid);
    }

    try {
      const summary = targetHomeId
        ? await this.options.summaryService.generate(BigInt(user.user_id), period.data, targetHomeId)
        : await this.options.summaryService.generate(BigInt(user.user_id), period.data);

      // Проверяем актуальность запроса после ожидания генерации
      if (this.activeRequestSeq.get(user.user_id) !== requestId) {
        if (statusMid) {
          await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
          if (this.pendingStatusMids.get(user.user_id) === statusMid) {
            this.pendingStatusMids.delete(user.user_id);
          }
        }
        return true;
      }

      const summaryText = renderSummary(summary);
      const userHomes = this.options.summaryService.findHomesForResident
        ? await this.options.summaryService.findHomesForResident(BigInt(user.user_id)).catch(() => [])
        : [];
      const summaryKeyboard = createSummaryKeyboard(targetHomeId, userHomes.length > 1);

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

      // Проверяем актуальность после редактирования
      if (this.activeRequestSeq.get(user.user_id) !== requestId) {
        if (statusMid) {
          await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
          if (this.pendingStatusMids.get(user.user_id) === statusMid) {
            this.pendingStatusMids.delete(user.user_id);
          }
        }
        return true;
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
      // Если запрос был вытеснен новым, подчищаем статус и завершаем работу без выброса ошибки
      if (this.activeRequestSeq.get(user.user_id) !== requestId) {
        if (statusMid) {
          await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
          if (this.pendingStatusMids.get(user.user_id) === statusMid) {
            this.pendingStatusMids.delete(user.user_id);
          }
        }
        return true;
      }

      if (error instanceof MultipleHomesChoiceError) {
        const keyboard = Keyboard.inlineKeyboard(
          error.homes.map((h) => [Keyboard.button.callback(h.title || 'Дом', `summary:${period.data}:${h.id}`)])
        );
        const text = 'Вы состоите в нескольких домах. Выберите нужный дом:';
        let edited = false;
        if (statusMid) {
          try {
            await this.options.botApi.editMessage(statusMid, {
              text,
              attachments: [keyboard],
            });
            edited = true;
          } catch {
            edited = false;
          }
        }
        if (!edited) {
          await this.options.botApi.sendMessageToUser(user.user_id, text, { attachments: [keyboard] });
          if (statusMid) await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
        }
        if (statusMid && this.pendingStatusMids.get(user.user_id) === statusMid) {
          this.pendingStatusMids.delete(user.user_id);
        }
        return true;
      }

      if (error instanceof SummaryAccessError) {
        let text = 'Сначала заполните профиль и подтвердите принадлежность к домовому чату.';
        if (error.code === 'LEFT_CHAT') {
          text = error.homeTitle
            ? `Вы больше не состоите в домовом чате «${error.homeTitle}». Доступ к сводкам и уведомлениям QuietChat приостановлен. Чтобы возобновить доступ, вступите в домовой чат.`
            : 'Вы больше не состоите в домовом чате. Доступ к сводкам и уведомлениям QuietChat приостановлен. Чтобы возобновить доступ, вступите в домовой чат.';
        }
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

        if (this.activeRequestSeq.get(user.user_id) !== requestId) {
          if (statusMid) {
            await this.options.botApi.deleteMessage(statusMid).catch(() => undefined);
            if (this.pendingStatusMids.get(user.user_id) === statusMid) {
              this.pendingStatusMids.delete(user.user_id);
            }
          }
          return true;
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
