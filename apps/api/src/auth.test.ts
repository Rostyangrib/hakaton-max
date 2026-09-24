import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createSession, MaxInitDataError, validateMaxInitData, verifySession } from './auth.js';

function makeInitData(token: string, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'test-query',
    user: JSON.stringify({ user_id: 460620062, first_name: 'Тест', last_name: 'Жилец', username: null }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secretKey).update(checkString).digest('hex'));
  return params.toString();
}

describe('MAX initData validation', () => {
  it('accepts a current correctly signed payload', () => {
    const result = validateMaxInitData(makeInitData('test-token', 1_000), 'test-token', 600, 1_100);
    expect(result.user_id).toBe(460620062);
  });

  it('accepts user payload with id instead of user_id and nullable fields', () => {
    const params = new URLSearchParams({
      auth_date: '1000',
      query_id: 'test-query-2',
      user: JSON.stringify({
        id: 215608884,
        first_name: 'Иван',
        last_name: null,
        username: null,
        language_code: 'ru',
        photo_url: null,
      }),
    });
    const checkString = [...params.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update('test-token').digest();
    params.set('hash', createHmac('sha256', secretKey).update(checkString).digest('hex'));

    const result = validateMaxInitData(params.toString(), 'test-token', 600, 1_100);
    expect(result.user_id).toBe(215608884);
    expect(result.first_name).toBe('Иван');
    expect(result.last_name).toBeUndefined();
    expect(result.username).toBeUndefined();
  });

  it('accepts rawInitData with leading # or ? and string id with null first_name', () => {
    const params = new URLSearchParams({
      auth_date: '1000',
      query_id: 'test-query-3',
      user: JSON.stringify({
        id: '215608884',
        first_name: null,
        last_name: null,
        username: null,
        extra_field: 'allowed_via_passthrough',
      }),
    });
    const checkString = [...params.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update('test-token').digest();
    params.set('hash', createHmac('sha256', secretKey).update(checkString).digest('hex'));

    const hashPrefixed = `#${params.toString()}`;
    const result = validateMaxInitData(hashPrefixed, 'test-token', 600, 1_100);
    expect(result.user_id).toBe(215608884);
    expect(result.first_name).toBe('Жилец');
  });

  it('rejects tampered, expired and duplicate payloads', () => {
    const valid = makeInitData('test-token', 1_000);
    expect(() => validateMaxInitData(valid.replace('test-query', 'changed'), 'test-token', 600, 1_100)).toThrow(MaxInitDataError);
    expect(() => validateMaxInitData(valid, 'test-token', 60, 1_100)).toThrow(MaxInitDataError);
    expect(() => validateMaxInitData(`${valid}&auth_date=1000`, 'test-token', 600, 1_100)).toThrow(MaxInitDataError);
  });
});

describe('signed session', () => {
  it('round-trips and expires without exposing the secret', () => {
    const session = createSession(123n, 'session-secret', 60, 1_000);
    expect(session).not.toContain('session-secret');
    expect(verifySession(session, 'session-secret', 1_030)).toBe(123n);
    expect(verifySession(session, 'wrong-secret', 1_030)).toBeNull();
    expect(verifySession(session, 'session-secret', 1_061)).toBeNull();
  });
});
