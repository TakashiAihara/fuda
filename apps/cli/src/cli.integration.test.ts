import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createDatabase, type Database } from '@fuda/server/src/db/client.ts';
import { assertDisposable } from '@fuda/server/src/db/disposable.ts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const url = process.env['FUDA_TEST_DATABASE_URL'];

if (url !== undefined) assertDisposable(url, process.env['FUDA_DATABASE_URL']);

const cliEntry = new URL('./main.ts', import.meta.url).pathname;
const serverEntry = new URL('../../server/src/index.ts', import.meta.url).pathname;

const freePort = async () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

const run = (command: string[], env: Record<string, string>, input?: string) =>
  new Promise<{ out: string; err: string; code: number }>((resolve) => {
    const child = spawn('bun', ['run', ...command], { env: { ...process.env, ...env } });

    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();

    child.on('close', (code) => resolve({ out, err, code: code ?? 0 }));
  });

/**
 * The command run as a command, against the server run as a server, against a
 * real database. Calling the functions directly would skip argument parsing,
 * exit codes and which stream each thing lands on — three of the ways a CLI is
 * wrong in practice, and none of them visible from inside the process.
 */
describe.skipIf(!url)('the fuda command', () => {
  let database: Database;
  let server: ChildProcess;
  let fudaUrl: string;
  const sender = 'session:01K6Ss';

  const fuda = (args: string[], input?: string) =>
    run([cliEntry, ...args], { FUDA_URL: fudaUrl, FUDA_SENDER: sender }, input);

  beforeAll(async () => {
    database = createDatabase(url as string);

    const port = await freePort();
    fudaUrl = `http://127.0.0.1:${port}`;

    server = spawn('bun', ['run', serverEntry], {
      env: { ...process.env, FUDA_DATABASE_URL: url as string, FUDA_PORT: String(port) },
      stdio: 'ignore',
    });

    // The server migrates on start, so it is not up until it says so.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const healthy = await fetch(`${fudaUrl}/health`)
        .then((r) => r.ok)
        .catch(() => false);

      if (healthy) break;
      if (Date.now() > deadline) throw new Error('the server never became healthy');
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 60_000);

  afterAll(async () => {
    server.kill('SIGTERM');
    await database.close();
  });

  beforeEach(async () => {
    await database.sql`truncate table sections, items restart identity cascade`;
  });

  const exchange = {
    summary: 'two questions before I continue',
    attribution: { repository: 'fuda', branch: 'main' },
    sections: [
      { kind: 'report', body: { text: 'moved the reader behind the interface' } },
      {
        kind: 'question',
        replyForm: 'choice',
        recipient: 'person',
        body: {
          text: 'which name?',
          options: [
            { value: 'a', label: 'pickup' },
            { value: 'b', label: 'claim' },
          ],
        },
      },
    ],
  };

  it('writes what is piped in, and says what it wrote', async () => {
    const written = await fuda(['write'], JSON.stringify(exchange));

    expect(written.code).toBe(0);
    expect(written.out).toContain('two questions before I continue');
    expect(written.out).toContain('question (choice) — unanswered → person');
    expect(written.err).toBe('');
  });

  it('puts the answer on stdout and nothing else there', async () => {
    // stdout is what the agent reads. A warning landing there would be
    // indistinguishable from part of the answer.
    const listed = await fuda(['list', '--json']);

    expect(listed.code).toBe(0);
    expect(() => JSON.parse(listed.out)).not.toThrow();
  });

  it('names itself, so nothing has to type a sender', async () => {
    await fuda(['write'], JSON.stringify(exchange));

    const listed = await fuda(['list', '--json']);
    const [item] = JSON.parse(listed.out) as { sender: string }[];

    expect(item?.sender).toBe(sender);
  });

  it('refuses to write something claiming to be from somebody else', async () => {
    // Attribution cannot be corrected afterwards, so this is worth stopping
    // over rather than quietly overwriting.
    const written = await fuda(['write'], JSON.stringify({ ...exchange, sender: 'session:other' }));

    expect(written.code).toBe(1);
    expect(written.err).toContain('session:other');
    expect(written.out).toBe('');
  });

  it('shows one item by id', async () => {
    await fuda(['write'], JSON.stringify(exchange));

    const listed = await fuda(['list', '--json']);
    const [item] = JSON.parse(listed.out) as { id: string }[];
    const shown = await fuda(['show', item?.id ?? '']);

    expect(shown.code).toBe(0);
    expect(shown.out).toContain('which name?');
    expect(shown.out).toContain('- a: pickup');
  });

  it('filters the way the person’s own screen does', async () => {
    await fuda(['write'], JSON.stringify(exchange));
    await fuda(
      ['write'],
      JSON.stringify({
        summary: 'for another agent',
        sections: [
          {
            kind: 'question',
            replyForm: 'approval',
            recipient: 'session:worker',
            body: { text: 'ok?' },
          },
        ],
      }),
    );

    const mine = await fuda(['list', '--recipient', 'person', '--recipient', '', '--json']);
    const summaries = (JSON.parse(mine.out) as { summary: string }[]).map((i) => i.summary);

    expect(summaries).toEqual(['two questions before I continue']);
  });

  it('says what it cannot find, and says it on stderr', async () => {
    const missing = await fuda(['show', '019ff5f5-a041-7cae-b500-fd404389867a']);

    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no such item');
    expect(missing.out).toBe('');
  });

  it('says when it cannot reach fuda, rather than looking empty', async () => {
    const unreachable = await run([cliEntry, 'list'], {
      FUDA_URL: 'http://127.0.0.1:1',
      FUDA_SENDER: sender,
    });

    expect(unreachable.code).toBe(1);
    expect(unreachable.err).toContain('cannot reach fuda');
    expect(unreachable.out).toBe('');
  });

  it('refuses to run without knowing who is writing', async () => {
    const anonymous = await run([cliEntry, 'list'], { FUDA_URL: fudaUrl, FUDA_SENDER: '' });

    expect(anonymous.code).toBe(1);
    expect(anonymous.err).toContain('who is writing');
  });

  it('has no way to answer, defer or close', async () => {
    // Not an oversight. Those belong to whoever a section is addressed to, and
    // leaving them out of the agent's tool is the enforcement.
    for (const forbidden of ['reply', 'defer', 'resume', 'close']) {
      const attempt = await fuda([forbidden]);

      expect(attempt.code).toBe(1);
      expect(attempt.err).toContain('no such command');
    }
  });
});
