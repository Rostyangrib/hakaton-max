import { createHash, timingSafeEqual } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '@quiet-chat/config';
import {
  maxUpdateSchema,
  residentProfileInputSchema,
  type ApiEnvelope,
  type HealthResponse,
} from '@quiet-chat/shared';

import { createSession, MaxInitDataError, validateMaxInitData, verifySession } from './auth.js';
import type { ApiServices } from './contracts.js';

const sessionCookie = 'quietchat_session';
const authBodySchema = z.object({ initData: z.string().min(1).max(16_384) });
const authTokenBodySchema = z.object({ token: z.string().min(1).max(16_384) });

export interface AppDependencies {
  config: AppConfig;
  databaseCheck: () => Promise<void>;
  services?: ApiServices;
}

function healthPayload(status: HealthResponse['status']): HealthResponse {
  return { status, service: 'api', timestamp: new Date().toISOString() };
}

function envelope<T>(requestId: string, data: T | null, error: ApiEnvelope<T>['error'] = null): ApiEnvelope<T> {
  return { data, error, requestId };
}

function fail(reply: FastifyReply, status: number, requestId: string, code: string, message: string) {
  return reply.code(status).send(envelope(requestId, null, { code, message }));
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: dependencies.config.NODE_ENV !== 'test' });

  await app.register(cors, { origin: dependencies.config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  app.get('/health/live', async (_request, reply) => reply.code(200).send(healthPayload('ok')));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await dependencies.databaseCheck();
      return reply.code(200).send(healthPayload('ok'));
    } catch (error) {
      app.log.error({ error }, 'Database readiness check failed');
      return reply.code(503).send(healthPayload('error'));
    }
  });

  app.post('/webhooks/max', async (request, reply) => {
    const secret = dependencies.config.MAX_WEBHOOK_SECRET;
    const supplied = request.headers['x-max-bot-api-secret'];
    if (!secret || typeof supplied !== 'string' || !constantTimeEqual(secret, supplied)) {
      return fail(reply, 401, request.id, 'INVALID_WEBHOOK_SECRET', 'Webhook secret is invalid');
    }
    if (!dependencies.services) return fail(reply, 503, request.id, 'SERVICE_UNAVAILABLE', 'Webhook storage is unavailable');

    const parsed = maxUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn({ error: parsed.error, body: request.body }, 'MAX update has invalid format');
      return fail(reply, 400, request.id, 'INVALID_UPDATE', 'MAX update has invalid format');
    }
    const eventKey = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    const accepted = await dependencies.services.webhookInbox.enqueue(eventKey, parsed.data);
    return reply.code(202).send(envelope(request.id, { accepted, duplicate: !accepted }));
  });

  app.post('/api/auth/max', async (request, reply) => {
    const parsed = authBodySchema.safeParse(request.body);
    const { MAX_BOT_TOKEN: token, SESSION_SECRET: sessionSecret } = dependencies.config;
    if (!dependencies.services || !token || !sessionSecret) {
      return fail(reply, 503, request.id, 'MAX_NOT_CONFIGURED', 'MAX integration is not configured');
    }
    if (!parsed.success) return fail(reply, 400, request.id, 'INVALID_REQUEST', 'initData is required');

    try {
      const user = validateMaxInitData(parsed.data.initData, token, dependencies.config.MAX_INIT_DATA_MAX_AGE_SECONDS);
      await dependencies.services.profiles.upsertUser(user);
      const sessionToken = createSession(BigInt(user.user_id), sessionSecret, dependencies.config.SESSION_TTL_SECONDS);
      reply.setCookie(sessionCookie, sessionToken, {
        httpOnly: true,
        secure: dependencies.config.NODE_ENV === 'production',
        sameSite: dependencies.config.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
        maxAge: dependencies.config.SESSION_TTL_SECONDS,
      });
      const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
      return reply.code(200).send(envelope(request.id, { displayName, sessionToken }));
    } catch (error) {
      if (error instanceof MaxInitDataError) {
        return fail(reply, 401, request.id, 'INVALID_INIT_DATA', 'MAX authorization data is invalid or expired');
      }
      throw error;
    }
  });

  app.post('/api/auth/token', async (request, reply) => {
    const parsed = authTokenBodySchema.safeParse(request.body);
    const { SESSION_SECRET: sessionSecret } = dependencies.config;
    if (!dependencies.services || !sessionSecret) {
      return fail(reply, 503, request.id, 'MAX_NOT_CONFIGURED', 'MAX integration is not configured');
    }
    if (!parsed.success) return fail(reply, 400, request.id, 'INVALID_REQUEST', 'token is required');

    const maxUserId = verifySession(parsed.data.token, sessionSecret);
    if (!maxUserId) {
      return fail(reply, 401, request.id, 'INVALID_TOKEN', 'Token is invalid or expired');
    }

    const user = dependencies.services.profiles.getUser
      ? await dependencies.services.profiles.getUser(maxUserId)
      : null;

    reply.setCookie(sessionCookie, parsed.data.token, {
      httpOnly: true,
      secure: dependencies.config.NODE_ENV === 'production',
      sameSite: dependencies.config.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: dependencies.config.SESSION_TTL_SECONDS,
    });
    return reply.code(200).send(envelope(request.id, { displayName: user?.displayName ?? 'Жилец', sessionToken: parsed.data.token }));
  });

  async function profileContext(
    request: { id: string; cookies: Record<string, string | undefined>; headers?: Record<string, unknown>; query?: unknown },
    reply: FastifyReply,
  ) {
    const { SESSION_SECRET: secret, MAX_HOME_CHAT_ID: defaultChatId } = dependencies.config;
    const requestedChatId = (request.query as { chatId?: string })?.chatId;
    const chatId = requestedChatId || defaultChatId;
    if (!dependencies.services || !secret || !chatId) {
      fail(reply, 503, request.id, 'MAX_NOT_CONFIGURED', 'MAX profile integration is not configured');
      return null;
    }
    const authHeader = typeof request.headers?.authorization === 'string' ? request.headers.authorization : undefined;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const token = bearerToken || request.cookies[sessionCookie];
    const maxUserId = verifySession(token, secret);
    if (!maxUserId) {
      fail(reply, 401, request.id, 'UNAUTHORIZED', 'MAX session is missing or expired');
      return null;
    }
    if (requestedChatId) {
      const maxChatIdNumber = Number(requestedChatId);
      if (!Number.isSafeInteger(maxChatIdNumber) || !/^-?\d+$/.test(requestedChatId)) {
        fail(reply, 400, request.id, 'INVALID_CHAT_ID', 'Requested chatId is invalid');
        return null;
      }
      return { maxUserId, maxChatId: BigInt(requestedChatId), maxChatIdNumber };
    }
    try {
      const maxChatIdNumber = Number(chatId);
      if (!Number.isSafeInteger(maxChatIdNumber)) throw new Error('unsafe chat id');
      return { maxUserId, maxChatId: BigInt(chatId), maxChatIdNumber };
    } catch {
      fail(reply, 503, request.id, 'INVALID_CONFIGURATION', 'MAX_HOME_CHAT_ID is invalid');
      return null;
    }
  }

  app.get('/api/profile', async (request, reply) => {
    const context = await profileContext(request, reply);
    if (!context || reply.sent) return;
    const maxUserIdNumber = Number(context.maxUserId);
    if ((request.query as { refresh?: string })?.refresh === '1') {
      dependencies.services!.membership.invalidate?.(context.maxChatIdNumber, maxUserIdNumber);
    }
    const isMember = Number.isSafeInteger(maxUserIdNumber)
      ? await dependencies.services!.membership.isMember(context.maxChatIdNumber, maxUserIdNumber)
      : false;

    const homeInDb = dependencies.services!.profiles.getHome
      ? await dependencies.services!.profiles.getHome(context.maxChatId)
      : null;
    let homeChatTitle = homeInDb?.title || null;
    let homeChatUrl = homeInDb?.chatUrl || dependencies.config.MAX_HOME_CHAT_URL || null;

    if (!homeChatTitle || !homeChatUrl) {
      const chatInfo = dependencies.services!.membership.getChatInfo
        ? await dependencies.services!.membership.getChatInfo(context.maxChatIdNumber)
        : null;
      if (chatInfo) {
        if (!homeChatTitle && chatInfo.title) homeChatTitle = chatInfo.title;
        if (!homeChatUrl && chatInfo.chatUrl) homeChatUrl = chatInfo.chatUrl;
      }
    }
    if (!homeChatTitle) homeChatTitle = 'Домовой чат';

    const profile = await dependencies.services!.profiles.getProfile(context.maxUserId, context.maxChatId);
    if (isMember && profile && !profile.membershipVerifiedAt && dependencies.services!.profiles.verifyMembership) {
      await dependencies.services!.profiles.verifyMembership(context.maxUserId, context.maxChatId);
    }

    return reply.code(200).send(envelope(request.id, {
      profile,
      isMember,
      homeChatTitle,
      homeChatUrl,
      ...(profile ? profile : {}),
    }));
  });

  app.put('/api/profile', async (request, reply) => {
    const context = await profileContext(request, reply);
    if (!context || reply.sent) return;
    const parsed = residentProfileInputSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, request.id, 'INVALID_PROFILE', 'Profile fields are invalid');

    const maxUserIdNumber = Number(context.maxUserId);
    if (!Number.isSafeInteger(maxUserIdNumber)) return fail(reply, 400, request.id, 'INVALID_USER_ID', 'MAX user id is invalid');
    dependencies.services!.membership.invalidate?.(context.maxChatIdNumber, maxUserIdNumber);
    const member = await dependencies.services!.membership.isMember(context.maxChatIdNumber, maxUserIdNumber);
    if (!member) {
      const homeInDb = dependencies.services!.profiles.getHome
        ? await dependencies.services!.profiles.getHome(context.maxChatId)
        : null;
      const title = homeInDb?.title;
      const errorMsg = title
        ? `Вы не являетесь участником домового чата «${title}». Вступите в чат дома, чтобы бот мог присылать вам уведомления.`
        : 'Вы не являетесь участником домового чата. Вступите в чат дома, чтобы бот мог присылать вам уведомления.';
      return fail(reply, 403, request.id, 'NOT_HOME_MEMBER', errorMsg);
    }
    const profile = await dependencies.services!.profiles.saveProfile(
      context.maxUserId,
      context.maxChatId,
      parsed.data,
      new Date(),
    );
    return reply.code(200).send(envelope(request.id, profile));
  });

  app.delete('/api/profile', async (request, reply) => {
    const context = await profileContext(request, reply);
    if (!context || reply.sent) return;
    const deleted = await dependencies.services!.profiles.deleteProfile(context.maxUserId, context.maxChatId);
    return reply.code(200).send(envelope(request.id, { deleted }));
  });

  return app;
}
