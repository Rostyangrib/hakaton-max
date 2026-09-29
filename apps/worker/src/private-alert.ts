import type { MessageTrigger } from './detectors.js';

export interface PrivateMessageApi {
  sendMessageToUser(userId: number, text: string): Promise<unknown>;
}

export function createAlertText(
  trigger: MessageTrigger,
  senderName: string,
  messageText: string,
  homeTitle?: string,
): string {
  const compactText = messageText.trim().replace(/\s+/g, ' ');
  const excerpt = compactText.length > 240 ? `${compactText.slice(0, 237)}…` : compactText;
  const header = homeTitle && homeTitle !== 'Домовой чат'
    ? `🔔 В домовом чате «${homeTitle}» упомянули: ${trigger.label}.`
    : `🔔 В домовом чате упомянули: ${trigger.label}.`;
  return [
    header,
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
  homeTitle?: string,
): Promise<void> {
  await api.sendMessageToUser(userId, createAlertText(trigger, senderName, messageText, homeTitle));
}
