import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from '@quiet-chat/config';
import type { HealthResponse } from '@quiet-chat/shared';

export interface AppDependencies {
  config: AppConfig;
  databaseCheck: () => Promise<void>;
}

function healthPayload(status: HealthResponse['status']): HealthResponse {
  return {
    status,
    service: 'api',
    timestamp: new Date().toISOString(),
  };
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: dependencies.config.NODE_ENV !== 'test' });

  await app.register(cors, {
    origin: dependencies.config.WEB_ORIGIN,
    credentials: true,
  });

  app.get('/health/live', async (_request, reply) => {
    return reply.code(200).send(healthPayload('ok'));
  });

  app.get('/health/ready', async (_request, reply) => {
    try {
      await dependencies.databaseCheck();
      return reply.code(200).send(healthPayload('ok'));
    } catch (error) {
      app.log.error({ error }, 'Database readiness check failed');
      return reply.code(503).send(healthPayload('error'));
    }
  });

  return app;
}
