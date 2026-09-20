import { Keyboard } from '@maxhub/max-bot-api';

export const welcomeText = [
  'Привет! Я помогу не пропускать важное в домовом чате.',
  '',
  'Заполни профиль: квартиру, подъезд и при желании автомобиль. Уведомления будут приходить только сюда, в личный диалог.',
].join('\n');

export function createWelcomeKeyboard(miniAppUrl: string) {
  return Keyboard.inlineKeyboard([[Keyboard.button.openApp('Открыть профиль', miniAppUrl)]]);
}
