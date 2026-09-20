import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('uses safe local defaults without requiring external secrets', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.MAX_BOT_TOKEN).toBeUndefined();
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });
});
