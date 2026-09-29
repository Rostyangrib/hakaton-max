import { Keyboard } from '@maxhub/max-bot-api';

export const welcomeText = [
  'Привет! Я «Тихий Чат» — помогу не пропускать важное в домовом чате.',
  '',
  'Заполни профиль: квартиру, подъезд и при желании автомобиль. Уведомления будут приходить только сюда, в личный диалог.',
  '',
  'Нажми «Открыть профиль» ниже для перехода к форме.',
  '',
  'Также здесь можно получить краткую сводку событий дома.',
].join('\n');

export function createWelcomeKeyboard(appTarget: string, _directUrl?: string, contactId?: number) {
  const isUrl = appTarget.startsWith('http://') || appTarget.startsWith('https://');
  const webApp = isUrl ? 'se14396800_bot' : appTarget;

  const topRow = [
    Keyboard.button.openApp('Открыть профиль', webApp, contactId),
  ];

  return Keyboard.inlineKeyboard([
    topRow,
    ...createSummaryButtons(),
  ]);
}

export function createSummaryButtons(homeId?: string, showChangeHome = false) {
  const suffix = homeId ? `:${homeId}` : '';
  const rows = [
    [Keyboard.button.callback('📅 Сегодня', `summary:today${suffix}`), Keyboard.button.callback('📆 7 дней', `summary:week${suffix}`)],
    [Keyboard.button.callback('🗓️ 30 дней', `summary:month${suffix}`)],
  ];
  if (showChangeHome) {
    rows.push([Keyboard.button.callback('🏠 Сменить дом', 'summary:choose_home')]);
  }
  return rows;
}

export function createSummaryKeyboard(homeId?: string, showChangeHome = false) {
  return Keyboard.inlineKeyboard(createSummaryButtons(homeId, showChangeHome));
}
