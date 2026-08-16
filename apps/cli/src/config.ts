import { z } from 'zod';

/**
 * The sender comes from here rather than from a flag on every invocation. A
 * sender is required on everything written, and one that has to be typed each
 * time is one that eventually is not.
 */
const schema = z.object({
  FUDA_URL: z.url().default('http://localhost:8787'),
  FUDA_SENDER: z.string().trim().min(1),
});

export type Config = {
  url: string;
  sender: string;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`fuda is not configured:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => {
        const name = issue.path.join('.');
        return name === 'FUDA_SENDER'
          ? 'FUDA_SENDER: who is writing. An agent names itself, e.g. session:01K6Ss'
          : `${name}: ${issue.message}`;
      }),
    );
  }

  return {
    url: parsed.data.FUDA_URL.replace(/\/+$/, ''),
    sender: parsed.data.FUDA_SENDER,
  };
}
