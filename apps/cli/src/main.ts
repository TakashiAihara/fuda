import { parseArgs } from 'node:util';
import { createClient, ServerError } from './client.ts';
import { ConfigError, loadConfig } from './config.ts';
import { formatItem, formatList } from './format.ts';
import { type Reporter, terminalReporter } from './report.ts';

const usage = `fuda — a shared task queue between you and your coding agent

  fuda write [file]        write an item; reads JSON from a file, or stdin
  fuda list                what is open, waiting first and oldest first
  fuda show <id>           one item, with its sections

list:
  --state <s>              unanswered | open | all   (default: open)
  --closed                 closed items instead of open ones
  --attribution <k=v>      repeatable
  --recipient <who>        repeatable; an empty value means addressed to nobody
  --limit <n>
  --json

show:
  --json

Configuration:
  FUDA_URL                 where fuda is (default: http://localhost:8787)
  FUDA_SENDER              who is writing, e.g. session:01K6Ss   (required)

There is no reply, defer or close here. Those belong to whoever a section is
addressed to, and reach fuda through the browser or, when it is addressed to an
agent, through the commands that arrive with pickup.`;

async function readInput(file: string | undefined): Promise<string> {
  if (file !== undefined && file !== '-') return Bun.file(file).text();

  const text = await Bun.stdin.text();

  if (text.trim() === '') {
    throw new Error('nothing to write. Give a file, or pipe JSON in');
  }

  return text;
}

function parseAttribution(values: string[]): [string, string][] {
  return values.map((value) => {
    const at = value.indexOf('=');

    if (at <= 0) throw new Error(`--attribution wants key=value, got ${value}`);

    return [value.slice(0, at), value.slice(at + 1)] as [string, string];
  });
}

export async function run(argv: string[], report: Reporter): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help') {
    report.say(usage);
    return command === undefined ? 1 : 0;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      closed: { type: 'boolean', default: false },
      state: { type: 'string' },
      attribution: { type: 'string', multiple: true, default: [] },
      recipient: { type: 'string', multiple: true, default: [] },
      limit: { type: 'string' },
    },
  });

  const config = loadConfig(process.env);
  const client = createClient(config);

  if (command === 'write') {
    const input = JSON.parse(await readInput(positionals[0])) as Record<string, unknown>;

    if (typeof input['sender'] === 'string' && input['sender'] !== config.sender) {
      // Refusing rather than overwriting: an item that says it came from
      // somewhere else is worth stopping over, since attribution cannot be
      // corrected after the fact.
      throw new Error(`this says it is from ${String(input['sender'])}, but FUDA_SENDER is ${config.sender}`);
    }

    const written = await client.write(input);

    report.say(values.json ? JSON.stringify(written, null, 2) : formatItem(written));
    return 0;
  }

  if (command === 'list') {
    const items = await client.list({
      ...(values.state === undefined ? {} : { state: values.state as 'unanswered' | 'open' | 'all' }),
      ...(values.closed ? { closed: true } : {}),
      attribution: parseAttribution(values.attribution),
      recipients: values.recipient.map((value) => (value === '' ? null : value)),
      ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
    });

    report.say(values.json ? JSON.stringify(items, null, 2) : formatList(items));
    return 0;
  }

  if (command === 'show') {
    const id = positionals[0];

    if (id === undefined) throw new Error('which item? fuda show <id>');

    const item = await client.show(id);

    report.say(values.json ? JSON.stringify(item, null, 2) : formatItem(item));
    return 0;
  }

  throw new Error(`no such command: ${command}. Try fuda help`);
}

if (import.meta.main) {
  const report = terminalReporter();

  try {
    process.exit(await run(process.argv.slice(2), report));
  } catch (error) {
    if (error instanceof ConfigError || error instanceof ServerError) {
      report.note(error.message);
    } else {
      report.note(error instanceof Error ? error.message : String(error));
    }

    process.exit(1);
  }
}
