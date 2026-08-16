/**
 * Everything the tool says goes through here, and where it goes is decided
 * once, by whoever built the reporter.
 *
 * This exists for a hazard that is still one step away: `fuda mcp` will speak
 * the protocol on stdout, where a stray line of logging is not noise but a
 * corrupt frame. Splitting the destination from the act of reporting means the
 * MCP entry point hands over a reporter that writes to stderr and cannot be
 * betrayed by shared code that "just prints something".
 */
export type Reporter = {
  /** The answer. What the caller asked for. */
  say: (text: string) => void;
  /** Everything else: warnings, failures, progress. Never the answer. */
  note: (text: string) => void;
};

export function createReporter(say: (text: string) => void, note: (text: string) => void): Reporter {
  return { say, note };
}

const toStderr = (text: string) => process.stderr.write(`${text}\n`);

/** For the CLI: answers on stdout, everything else on stderr. */
export function terminalReporter(): Reporter {
  return createReporter((text) => process.stdout.write(`${text}\n`), toStderr);
}

/**
 * For anything whose stdout belongs to a protocol. Both streams go to stderr;
 * nothing this reporter is given can reach stdout by accident.
 */
export function quietReporter(): Reporter {
  return createReporter(toStderr, toStderr);
}
