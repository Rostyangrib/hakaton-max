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
  });
});

describe('token auth route', () => {
  it('authenticates user by valid signed token and sets session cookie', async () => {
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
    expect(response.headers['set-cookie']).toContain('quietchat_session=');

    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { token: 'invalid.token' },
    });
    expect(invalidResponse.statusCode).toBe(401);
  });
});

