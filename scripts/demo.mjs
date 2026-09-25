// One command to see Preflight working on any PC with Node 22 (no Docker, no database install):
//   pnpm install && pnpm build && pnpm demo
// Starts the API + dashboard on http://localhost:3000 (embedded database in ./data-demo)
// and 5 fake UMDs that check in every 15 s and "execute" fixes you click in the dashboard.
import { spawn } from 'node:child_process';

const TOKEN = process.env.BOOTSTRAP_TOKEN ?? 'demo-bootstrap-token-change-me';
const PORT = process.env.PORT ?? '3000';
const url = `http://localhost:${PORT}`;
const api = spawn(process.execPath, ['apps/api/dist/index.js'], {
  env: { ...process.env, PORT, DATA_DIR: process.env.DATA_DIR ?? './data-demo', BOOTSTRAP_TOKEN: TOKEN, LOG_LEVEL: 'warn' },
  stdio: 'inherit',
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${url}/healthz`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}
const fleet = spawn(process.execPath, ['apps/mock-agent/dist/index.js', '--server', url, '--token', TOKEN, '--devices', '5', '--watch'], { stdio: 'inherit' });
console.log(`\nPreflight demo running: open ${url}\nReal laptop: PreflightAgent.exe enroll --server http://<this-pc>:${PORT} --token ${TOKEN}\nCtrl+C to stop.\n`);
const stop = () => {
  fleet.kill();
  api.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
