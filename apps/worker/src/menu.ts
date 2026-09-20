import { Keyboard } from '@maxhub/max-bot-api';

export const welcomeText = [
  'Привет! Я помогу не пропускать важное в домовом чате.',
  '',
  'Заполни профиль: квартиру, подъезд и при желании автомобиль. Уведомления будут приходить только сюда, в личный диалог.',
  '',
  'Также здесь можно получить краткую сводку событий дома.',
].join('\n');

export function createWelcomeKeyboard(miniAppUrl: string) {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.openApp('Открыть профиль', miniAppUrl)],
    ...createSummaryButtons(),
  ]);
}

function createSummaryButtons() {
  return [
    [Keyboard.button.callback('📅 Сегодня', 'summary:today'), Keyboard.button.callback('📆 7 дней', 'summary:week')],
    [Keyboard.button.callback('🗓️ 30 дней', 'summary:month')],
  ];
}

export function createSummaryKeyboard() {
  return Keyboard.inlineKeyboard(createSummaryButtons());
}
