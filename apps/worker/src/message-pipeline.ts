import { createHash } from 'node:crypto';

import type { MaxUpdate } from '@quiet-chat/shared';

import {
  detectMessageTriggers,
  matchCarDescription,
  normalizeText,
  triggerMatchesProfile,
  type MessageTrigger,
} from './detectors.js';
import { sendPrivateAlert, type PrivateMessageApi } from './private-alert.js';

export interface IncomingMessage {
  maxMessageId: string;
  chatId: number;
  chatType: string;
  senderUserId: number;
  senderDisplayName: string;
  text: string;
  sentAt: Date;
}

export interface StoredMessage extends IncomingMessage {
  id: string;
  homeId: string;
}

export interface AlertProperty {
  id?: string | undefined;
  title?: string | undefined;
  chatId?: number | undefined;
  apartment: number;
  entrance: number;
  floor?: number | null | undefined;
}

export interface AlertVehicle {
  id?: string | undefined;
  plate?: string | null | undefined;
  plateNormalized?: string | null | undefined;
  description?: string | null | undefined;
}

export interface AlertProfile {
  id: string;
  maxUserId: bigint;
  apartment: number;
  entrance: number;
  carPlateNormalized: string | null;
  carDescription: string | null;
  properties?: AlertProperty[] | null;
  vehicles?: AlertVehicle[] | null;
}

export interface DeliveryReservation {
  id: string;
}

export interface MessageRepository {
  ensureHome(maxChatId: bigint): Promise<string>;
  upsertCreated(homeId: string, message: IncomingMessage, normalizedText: string, payloadHash: string): Promise<StoredMessage>;
  updateEdited(homeId: string, message: IncomingMessage, normalizedText: string, payloadHash: string): Promise<StoredMessage | null>;
  markDeleted(homeId: string, maxMessageId: string, deletedAt: Date): Promise<boolean>;
  findAlertProfiles(homeId: string, senderUserId: bigint): Promise<AlertProfile[]>;
  reserveDelivery(input: {
    profileId: string;
    messageId: string;
    senderUserId: bigint;
    trigger: MessageTrigger;
    antifloodMinutes: number;
  }): Promise<DeliveryReservation | null>;
  markDeliveryDone(id: string, sentAt: Date): Promise<void>;
  markDeliveryFailed(id: string, error: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function timestampToDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function senderName(sender: Record<string, unknown>): string | null {
  const firstName = typeof sender.first_name === 'string' ? sender.first_name.trim() : '';
  const lastName = typeof sender.last_name === 'string' ? sender.last_name.trim() : '';
  const deprecatedName = typeof sender.name === 'string' ? sender.name.trim() : '';
  const username = typeof sender.username === 'string' ? sender.username.trim() : '';
  return [firstName, lastName].filter(Boolean).join(' ') || deprecatedName || username || 'Жилец';
}

export function parseIncomingMessage(value: unknown): IncomingMessage | null {
  if (!isRecord(value) || !isRecord(value.sender) || !isRecord(value.recipient) || !isRecord(value.body)) return null;
  const rawSenderId = value.sender.user_id ?? value.sender.id;
  const senderId =
    typeof rawSenderId === 'number'
      ? rawSenderId
      : typeof rawSenderId === 'string' && /^\d+$/.test(rawSenderId)
        ? Number(rawSenderId)
        : null;
  const chatId = value.recipient.chat_id;
  const chatType = value.recipient.chat_type;
  const maxMessageId = value.body.mid;
  const text = value.body.text;
  const sentAt = timestampToDate(value.timestamp);
  const displayName = senderName(value.sender);
  if (
    !senderId ||
    !Number.isSafeInteger(senderId) ||
    !Number.isSafeInteger(chatId) ||
    typeof chatType !== 'string' ||
    typeof maxMessageId !== 'string' ||
    typeof text !== 'string' ||
    !sentAt ||
    !displayName
  ) return null;
  return {
    maxMessageId,
    chatId: chatId as number,
    chatType,
    senderUserId: senderId,
    senderDisplayName: displayName,
    text,
    sentAt,
  };
}

export class MessagePipeline {
  constructor(
    private readonly repository: MessageRepository,
    private readonly privateApi: PrivateMessageApi,
    private readonly homeChatId: number | null | undefined,
    private readonly antifloodMinutes: number,
  ) {}

  async handle(update: MaxUpdate): Promise<boolean> {
    if (update.update_type === 'message_removed') return this.handleRemoved(update);
    if (update.update_type !== 'message_created' && update.update_type !== 'message_edited') return false;

    const message = parseIncomingMessage(update.message);
    if (!message || message.chatType !== 'chat' || !message.text.trim()) return false;
    if (this.homeChatId != null && message.chatId !== this.homeChatId) return false;
    const homeId = await this.repository.ensureHome(BigInt(message.chatId));
    const normalized = normalizeText(message.text);
    const payloadHash = createHash('sha256').update(message.text).digest('hex');
    const stored = update.update_type === 'message_created'
      ? await this.repository.upsertCreated(homeId, message, normalized, payloadHash)
      : await this.repository.updateEdited(homeId, message, normalized, payloadHash);
    if (!stored) return true;
    await this.createAlerts(stored);
    return true;
  }

  private async handleRemoved(update: MaxUpdate): Promise<boolean> {
    const chatId = update.chat_id;
    const messageId = update.message_id;
    if (typeof chatId !== 'number' || !Number.isSafeInteger(chatId) || typeof messageId !== 'string') return false;
    if (this.homeChatId != null && chatId !== this.homeChatId) return false;
    const homeId = await this.repository.ensureHome(BigInt(chatId));
    await this.repository.markDeleted(homeId, messageId, timestampToDate(update.timestamp) ?? new Date());
    return true;
  }

  private async createAlerts(message: StoredMessage): Promise<void> {
    const profiles = await this.repository.findAlertProfiles(message.homeId, BigInt(message.senderUserId));
    const baseTriggers = detectMessageTriggers(message.text);

    for (const profile of profiles) {
      const triggers = baseTriggers.filter((trigger) => triggerMatchesProfile(trigger, profile));

      const allVehicles: AlertVehicle[] = profile.vehicles && profile.vehicles.length > 0
        ? profile.vehicles
        : (profile.carDescription || profile.carPlateNormalized
          ? [{ plateNormalized: profile.carPlateNormalized, description: profile.carDescription }]
          : []);

      for (const vehicle of allVehicles) {
        if (vehicle.description) {
          const descriptionTrigger = matchCarDescription(message.text, vehicle.description);
          if (descriptionTrigger) triggers.push(descriptionTrigger);
        }
      }
      if (profile.carDescription && !allVehicles.some((v) => v.description === profile.carDescription)) {
        const legacyTrigger = matchCarDescription(message.text, profile.carDescription);
        if (legacyTrigger) triggers.push(legacyTrigger);
      }

      const uniqueTriggers = [...new Map(triggers.map((trigger) => [`${trigger.type}:${trigger.value}`, trigger])).values()];
      for (const trigger of uniqueTriggers) {
        const reservation = await this.repository.reserveDelivery({
          profileId: profile.id,
          messageId: message.id,
          senderUserId: BigInt(message.senderUserId),
          trigger,
          antifloodMinutes: this.antifloodMinutes,
        });
        if (!reservation) continue;

        try {
          const recipientId = Number(profile.maxUserId);
          if (!Number.isSafeInteger(recipientId)) throw new Error('MAX user id exceeds JavaScript safe integer range');
          await sendPrivateAlert(this.privateApi, recipientId, trigger, message.senderDisplayName, message.text);
          await this.repository.markDeliveryDone(reservation.id, new Date());
          break;
        } catch (error) {
          const messageText = error instanceof Error ? error.message : 'Unknown delivery error';
          await this.repository.markDeliveryFailed(reservation.id, messageText.slice(0, 2_000));
          throw error;
        }
      }
    }
  }
}
