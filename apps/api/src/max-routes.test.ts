import { createHmac } from 'node:crypto';

import { loadConfig } from '@quiet-chat/config';
import type { MaxUpdate, MaxUser, ResidentProfile, ResidentProfileInput } from '@quiet-chat/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import { createSession } from './auth.js';
import type { ApiServices } from './contracts.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function services(overrides: Partial<ApiServices> = {}): ApiServices {
  return {
    profiles: {
      upsertUser: vi.fn(async (_user: MaxUser) => {}),
      getProfile: vi.fn(async () => null),
      saveProfile: vi.fn(async (_userId: bigint, _chatId: bigint, input: ResidentProfileInput, verifiedAt: Date): Promise<ResidentProfile> => ({
        ...input,
        properties: input.properties ?? [],
        vehicles: input.vehicles ?? [],
        floor: input.floor ?? null,
        carPlate: input.carPlate ?? null,
        carDescription: input.carDescription ?? null,
        membershipVerifiedAt: verifiedAt.toISOString(),
        updatedAt: verifiedAt.toISOString(),
      })),
      deleteProfile: vi.fn(async () => true),
    },
    webhookInbox: { enqueue: vi.fn(async (_key: string, _update: MaxUpdate) => true) },
    membership: { isMember: vi.fn(async () => true) },
    ...overrides,
  };
}

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    MAX_BOT_TOKEN: 'test-token',
    MAX_WEBHOOK_SECRET: 'webhook-secret',
    MAX_HOME_CHAT_ID: '777',
    SESSION_SECRET: 'session-secret-with-enough-entropy',
  });
}

describe('MAX webhook', () => {
  it('rejects a wrong secret and enqueues a valid event once', async () => {
    const webhookInbox = { enqueue: vi.fn(async () => true) };
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: services({ webhookInbox }) });
    apps.push(app);
    const body = { update_type: 'bot_started', timestamp: 1, chat_id: 5, user: { user_id: 10 } };

    expect((await app.inject({ method: 'POST', url: '/webhooks/max', payload: body })).statusCode).toBe(401);
    const accepted = await app.inject({
      method: 'POST',
      url: '/webhooks/max',
      headers: { 'x-max-bot-api-secret': 'webhook-secret' },
      payload: body,
    });
    expect(accepted.statusCode).toBe(202);
    expect(webhookInbox.enqueue).toHaveBeenCalledOnce();

    const platformUpdate = await app.inject({
      method: 'POST',
      url: '/webhooks/max',
      headers: { 'x-max-bot-api-secret': 'webhook-secret' },
      payload: { update_type: 'message_read', timestamp: 2 },
    });
    expect(platformUpdate.statusCode).toBe(202);
  });
});

describe('profile routes', () => {
  it('requires a session and verifies chat membership before save', async () => {
    const membership = { isMember: vi.fn(async () => false) };
    const profileServices = services({ membership });
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);
    const payload = { apartment: 54, entrance: 3, floor: 8, carPlate: 'А123ВС77', carDescription: 'Белая Camry', alertsEnabled: true };

    expect((await app.inject({ method: 'PUT', url: '/api/profile', payload })).statusCode).toBe(401);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;
    expect((await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload })).statusCode).toBe(403);

    membership.isMember.mockResolvedValue(true);
    const saved = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.apartment).toBe(54);
    expect(profileServices.profiles.saveProfile).toHaveBeenCalledOnce();

    const savedWithBearer = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { authorization: `Bearer ${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}` },
      payload,
    });
    expect(savedWithBearer.statusCode).toBe(200);
    expect(savedWithBearer.json().data.apartment).toBe(54);
  });

  it('saves multiple vehicles for a resident profile', async () => {
    const profileServices = services();
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;
    const payload = {
      apartment: 54,
      entrance: 3,
      floor: 8,
      vehicles: [
        { plate: 'А123ВС77', description: 'Белая Camry' },
        { plate: 'В456ОР77', description: 'Черный Haval' },
      ],
      alertsEnabled: true,
    };

    const saved = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload });
    expect(saved.statusCode).toBe(200);
    const data = saved.json().data;
    expect(data.apartment).toBe(54);
    expect(data.vehicles).toHaveLength(2);
    expect(data.vehicles[0].plate).toBe('А123ВС77');
    expect(data.vehicles[1].description).toBe('Черный Haval');
  });

  it('returns membership status, chat title and join url in GET /api/profile, and localized error on save if not member', async () => {
    const membership = {
      isMember: vi.fn(async () => false),
      getChatInfo: vi.fn(async () => ({ title: 'ЖК Тихий Дом', chatUrl: 'https://max.ru/chat-123' })),
    };
    const profileServices = services({
      membership,
      profiles: {
        ...services().profiles,
        getHome: vi.fn(async () => ({ title: 'ЖК Тихий Дом', chatUrl: 'https://max.ru/chat-123' })),
      },
    });
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;

    const getRes = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.data.isMember).toBe(false);
    expect(body.data.homeChatTitle).toBe('ЖК Тихий Дом');
    expect(body.data.homeChatUrl).toBe('https://max.ru/chat-123');

    // PUT when not member returns localized error in Russian
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie },
      payload: { apartment: 54, entrance: 3, floor: 8, alertsEnabled: true },
    });
    expect(putRes.statusCode).toBe(403);
    expect(putRes.json().error.message).toContain('Вы не являетесь участником домового чата');
    expect(putRes.json().error.message).toContain('ЖК Тихий Дом');
  });

  it('rejects invalid chatId query parameters with 400 Bad Request', async () => {
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: services() });
    apps.push(app);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;

    const res = await app.inject({ method: 'GET', url: '/api/profile?chatId=not-a-number', headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CHAT_ID');
  });

  it('returns saved profile fields with isMember=false when user is not member and auto-verifies when they rejoin', async () => {
    const verifyMembership = vi.fn(async () => {});
    const membership = {
      isMember: vi.fn(async () => false),
      invalidate: vi.fn(),
    };
    const profileServices = services({
      membership,
      profiles: {
        ...services().profiles,
        getProfile: vi.fn(async () => ({
          apartment: 54,
          entrance: 3,
          floor: 8,
          carPlate: 'А123ВС77',
          carDescription: 'Белая Camry',
          properties: [],
          vehicles: [],
          alertsEnabled: true,
          membershipVerifiedAt: null,
          updatedAt: new Date().toISOString(),
        })),
        verifyMembership,
      },
    });
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;

    // 1. User not in chat: returns saved profile data + isMember: false
    const res1 = await app.inject({ method: 'GET', url: '/api/profile?refresh=1', headers: { cookie } });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().data.apartment).toBe(54);
    expect(res1.json().data.isMember).toBe(false);
    expect(verifyMembership).not.toHaveBeenCalled();
    expect(membership.invalidate).toHaveBeenCalled();

    // 2. User rejoins chat: isMember becomes true, auto-verifies membership
    membership.isMember.mockResolvedValue(true);
    const res2 = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.isMember).toBe(true);
    expect(verifyMembership).toHaveBeenCalledWith(10n, 777n);
  });

  it('returns availableHomes and handles null profile without undefined strings', async () => {
    const profileServices = services({
      profiles: {
        ...services().profiles,
        getProfile: vi.fn(async () => null),
        getActiveHomes: vi.fn(async () => [
          { maxChatId: 777n, title: 'Тестовый дом 1', chatUrl: 'https://max.ru/chat1' },
          { maxChatId: 888n, title: 'Тестовый дом 2', chatUrl: 'https://max.ru/chat2' },
        ]),
      },
      membership: {
        isMember: vi.fn(async (chatId: number) => chatId === 777),
      },
    });
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;

    const res = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.profile).toBeNull();
    expect(data.apartment).toBeUndefined(); // null profile should not spread undefined fields as strings
    expect(data.availableHomes).toHaveLength(2);
    expect(data.availableHomes[0]).toEqual({
      chatId: '777',
      title: 'Тестовый дом 1',
      isMember: true,
      chatUrl: 'https://max.ru/chat1',
    });
    expect(data.availableHomes[1]).toEqual({
      chatId: '888',
      title: 'Тестовый дом 2',
      isMember: false,
      chatUrl: 'https://max.ru/chat2',
    });
  });

  it('saves profile for specific chatId provided in body or query', async () => {
    const saveProfile = vi.fn(async (_userId: bigint, _chatId: bigint, input: ResidentProfileInput, verifiedAt: Date): Promise<ResidentProfile> => ({
      ...input,
      properties: input.properties ?? [],
      vehicles: input.vehicles ?? [],
      floor: input.floor ?? null,
      carPlate: input.carPlate ?? null,
      carDescription: input.carDescription ?? null,
      membershipVerifiedAt: verifiedAt.toISOString(),
      updatedAt: verifiedAt.toISOString(),
    }));
    const profileServices = services({
      profiles: {
        ...services().profiles,
        saveProfile,
      },
      membership: {
        isMember: vi.fn(async () => true),
      },
    });
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);
    const cookie = `quietchat_session=${createSession(10n, 'session-secret-with-enough-entropy', 3_600)}`;

    const payload = { chatId: '888', apartment: 101, entrance: 2, floor: 5, alertsEnabled: true };
    const saved = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload });
    expect(saved.statusCode).toBe(200);
    expect(saveProfile).toHaveBeenCalledWith(10n, 888n, expect.objectContaining({ apartment: 101 }), expect.any(Date));
  });
});

describe('MAX initData auth route', () => {
  it('authenticates user by valid signed initData with id and returns sessionToken', async () => {
    const profileServices = services();
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      auth_date: String(nowSeconds),
      query_id: 'test-query-max',
      user: JSON.stringify({
        id: 215608884,
        first_name: 'Иван',
        last_name: null,
        username: null,
      }),
    });
    const checkString = [...params.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update('test-token').digest();
    params.set('hash', createHmac('sha256', secretKey).update(checkString).digest('hex'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: params.toString() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.displayName).toBe('Иван');
    expect(body.data.sessionToken).toBeDefined();
    expect(response.headers['set-cookie']).toContain('quietchat_session=');
    expect(profileServices.profiles.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 215608884, first_name: 'Иван' }),
    );
  });
});

describe('token auth route', () => {
  it('authenticates user by valid signed token and sets session cookie and returns sessionToken', async () => {
    const profileServices = services({
      profiles: {
        ...services().profiles,
        getUser: vi.fn(async () => ({ displayName: 'Ростислав Затопляев' })),
      },
    });
    const app = await buildApp({ config: config(), databaseCheck: async () => {}, services: profileServices });
    apps.push(app);

    const validToken = createSession(215608884n, 'session-secret-with-enough-entropy', 3_600);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { token: validToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.displayName).toBe('Ростислав Затопляев');
    expect(response.json().data.sessionToken).toBe(validToken);
    expect(response.headers['set-cookie']).toContain('quietchat_session=');

    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { token: 'invalid.token' },
    });
    expect(invalidResponse.statusCode).toBe(401);
  });
});

