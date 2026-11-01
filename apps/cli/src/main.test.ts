import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommand, run } from './main.ts';
import { createReporter } from './report.ts';

describe('flags per subcommand', () => {
  it('lets list take every flag its usage lists', () => {
    const { values } = parseCommand('list', [
      '--state',
      'all',
      '--closed',
      '--attribution',
      'a=b',
      '--recipient',
      'person',
      '--limit',
      '3',
      '--json',
    ]);

    expect(values).toEqual({
      state: 'all',
      closed: true,
      attribution: ['a=b'],
      recipient: ['person'],
      limit: '3',
      json: true,
    });
  });

  it('lets show take its id and --json', () => {
    const { values, positionals } = parseCommand('show', ['01ABC', '--json']);

    expect(positionals).toEqual(['01ABC']);
    expect(values.json).toBe(true);
  });

  it('lets write take a file and --json', () => {
    const { values, positionals } = parseCommand('write', ['item.json', '--json']);

    expect(positionals).toEqual(['item.json']);
    expect(values.json).toBe(true);
  });

  it('refuses a list flag on show', () => {
    expect(() => parseCommand('show', ['01ABC', '--state', 'all'])).toThrow(/--state/);
  });

  it('refuses a list flag on write', () => {
    expect(() => parseCommand('write', ['--recipient', 'person'])).toThrow(/--recipient/);
  });

  it('refuses a flag nobody has', () => {
    expect(() => parseCommand('list', ['--bogus'])).toThrow(/--bogus/);
  });

  it('still refuses an unknown subcommand', () => {
    expect(() => parseCommand('reply', [])).toThrow(/no such command: reply/);
  });

  it('refuses before it needs any configuration', async () => {
    // Pinned empty rather than left to the shell: with a sender exported, a
    // refusal that came after reading the configuration would look the same.
    vi.stubEnv('FUDA_SENDER', '');
    const said: string[] = [];
    const report = createReporter(
      (t) => said.push(t),
      (t) => said.push(t),
    );

    await expect(run(['show', '01ABC', '--state', 'all'], report)).rejects.toThrow(/--state/);
    expect(said).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
