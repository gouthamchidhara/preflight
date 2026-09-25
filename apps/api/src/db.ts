/**
 * Tiny DB adapter: real Postgres (pg) in production, embedded PGlite for dev/tests/pilot.
 * Same SQL runs on both. JSON params are passed as strings and cast with ::jsonb.
 */
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS } from './migrations.js';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
}

export async function openDb(opts: { url?: string; dataDir?: string; memory?: boolean }): Promise<Db> {
  const db = opts.url ? postgres(opts.url) : await pglite(opts.memory ? undefined : opts.dataDir);
  await migrate(db);
  return db;
}

function postgres(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    kind: 'postgres',
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: async (s, p) => (await client.query(s, p as unknown[])).rows });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pglite(dataDir?: string): Promise<Db> {
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  // PGlite is single-connection: serialize everything so a transaction never interleaves.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    kind: 'pglite',
    query: (sql, params) => serial(async () => (await lite.query(sql, params as unknown[])).rows as never),
    tx: (fn) =>
      serial(() =>
        lite.transaction((t) => fn({ query: async (s, p) => (await t.query(s, p as unknown[])).rows as never })),
      ),
    close: () => lite.close(),
  };
}

async function migrate(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (id int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ id: number }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const id = i + 1;
    if (done.has(id)) continue;
    await db.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
    });
  }
}

/** Split on semicolons outside $$…$$ bodies. */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inBody = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith('$$', i)) {
      inBody = !inBody;
      cur += '$$';
      i++;
      continue;
    }
    if (sql[i] === ';' && !inBody) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += sql[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
