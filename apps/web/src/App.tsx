import { useEffect, useState, type FormEvent } from 'react';

import type { ApiEnvelope, ResidentProfile } from '@quiet-chat/shared';

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';

type VehicleState = {
  plate: string;
  description: string;
};

type FormState = {
  apartment: string;
  entrance: string;
  floor: string;
  vehicles: VehicleState[];
  alertsEnabled: boolean;
};

const emptyForm: FormState = {
  apartment: '',
  entrance: '',
  floor: '',
  vehicles: [{ plate: '', description: '' }],
  alertsEnabled: true,
};

let activeSessionToken: string | null = null;
try {
  activeSessionToken = sessionStorage.getItem('quietchat_token');
} catch {
  // ignore storage read error
}

function setSessionToken(token: string | undefined) {
  if (!token) return;
  activeSessionToken = token;
  try {
    sessionStorage.setItem('quietchat_token', token);
  } catch {
    // ignore storage write error
  }
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

  const vehicles: VehicleState[] =
    profile.vehicles && profile.vehicles.length > 0
      ? profile.vehicles.map((v) => ({
          plate: v.plate ?? '',
          description: v.description ?? '',
        }))
      : [
          {
            plate: profile.carPlate ?? '',
            description: profile.carDescription ?? '',
          },
        ];

  return {
    apartment: String(profile.apartment),
    entrance: String(profile.entrance),
    floor: profile.floor === null || profile.floor === undefined ? '' : String(profile.floor),
    vehicles,
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

    const isDemo = urlParams.get('demo') === '1' || hashParams.get('demo') === '1';
    if (isDemo) {
      setDisplayName('Ростислав Затопляев');
      setForm({
        apartment: '54',
        entrance: '3',
        floor: '8',
        vehicles: [{ plate: 'A123BC77', description: 'Белая Toyota Camry' }],
        alertsEnabled: true,
      });
      setPhase('ready');
      setMessage('Профиль заполнен');
      return;
    }

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
        } catch {
          // ignore storage remove error
        }
        setPhase('error');
        setMessage(error instanceof Error ? error.message : 'Не удалось открыть профиль');
      }
    })();
  }, []);

  function change(key: 'apartment' | 'entrance' | 'floor', val: string) {
    setForm((current) => ({ ...current, [key]: val }));
  }

  function updateVehicle(index: number, key: keyof VehicleState, val: string) {
    setForm((current) => {
      const next = [...current.vehicles];
      next[index] = { ...next[index]!, [key]: val };
      return { ...current, vehicles: next };
    });
  }

  function addVehicle() {
    setForm((current) => ({
      ...current,
      vehicles: [...current.vehicles, { plate: '', description: '' }],
    }));
  }

  function removeVehicle(index: number) {
    setForm((current) => ({
      ...current,
      vehicles:
        current.vehicles.length > 1
          ? current.vehicles.filter((_, i) => i !== index)
          : [{ plate: '', description: '' }],
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setPhase('saving');
    setMessage('Сохраняем…');
    try {
      const validVehicles = form.vehicles.filter((v) => v.plate.trim() || v.description.trim());
      const primaryPlate = validVehicles.find((v) => v.plate.trim())?.plate.trim() || null;
      const primaryDesc = validVehicles.find((v) => v.description.trim())?.description.trim() || null;

      const profile = await api<ResidentProfile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          apartment: Number(form.apartment || 1),
          entrance: Number(form.entrance || 1),
          floor: form.floor ? Number(form.floor) : null,
          carPlate: primaryPlate,
          carDescription: primaryDesc,
          vehicles: validVehicles.map((v) => ({
            plate: v.plate.trim() || null,
            description: v.description.trim() || null,
          })),
          alertsEnabled: form.alertsEnabled,
        }),
      });
      setForm(fromProfile(profile));
      setPhase('ready');
      setMessage('Профиль заполнен');
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
            height="72"
            viewBox="0 0 128 72"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="header-houses"
          >
            {/* Building 1 (leftmost, sloped roof) */}
            <path
              d="M 11 47 L 28.5 37 L 28.5 72 M 16 44 L 16 72"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Building 2 (flat roof) */}
            <path
              d="M 28.5 41 L 43.5 41 L 43.5 72"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="34" y="54" width="5" height="8" rx="0.5" stroke="#8EA1B1" strokeWidth="1.3" />

            {/* Sloped roof connecting Building 2 to Tower */}
            <path d="M 39 27 L 55 18" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />
            {/* Curved streetlamp bracket on tower wall */}
            <path
              d="M 55 20 C 50 20 46 22 46 27"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
            />

            {/* Building 3 (Tall Tower) */}
            <path
              d="M 55 3 L 85 3 L 85 72 M 55 18 L 55 72"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Tower upper window */}
            <rect x="67.5" y="14" width="5" height="8" rx="0.5" stroke="#8EA1B1" strokeWidth="1.3" />
            {/* Tower middle stacked window */}
            <rect x="67.5" y="30" width="5" height="17" rx="0.5" stroke="#8EA1B1" strokeWidth="1.3" />
            <line x1="67.5" y1="38.5" x2="72.5" y2="38.5" stroke="#8EA1B1" strokeWidth="1.1" />
            {/* Tower 3 tick dashes */}
            <line x1="60" y1="32" x2="62.5" y2="32" stroke="#8EA1B1" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="60" y1="38.5" x2="62.5" y2="38.5" stroke="#8EA1B1" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="60" y1="45" x2="62.5" y2="45" stroke="#8EA1B1" strokeWidth="1.4" strokeLinecap="round" />
            {/* Tower lower lit yellow window */}
            <rect x="67.5" y="54" width="5" height="8" rx="0.5" fill="#F3AE0D" />

            {/* Building 4 (Right Building) */}
            <path
              d="M 85 8 L 110.5 21 L 110.5 72"
              stroke="#8EA1B1"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Roof TV antenna */}
            <line x1="96" y1="7" x2="96" y2="17" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="93.5" y1="12" x2="98.5" y2="12" stroke="#8EA1B1" strokeWidth="1.3" strokeLinecap="round" />
            {/* Upper lit yellow window */}
            <rect x="96" y="31" width="5" height="8" rx="0.5" fill="#F3AE0D" />
            {/* Lower outline window */}
            <rect x="96" y="54" width="5" height="8" rx="0.5" stroke="#8EA1B1" strokeWidth="1.3" />
          </svg>
        </div>
      </header>
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

        {/* Section 02 - Автомобили */}
        <section aria-labelledby="section-02-title">
          <div className="section-header">
            <span className="section-number section-number--inactive">02</span>
            <div className="section-separator" aria-hidden="true" />
            <div className="section-title-wrap">
              <h2 id="section-02-title" className="section-title">
                Автомобили
              </h2>
              <span className="section-subtitle">Можно пропустить</span>
            </div>
          </div>

          {form.vehicles.map((veh, index) => (
            <div key={index} className="multi-item-card">
              {form.vehicles.length > 1 && (
                <div className="sub-item-header">
                  <span className="sub-item-title">Автомобиль #{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeVehicle(index)}
                    className="item-remove-btn"
                    aria-label={`Удалить автомобиль ${index + 1}`}
                  >
                    Удалить
                  </button>
                </div>
              )}
              <label className="field">
                <span className="field-label">Госномер</span>
                <input
                  maxLength={32}
                  autoCapitalize="characters"
                  placeholder="A123BC77"
                  value={veh.plate}
                  onChange={(e) => updateVehicle(index, 'plate', e.target.value)}
                  className="text-input"
                />
              </label>

              <label className="field">
                <span className="field-label">Описание</span>
                <div className="input-with-counter">
                  <textarea
                    maxLength={100}
                    rows={2}
                    placeholder="Белая Toyota Camry"
                    value={veh.description}
                    onChange={(e) => updateVehicle(index, 'description', e.target.value)}
                    className="textarea-input"
                  />
                  <span className="char-counter">{veh.description.length} / 100</span>
                </div>
              </label>
            </div>
          ))}

          <button
            type="button"
            onClick={addVehicle}
            className="add-item-btn"
          >
            + Добавить еще автомобиль
          </button>
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
                <path d="M12 2a1.8 1.8 0 0 0-1.8 1.8v0.4c-2.4 1-4.2 3.4-4.2 6.3 0 3.8-1 5.5-2 6.5h16c-1-1-2-2.7-2-6.5 0-2.9-1.8-5.3-4.2-6.3V3.8A1.8 1.8 0 0 0 12 2z" />
                <path d="M10 19a2 2 0 0 0 4 0" />
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
              onChange={(e) => setForm((c) => ({ ...c, alertsEnabled: e.target.checked }))}
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
            ) : phase === 'loading' ? (
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
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
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
              : phase === 'loading'
                ? 'Загрузка данных…'
                : phase === 'error'
                  ? message
                  : message || 'Профиль заполнен'}
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
