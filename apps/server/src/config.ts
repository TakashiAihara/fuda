import { z } from 'zod';

/**
 * Nothing here assumes a host, a platform or anyone's machine. Every value
 * except the database connection has a default that works out of the box, and
 * the connection itself is the one thing the operator must supply.
 */
const schema = z.object({
  FUDA_DATABASE_URL: z.string().min(1),
  FUDA_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  FUDA_BASE_URL: z.url().default('http://localhost:8787'),
  // What the server stamps on anything the browser sends. A sender is required
  // on everything written, and the person does not type their own name; an
  // authenticated username replaces this once there is authentication to have.
  FUDA_PERSON_IDENTITY: z.string().min(1).default('person'),
});

export type Config = {
  databaseUrl: string;
  port: number;
  baseUrl: string;
  personIdentity: string;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`configuration is not usable:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    // Report every problem at once. Reporting the first one turns a misconfigured
    // deployment into one restart per mistake.
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }

  return {
    databaseUrl: parsed.data.FUDA_DATABASE_URL,
    port: parsed.data.FUDA_PORT,
    baseUrl: parsed.data.FUDA_BASE_URL,
    personIdentity: parsed.data.FUDA_PERSON_IDENTITY,
  };
}
