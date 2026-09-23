import { useEffect, useState, type FormEvent } from 'react';

import type { ApiEnvelope, ResidentProfile } from '@quiet-chat/shared';

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';

type FormState = {
  apartment: string;
  entrance: string;
  floor: string;
  carPlate: string;
  carDescription: string;
  alertsEnabled: boolean;
};

const emptyForm: FormState = {
  apartment: '',
  entrance: '',
  floor: '',
  carPlate: '',
  carDescription: '',
  alertsEnabled: true,
};

let activeSessionToken: string | null = null;
try {
  activeSessionToken = sessionStorage.getItem('quietchat_token');
} catch {}

function setSessionToken(token: string | undefined) {
  if (!token) return;
  activeSessionToken = token;
  try {
    sessionStorage.setItem('quietchat_token', token);
  } catch {}
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(activeSessionToken ? { authorization: `Bearer ${activeSessionToken}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? 'Не удалось выполнить запрос');
  return payload.data as T;
}

function fromProfile(profile: ResidentProfile | null): FormState {
  if (!profile) return emptyForm;
  return {
    apartment: String(profile.apartment),
    entrance: String(profile.entrance),
    floor: profile.floor === null || profile.floor === undefined ? '' : String(profile.floor),
    carPlate: profile.carPlate ?? '',
    carDescription: profile.carDescription ?? '',
    alertsEnabled: profile.alertsEnabled,
  };
}

export function App() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState('Подключаемся к MAX…');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hashString = window.location.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hashString);
    const token = urlParams.get('token') || hashParams.get('token');

    const bridge = window.WebApp;
    bridge?.ready?.();
    bridge?.expand?.();
    const initData =
      bridge?.initData ||
      hashParams.get('WebAppData') ||
      urlParams.get('WebAppData') ||
      hashParams.get('initData') ||
      urlParams.get('initData') ||
      hashParams.get('tgWebAppData') ||
      urlParams.get('tgWebAppData');

    if (!initData && !token && !activeSessionToken) {
      setPhase('error');
      setMessage('Откройте профиль кнопкой «Открыть профиль» в диалоге с ботом MAX.');
      return;
    }

    void (async () => {
      try {
        if (token) {
          const auth = await api<{ displayName: string; sessionToken?: string }>('/api/auth/token', {
            method: 'POST',
            body: JSON.stringify({ token }),
          });
          setSessionToken(auth.sessionToken);
          setDisplayName(auth.displayName);
        } else if (initData) {
          const cleanInitData = initData.replace(/^[#?]/, '');
          const auth = await api<{ displayName: string; sessionToken?: string }>('/api/auth/max', {
            method: 'POST',
            body: JSON.stringify({ initData: cleanInitData }),
          });
          setSessionToken(auth.sessionToken);
          setDisplayName(auth.displayName);
        }
        const profile = await api<ResidentProfile | null>('/api/profile');
        setForm(fromProfile(profile));
        setPhase('ready');
        setMessage(profile ? 'Профиль заполнен' : 'Заполните данные для персональных уведомлений');
      } catch (error) {
        activeSessionToken = null;
        try {
          sessionStorage.removeItem('quietchat_token');
        } catch {}
        setPhase('error');
        setMessage(error instanceof Error ? error.message : 'Не удалось открыть профиль');
      }
    })();
  }, []);

  function change<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setPhase('saving');
    setMessage('Сохраняем…');
    try {
      const profile = await api<ResidentProfile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          apartment: Number(form.apartment),
          entrance: Number(form.entrance),
          floor: form.floor ? Number(form.floor) : null,
          carPlate: form.carPlate || null,
          carDescription: form.carDescription || null,
          alertsEnabled: form.alertsEnabled,
        }),
      });
      setForm(fromProfile(profile));
      setPhase('ready');
      setMessage('Готово — профиль сохранён');
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить профиль');
    }
  }

  const isStandaloneBrowser = phase === 'error' && !displayName;
  const disabled = phase === 'loading' || phase === 'saving' || isStandaloneBrowser;

  return (
    <main className="page">
      {/* Header */}
      <header className="header">
        <div className="header-text">
          <div className="header-title">ТИХИЙ ЧАТ</div>
          <div className="header-subtitle">MAX • ДОМОВОЙ СЕРВИС</div>
        </div>
        <div className="header-illustration" aria-hidden="true">
          <svg
            width="128"
            height="64"
            viewBox="0 0 128 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="header-houses"
          >
            {/* Building 1 (left sloped roof) */}
            <path
              d="M 10 38 L 26 29 L 26 64 M 14 36 L 14 64"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Building 2 (flat roof) */}
            <path
              d="M 26 35 L 40 35 L 40 64"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="31" y="46" width="5" height="9" stroke="#8EA1B1" strokeWidth="1.3" rx="0.5" />

            {/* Sloped roof behind building 2 */}
            <path d="M 36 26 L 55 14" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M 41 23 L 41 35" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M 52 16 L 52 20" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />

            {/* Building 3 (tall center tower) */}
            <path
              d="M 55 4 L 82 4 L 82 64 M 55 14 L 55 64"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="66" y="8" width="6" height="9" stroke="#8EA1B1" strokeWidth="1.3" rx="0.5" />
            <rect x="66" y="21" width="6" height="10" stroke="#8EA1B1" strokeWidth="1.3" rx="0.5" />
            <line x1="66" y1="26" x2="72" y2="26" stroke="#8EA1B1" strokeWidth="1.1" />
            <rect x="66" y="35" width="6" height="6" stroke="#8EA1B1" strokeWidth="1.3" rx="0.5" />
            <line x1="59" y1="22" x2="60.5" y2="22" stroke="#8EA1B1" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="59" y1="30" x2="60.5" y2="30" stroke="#8EA1B1" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="59" y1="39" x2="61.5" y2="39" stroke="#8EA1B1" strokeWidth="1.5" strokeLinecap="round" />
            {/* Lit yellow window */}
            <rect x="66" y="46" width="6" height="9" fill="#F3AE0D" rx="0.5" />

            {/* Building 4 (right gable roof) */}
            <path
              d="M 82 9 L 106 20 L 106 64"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M 93 11 L 93 17 M 91 14 L 95 14" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />
            {/* Lit yellow window */}
            <rect x="92" y="27" width="6" height="9" fill="#F3AE0D" rx="0.5" />
            <rect x="92" y="46" width="6" height="9" stroke="#8EA1B1" strokeWidth="1.3" rx="0.5" />
          </svg>
        </div>
      </header>
      <div className="header-divider" />

      {/* Hero Section */}
      <h1 className="hero-title">
        Важное —<br />
        только для вас
      </h1>
      <p className="hero-subtitle">
        Настройте профиль, чтобы бот отличал действительно важные сообщения от общего шума.
      </p>

      {/* User Badge */}
      <div className="user-badge">
        <div className="user-avatar" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#738B9D">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
        <span className="user-name">{displayName || 'Ростислав Затопляев'}</span>
      </div>

      <form className="form" onSubmit={(event) => void save(event)}>
        {/* Section 01 - Адрес */}
        <section aria-labelledby="section-01-title">
          <div className="section-header">
            <span className="section-number section-number--active">01</span>
            <div className="section-separator" aria-hidden="true" />
            <div className="section-title-wrap">
              <h2 id="section-01-title" className="section-title">
                Адрес
              </h2>
              <span className="section-subtitle">Обязательные данные</span>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Квартира</span>
            <input
              required
              inputMode="numeric"
              min="1"
              max="9999"
              placeholder="54"
              value={form.apartment}
              onChange={(e) => change('apartment', e.target.value)}
              className="text-input"
            />
          </label>

          <div className="grid-two">
            <label className="field">
              <span className="field-label">Подъезд</span>
              <input
                required
                inputMode="numeric"
                min="1"
                max="999"
                placeholder="3"
                value={form.entrance}
                onChange={(e) => change('entrance', e.target.value)}
                className="text-input"
              />
            </label>
            <label className="field">
              <span className="field-label">Этаж</span>
              <input
                inputMode="numeric"
                min="-9"
                max="999"
                placeholder="8"
                value={form.floor}
                onChange={(e) => change('floor', e.target.value)}
                className="text-input"
              />
            </label>
          </div>
        </section>

        <div className="divider" />

        {/* Section 02 - Автомобиль */}
        <section aria-labelledby="section-02-title">
          <div className="section-header">
            <span className="section-number section-number--inactive">02</span>
            <div className="section-separator" aria-hidden="true" />
            <div className="section-title-wrap">
              <h2 id="section-02-title" className="section-title">
                Автомобиль
              </h2>
              <span className="section-subtitle">Можно пропустить</span>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Госномер</span>
            <input
              maxLength={32}
              autoCapitalize="characters"
              placeholder="A123BC77"
              value={form.carPlate}
              onChange={(e) => change('carPlate', e.target.value)}
              className="text-input"
            />
          </label>

          <label className="field">
            <span className="field-label">Описание</span>
            <div className="input-with-counter">
              <input
                maxLength={100}
                placeholder="Белая Toyota Camry"
                value={form.carDescription}
                onChange={(e) => change('carDescription', e.target.value)}
                className="text-input text-input--with-counter"
              />
              <span className="char-counter">{form.carDescription.length} / 100</span>
            </div>
          </label>
        </section>

        <div className="divider" />

        {/* Notifications */}
        <div className="notifications-row">
          <div className="notifications-info">
            <div className="notifications-icon" aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#188DB5"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="notifications-title">Личные уведомления</div>
              <div className="notifications-subtitle">Бот напишет вам напрямую</div>
            </div>
          </div>

          <label className="toggle-switch" aria-label="Личные уведомления">
            <input
              type="checkbox"
              checked={form.alertsEnabled}
              onChange={(e) => change('alertsEnabled', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        {/* Status Banner */}
        <div className={`status-banner status-banner--${phase}`} role="status" aria-live="polite">
          <div className="status-banner__icon" aria-hidden="true">
            {phase === 'error' ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8.5L6.5 12L13 4.5" />
              </svg>
            )}
          </div>
          <span className="status-banner__text">
            {phase === 'saving'
              ? 'Сохраняем…'
              : phase === 'error'
                ? message
                : 'Профиль заполнен'}
          </span>
        </div>

        {/* Standalone Browser Helper Link */}
        {isStandaloneBrowser && (
          <div className="browser-fallback">
            <a
              href="https://max.ru/se14396800_bot"
              target="_blank"
              rel="noreferrer"
              className="browser-fallback-link"
            >
              Открыть диалог с ботом в МАКС
            </a>
          </div>
        )}

        {/* Submit CTA Button */}
        <button type="submit" className="submit-button" disabled={disabled}>
          {phase === 'saving' ? 'Сохранение…' : 'Сохранить изменения'}
        </button>

        {/* Footer */}
        <div className="footer-privacy">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#738B9D"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>Данные видит только бот QuietChat</span>
        </div>
      </form>
    </main>
  );
}
