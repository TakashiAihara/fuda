import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('needs to know who is writing', () => {
    // A sender is required on everything written. Nothing here can guess it.
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('says what FUDA_SENDER is for, not just that it is missing', () => {
    try {
      loadConfig({});
      expect.unreachable('an unconfigured fuda must not run');
    } catch (error) {
      expect((error as ConfigError).problems.join('\n')).toContain('who is writing');
    }
  });

  it('defaults to a fuda on this machine', () => {
    expect(loadConfig({ FUDA_SENDER: 'session:01K6Ss' }).url).toBe('http://localhost:8787');
  });

  it('drops a trailing slash so paths do not double up', () => {
    const config = loadConfig({ FUDA_SENDER: 'a', FUDA_URL: 'https://fuda.example.internal/' });

    expect(config.url).toBe('https://fuda.example.internal');
  });

  it('refuses a url that is not one', () => {
    expect(() => loadConfig({ FUDA_SENDER: 'a', FUDA_URL: 'over there' })).toThrow(ConfigError);
  });
});
