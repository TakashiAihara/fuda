import { z } from 'zod';

/**
 * Nothing here assumes a host, a platform or anyone's machine. Every value
 * except the database connection has a default that works out of the box, and
 * the connection itself is the one thing the operator must supply.
 */
const schema = z.object({
  // Parsed and checked for scheme, not just non-empty, so a connection string
  // mangled by assembling it from separate values is refused at startup rather
  // than surfacing later as an authentication failure pointing at the wrong
  // thing.
  //
  // This catches less than it looks. A password containing / or # makes the URL
  // unparseable and is caught; a password containing @ does not — it parses,
  // silently, to a different host. `postgres://fuda:p@ss/word@db:5432/fuda`
  // reads as host `ss`, and nothing here can tell that apart from someone who
  // meant host `ss`. The only real defence is not assembling URLs from parts,
  // which is why compose takes FUDA_DATABASE_URL whole.
  FUDA_DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => {
        const url = URL.parse(value);
        return url !== null && (url.protocol === 'postgres:' || url.protocol === 'postgresql:');
      },
      { message: 'is not a postgres:// URL. Percent-encode anything special in the password' },
    ),
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
