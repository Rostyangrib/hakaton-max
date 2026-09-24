import { createHmac, timingSafeEqual } from 'node:crypto';

import { maxUserSchema, type MaxUser } from '@quiet-chat/shared';
import { z } from 'zod';

const sessionPayloadSchema = z.object({
  sub: z.string().regex(/^\d+$/),
  exp: z.number().int().positive(),
});

export class MaxInitDataError extends Error {}

function equalHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function validateMaxInitData(
  rawInitData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1_000),
): MaxUser {
  if (!rawInitData) throw new MaxInitDataError('initData is empty');

  const cleanData = rawInitData.replace(/^[#?]/, '');
  const params = new URLSearchParams(cleanData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new MaxInitDataError('initData contains duplicate fields');

  const suppliedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  const userJson = params.get('user');
  if (!suppliedHash || !Number.isInteger(authDate) || !userJson) {
    throw new MaxInitDataError('initData misses required fields');
  }
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new MaxInitDataError('initData has expired');
  }

  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(checkString).digest('hex');
  if (!equalHex(suppliedHash, expectedHash)) throw new MaxInitDataError('initData signature is invalid');

  try {
    return maxUserSchema.parse(JSON.parse(userJson));
  } catch {
    throw new MaxInitDataError('initData user is invalid');
  }
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createSession(maxUserId: bigint, secret: string, ttlSeconds: number, nowSeconds = Math.floor(Date.now() / 1_000)): string {
  const encoded = Buffer.from(JSON.stringify({ sub: maxUserId.toString(), exp: nowSeconds + ttlSeconds })).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySession(value: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1_000)): bigint | null {
  if (!value) return null;
  const [encoded, suppliedSignature, extra] = value.split('.');
  if (!encoded || !suppliedSignature || extra || !equalHex(
    Buffer.from(suppliedSignature, 'base64url').toString('hex'),
    Buffer.from(sign(encoded, secret), 'base64url').toString('hex'),
  )) return null;

  try {
    const payload = sessionPayloadSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    return payload.exp > nowSeconds ? BigInt(payload.sub) : null;
  } catch {
    return null;
  }
}
