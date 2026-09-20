import { loadConfig } from '@quiet-chat/config';
import { healthResponseSchema } from '@quiet-chat/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('health routes', () => {
  it('reports liveness without external dependencies', async () => {
    const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), databaseCheck: async () => {} });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
  });

  it('reports readiness failure when PostgreSQL is unavailable', async () => {
    const app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      databaseCheck: async () => {
        throw new Error('database unavailable');
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(healthResponseSchema.parse(response.json()).status).toBe('error');
  });
});
