import { describe, expect, it } from 'vitest';
import { assertDisposable, describesSameDatabase } from './disposable.ts';

const real = 'postgres://fuda:fuda@localhost:5432/fuda';

describe('describesSameDatabase', () => {
  it('sees through the default port being spelled out or left off', () => {
    // The case that made this necessary: comparing the strings says these are
    // two databases, and the suite then drops the schema of the real one.
    expect(describesSameDatabase('postgres://u:p@db/fuda', 'postgres://u:p@db:5432/fuda')).toBe(true);
  });

  it('sees through loopback being spelled differently', () => {
    expect(describesSameDatabase('postgres://u:p@localhost/fuda', 'postgres://u:p@127.0.0.1:5432/fuda')).toBe(
      true,
    );
  });

  it('ignores the credentials, which do not change which database it is', () => {
    expect(describesSameDatabase('postgres://a:1@db:5432/fuda', 'postgres://b:2@db:5432/fuda')).toBe(true);
  });

  it.each([
    ['a different database', 'postgres://u:p@db:5432/fuda_test'],
    ['a different host', 'postgres://u:p@other:5432/fuda'],
    ['a different port', 'postgres://u:p@db:5433/fuda'],
  ])('tells %s apart', (_, other) => {
    expect(describesSameDatabase('postgres://u:p@db:5432/fuda', other)).toBe(false);
  });

  it('is false when either side is not a url, rather than guessing', () => {
    expect(describesSameDatabase('the database', 'postgres://u:p@db/fuda')).toBe(false);
  });
});

describe('assertDisposable', () => {
  it('allows a database named for the job', () => {
    expect(() => assertDisposable('postgres://u:p@localhost:5432/fuda_test', real)).not.toThrow();
  });

  it('allows it when nothing else is configured', () => {
    expect(() => assertDisposable('postgres://u:p@localhost:5432/fuda_test', undefined)).not.toThrow();
  });

  it('refuses a database not named for the job', () => {
    // The name gate catches the case the difference gate cannot: nothing is
    // configured, so there is nothing to differ from.
    expect(() => assertDisposable(real, undefined)).toThrow(/not named for it/);
  });

  it('refuses the configured database however it is spelled', () => {
    // Named like a test database, but it is the one the server uses.
    expect(() =>
      assertDisposable('postgres://u:p@localhost/fuda_test', 'postgres://u:p@127.0.0.1:5432/fuda_test'),
    ).toThrow(/same database/);
  });

  it('refuses a target it cannot parse', () => {
    expect(() => assertDisposable('the test database', undefined)).toThrow(/not a URL/);
  });
});
