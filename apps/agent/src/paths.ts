/**
 * Where things live.
 * - home: install dir holding checks/, scripts/, golden.json (next to the exe when packaged).
 * - data: config, key, queue, logs, backups. ProgramData\Preflight on Windows (§8 ACL'd).
 */
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const IS_WIN = process.platform === 'win32';

/** Packaged as a Node single executable (PreflightAgent.exe) rather than `node dist/cli.js`. */
export function isPackaged(): boolean {
  return !/^node(\.exe)?$/i.test(basename(process.execPath));
}

export function homeDir(): string {
  if (process.env.PREFLIGHT_HOME) return resolve(process.env.PREFLIGHT_HOME);
  if (isPackaged()) return dirname(process.execPath);
  // dev: apps/agent/dist/cli.js → apps/agent
  return resolve(dirname(process.argv[1] ?? '.'), '..');
}

export function dataDir(): string {
  if (process.env.PREFLIGHT_DATA) return resolve(process.env.PREFLIGHT_DATA);
  if (IS_WIN) return join(process.env.ProgramData ?? 'C:\\ProgramData', 'Preflight');
  return join(homedir(), '.preflight');
}

export const paths = {
  checks: () => join(homeDir(), 'checks'),
  scripts: () => join(homeDir(), 'scripts'),
  goldenCandidates: () => [join(homeDir(), 'golden.json'), resolve(homeDir(), '../../golden/manifest.json')],
  config: () => join(dataDir(), 'config.json'),
  key: () => join(dataDir(), IS_WIN ? 'device.key.dpapi' : 'device.key'),
  policyCache: () => join(dataDir(), 'policy.json'),
  queue: () => join(dataDir(), 'queue'),
  logs: () => join(dataDir(), 'logs'),
  backups: () => join(dataDir(), 'backup'),
  lastRun: () => join(dataDir(), 'last-run.json'),
};
