/**
 * The port the browser tests start their server on. Anything but a plain
 * decimal 1-65535 is refused: `Number('')` is 0 and `Number('1e3')` is 1000, so
 * a mistyped value would otherwise start a server somewhere nobody chose.
 */
export function resolveE2ePort(env: Record<string, string | undefined>): number {
  const raw = env['FUDA_E2E_PORT'];

  if (raw === undefined) {
    return 18787;
  }

  const port = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`FUDA_E2E_PORT must be a whole number from 1 to 65535, got ${JSON.stringify(raw)}`);
  }

  return port;
}
