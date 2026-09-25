import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('uses safe local defaults without requiring external secrets', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.MAX_BOT_TOKEN).toBeUndefined();
    expect(config.ALERT_ANTIFLOOD_MINUTES).toBe(0);
  });

  it('accepts ALERT_ANTIFLOOD_MINUTES=0', () => {
    const config = loadConfig({ ALERT_ANTIFLOOD_MINUTES: '0' });
    expect(config.ALERT_ANTIFLOOD_MINUTES).toBe(0);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });
});
