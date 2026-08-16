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

  it.each([
    ['unparseable', 'postgres://fuda:pa/ss@db:5432/fuda'],
    ['fragment in the password', 'postgres://fuda:pass#x@db:5432/fuda'],
    ['not a url at all', 'the database'],
    ['the wrong scheme', 'mysql://fuda:fuda@db:3306/fuda'],
  ])('refuses a database url with %s', (_, value) => {
    expect(() => loadConfig({ FUDA_DATABASE_URL: value })).toThrow(ConfigError);
  });

  it('accepts a password whose special characters are percent-encoded', () => {
    const encoded = 'postgres://fuda:p%40ss%2Fword@db:5432/fuda';

    expect(loadConfig({ FUDA_DATABASE_URL: encoded }).databaseUrl).toBe(encoded);
  });

  it('cannot catch an unencoded @ in a password, and does not pretend to', () => {
    // This parses, silently, to host `ss` — not to `db`. Nothing here can tell
    // that apart from someone who meant host `ss`, so the defence is compose
    // taking FUDA_DATABASE_URL whole rather than assembling it from parts.
    // Recorded as a test so the limit is visible instead of assumed away.
    const mangled = 'postgres://fuda:p@ss/word@db:5432/fuda';

    expect(loadConfig({ FUDA_DATABASE_URL: mangled }).databaseUrl).toBe(mangled);
    expect(URL.parse(mangled)?.hostname).toBe('ss');
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
