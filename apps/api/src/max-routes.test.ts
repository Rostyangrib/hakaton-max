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

