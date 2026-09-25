/**
 * Environment config (PLAN.md §8). Parsed once at startup; bad config = refuse to start.
 */
import { z } from 'zod';

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default('0.0.0.0'),
    /** postgres://… for real Postgres. Unset → embedded PGlite in DATA_DIR (no install needed). */
    DATABASE_URL: z.string().optional(),
    DATA_DIR: z.string().default('./data'),
    AUTH_MODE: z.enum(['dev', 'entra']).default('dev'),
    ENTRA_TENANT_ID: z.string().optional(),
    /** SPA app registration (public, used by the web to sign in). */
    ENTRA_CLIENT_ID: z.string().optional(),
    /** Token audience the API accepts, e.g. api://<api-app-id>. */
    ENTRA_API_AUDIENCE: z.string().optional(),
    /** Scope the web requests, e.g. api://<api-app-id>/access_as_user. */
    ENTRA_API_SCOPE: z.string().optional(),
    /** Shared enrollment token baked into the SCCM package (≥16 chars). Created on startup if missing. */
    BOOTSTRAP_TOKEN: z.string().min(16).optional(),
    GOLDEN_PATH: z.string().optional(),
    WEB_DIST: z.string().optional(),
    RATE_LIMIT: z.enum(['on', 'off']).default('on'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  })
  .superRefine((e, ctx) => {
    if (e.AUTH_MODE === 'dev' && e.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=dev is not allowed with NODE_ENV=production', path: ['AUTH_MODE'] });
    }
    if (e.AUTH_MODE === 'entra' && (!e.ENTRA_TENANT_ID || !e.ENTRA_API_AUDIENCE)) {
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=entra needs ENTRA_TENANT_ID and ENTRA_API_AUDIENCE', path: ['AUTH_MODE'] });
    }
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${msg}`);
  }
  return r.data;
}
