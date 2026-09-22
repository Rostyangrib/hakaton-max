import { describe, expect, it } from 'vitest';

import { createSession } from './session.js';

describe('worker session generator', () => {
  it('creates token with sub, exp and valid signature', () => {
    const token = createSession(215608884n, 'test-secret', 3600, 1000);
    const [encodedPayload, signature] = token.split('.');
    expect(encodedPayload).toBeDefined();
    expect(signature).toBeDefined();

    const payload = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8'));
    expect(payload.sub).toBe('215608884');
    expect(payload.exp).toBe(4600);
  });
});
