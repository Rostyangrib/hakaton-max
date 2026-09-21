import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Switch, Textarea } from '@maxhub/max-ui';

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
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
    const token = urlParams.get('token') || new URLSearchParams(window.location.hash.slice(1)).get('token');

    const bridge = window.WebApp;
    bridge?.ready?.();
    bridge?.expand?.();
    const initData = bridge?.initData;

    if (!initData && !token) {
      setPhase('error');
      setMessage('Откройте профиль кнопкой или ссылкой в диалоге с ботом MAX.');
      return;
    }

    void (async () => {
      try {
        let auth: { displayName: string };
        if (token) {
          auth = await api<{ displayName: string }>('/api/auth/token', {
            method: 'POST',
            body: JSON.stringify({ token }),
          });
        } else {
          auth = await api<{ displayName: string }>('/api/auth/max', {
            method: 'POST',
            body: JSON.stringify({ initData }),
          });
        }
        setDisplayName(auth.displayName);
        const profile = await api<ResidentProfile | null>('/api/profile');
        setForm(fromProfile(profile));
        setPhase('ready');
        setMessage(profile ? 'Профиль загружен' : 'Заполните данные для персональных уведомлений');
      } catch (error) {
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
      <header className="hero">
        <div className="logo" aria-hidden="true">ТЧ</div>
        <div>
          <p className="eyebrow">Тихий Чат</p>
          <h1>Профиль жильца</h1>
        </div>
      </header>

      <p className="intro">
        {displayName ? `${displayName}, укажите` : 'Укажите'} данные, по которым бот узнает важные сообщения для вас.
      </p>

      <form onSubmit={(event) => void save(event)}>
        <section className="section" aria-labelledby="home-title">
          <div className="section-heading">
            <span className="step">1</span>
            <div><h2 id="home-title">Дом</h2><p>Обязательные поля</p></div>
          </div>
          <label>
            <span>Квартира</span>
            <Input required inputMode="numeric" min="1" max="9999" placeholder="Например, 54" value={form.apartment} onChange={(e) => change('apartment', e.target.value)} />
          </label>
          <div className="grid-two">
            <label>
              <span>Подъезд</span>
              <Input required inputMode="numeric" min="1" max="999" placeholder="3" value={form.entrance} onChange={(e) => change('entrance', e.target.value)} />
            </label>
            <label>
              <span>Этаж</span>
              <Input inputMode="numeric" min="-9" max="999" placeholder="8" value={form.floor} onChange={(e) => change('floor', e.target.value)} />
            </label>
          </div>
        </section>

        <section className="section" aria-labelledby="car-title">
          <div className="section-heading">
            <span className="step">2</span>
            <div><h2 id="car-title">Автомобиль</h2><p>Необязательно</p></div>
          </div>
          <label>
            <span>Госномер</span>
            <Input maxLength={32} autoCapitalize="characters" placeholder="А123ВС77" value={form.carPlate} onChange={(e) => change('carPlate', e.target.value)} />
          </label>
          <label>
            <span>Описание</span>
            <Textarea maxLength={100} rows={3} placeholder="Белая Toyota Camry" value={form.carDescription} onChange={(e) => change('carDescription', e.target.value)} />
            <small>{form.carDescription.length}/100</small>
          </label>
        </section>

        <section className="notifications">
          <div><strong>Персональные уведомления</strong><p>Только в личном диалоге с ботом</p></div>
          <Switch checked={form.alertsEnabled} onChange={(e) => change('alertsEnabled', e.target.checked)} aria-label="Персональные уведомления" />
        </section>

        <div className={`notice notice--${phase}`} role="status" aria-live="polite">{message}</div>
        {isStandaloneBrowser && (
          <p style={{ marginTop: '12px', marginBottom: '16px', textAlign: 'center' }}>
            <a
              href="https://max.ru/se14396800_bot"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                padding: '12px 20px',
                borderRadius: '12px',
                background: '#3575f6',
                color: '#ffffff',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '15px',
              }}
            >
              Открыть диалог с ботом в МАКС
            </a>
          </p>
        )}
        <Button type="submit" size="large" stretched loading={phase === 'saving'} disabled={disabled}>Сохранить профиль</Button>
        <p className="privacy">Данные используются только для алертов тестового домового чата.</p>
      </form>
    </main>
  );
}
