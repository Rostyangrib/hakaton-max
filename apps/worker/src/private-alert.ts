import type { MessageTrigger } from './detectors.js';

export interface PrivateMessageApi {
  sendMessageToUser(userId: number, text: string): Promise<unknown>;
}

export function createAlertText(trigger: MessageTrigger, senderName: string, messageText: string): string {
  const compactText = messageText.trim().replace(/\s+/g, ' ');
  const excerpt = compactText.length > 240 ? `${compactText.slice(0, 237)}…` : compactText;
  return [
    `🔔 В домовом чате упомянули: ${trigger.label}.`,
    '',
    `«${excerpt}»`,
    `Автор: ${senderName}`,
  ].join('\n');
}

export async function sendPrivateAlert(
  api: PrivateMessageApi,
  userId: number,
  trigger: MessageTrigger,
  senderName: string,
  messageText: string,
): Promise<void> {
  await api.sendMessageToUser(userId, createAlertText(trigger, senderName, messageText));
}
