import { Keyboard } from '@maxhub/max-bot-api';

export const welcomeText = [
  'Привет! Я помогу не пропускать важное в домовом чате.',
  '',
  'Заполни профиль: квартиру, подъезд и при желании автомобиль. Уведомления будут приходить только сюда, в личный диалог.',
  '',
  'Нажми «Заполнить профиль» ниже для перехода к форме.',
  '',
  'Также здесь можно получить краткую сводку событий дома.',
].join('\n');

export function createWelcomeKeyboard(appTarget: string, directUrl?: string, contactId?: number) {
  const isUrl = appTarget.startsWith('http://') || appTarget.startsWith('https://');
  const webApp = isUrl ? 'se14396800_bot' : appTarget;
  const webUrl = directUrl ?? (isUrl ? appTarget : undefined);

  const topRow = [Keyboard.button.openApp('Открыть профиль', webApp, contactId)];
  if (webUrl) {
    topRow.push(Keyboard.button.link('Заполнить профиль', webUrl));
  }

  return Keyboard.inlineKeyboard([
    topRow,
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
