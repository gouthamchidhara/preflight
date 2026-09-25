/**
 * Auth (PLAN.md §5.4, §8).
 * - Agents: X-Device-Key, stored as sha256 only.
 * - Users: Entra ID JWT (verified against JWKS) with app roles, or AUTH_MODE=dev for local work.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';

export type Role = 'Viewer' | 'Tech' | 'Admin';
const RANK: Record<Role, number> = { Viewer: 1, Tech: 2, Admin: 3 };

export interface User {
  name: string;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    deviceId?: string;
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');

/** Entra app-role values → Preflight roles. Anything else grants nothing. */
const ROLE_CLAIMS: Record<string, Role> = {
  'Preflight.Viewer': 'Viewer',
  'Preflight.Tech': 'Tech',
  'Preflight.Admin': 'Admin',
};

export function hasRole(user: User | undefined, need: Role): boolean {
  return !!user && user.roles.some((r) => RANK[r] >= RANK[need]);
}

export function makeUserAuth(cfg: Config, jwks?: JWTVerifyGetKey) {
  const keys =
    jwks ??
    (cfg.AUTH_MODE === 'entra'
      ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/discovery/v2.0/keys`))
      : undefined);

  return async function authenticate(req: FastifyRequest): Promise<User | null> {
    if (cfg.AUTH_MODE === 'dev') {
      const name = String(req.headers['x-dev-user'] ?? 'dev-user').slice(0, 64);
      const role = String(req.headers['x-dev-role'] ?? 'Admin') as Role;
      return { name, roles: [RANK[role] ? role : 'Viewer'] };
    }
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ') || !keys) return null;
    try {
      const { payload } = await jwtVerify(h.slice(7), keys, {
        issuer: `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/v2.0`,
        audience: cfg.ENTRA_API_AUDIENCE,
      });
      const claims = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
      const roles = claims.map((c) => ROLE_CLAIMS[c]).filter((r): r is Role => !!r);
      const name = String(payload.preferred_username ?? payload.upn ?? payload.oid ?? 'unknown');
      return { name, roles };
    } catch {
      return null;
    }
  };
}

export function requireRole(need: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    if (!hasRole(req.user, need)) return reply.code(403).send({ error: `requires role ${need}` });
  };
}

export async function deviceFromKey(db: Db, key: string | undefined): Promise<string | null> {
  if (!key || key.length < 32 || key.length > 128) return null;
  const rows = await db.query<{ device_id: string }>(
    'SELECT device_id FROM device_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [sha256(key)],
  );
  return rows[0]?.device_id ?? null;
}
