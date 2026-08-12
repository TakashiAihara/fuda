import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const url = 'postgres://fuda:fuda@localhost:5432/fuda';

describe('loadConfig', () => {
  it('needs only the database connection', () => {
    const config = loadConfig({ FUDA_DATABASE_URL: url });

    expect(config).toEqual({
      databaseUrl: url,
      port: 8787,
      baseUrl: 'http://localhost:8787',
      personIdentity: 'person',
    });
  });

  it('takes every value from the environment when given', () => {
    const config = loadConfig({
      FUDA_DATABASE_URL: url,
      FUDA_PORT: '9000',
      FUDA_BASE_URL: 'https://fuda.example.internal',
      FUDA_PERSON_IDENTITY: 'takashi',
    });

    expect(config).toEqual({
      databaseUrl: url,
      port: 9000,
      baseUrl: 'https://fuda.example.internal',
      personIdentity: 'takashi',
    });
  });

  it('refuses to start without a database connection', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('reports every problem at once, not just the first', () => {
    try {
      loadConfig({ FUDA_PORT: 'http', FUDA_BASE_URL: 'not a url' });
      expect.unreachable('a broken environment must not load');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const problems = (error as ConfigError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.join('\n')).toContain('FUDA_DATABASE_URL');
      expect(problems.join('\n')).toContain('FUDA_PORT');
      expect(problems.join('\n')).toContain('FUDA_BASE_URL');
    }
  });

  it.each(['0', '65536', '-1', '80.5'])('rejects %s as a port', (port) => {
    expect(() => loadConfig({ FUDA_DATABASE_URL: url, FUDA_PORT: port })).toThrow(ConfigError);
  });

  it('rejects an empty person identity, since a sender is required', () => {
    expect(() => loadConfig({ FUDA_DATABASE_URL: url, FUDA_PERSON_IDENTITY: '' })).toThrow(ConfigError);
  });
});
