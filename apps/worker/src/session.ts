import { createHmac } from 'node:crypto';

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function createSession(maxUserId: bigint, secret: string, ttlSeconds: number, nowSeconds = Math.floor(Date.now() / 1_000)): string {
  const encoded = Buffer.from(JSON.stringify({ sub: maxUserId.toString(), exp: nowSeconds + ttlSeconds })).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}
