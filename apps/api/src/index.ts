/**
 * Preflight API entry (PLAN.md §5.4). `node dist/index.js` or `pnpm --filter @umd/api start`.
 */
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildApp, loadGolden } from './app.js';

export const API_NAME = 'umd-validation-api';
export { buildApp, loadGolden } from './app.js';
export { loadConfig } from './config.js';
export { openDb } from './db.js';

async function main() {
  const cfg = loadConfig();
  const db = await openDb({ url: cfg.DATABASE_URL, dataDir: cfg.DATA_DIR });
  const app = await buildApp({ cfg, db, golden: loadGolden(cfg.GOLDEN_PATH) });
  const shutdown = async () => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  app.log.info(`Preflight API on :${cfg.PORT} (db=${db.kind}, auth=${cfg.AUTH_MODE})`);
}

if (process.argv[1] && /index\.(js|ts)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
