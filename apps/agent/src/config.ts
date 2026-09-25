/**
 * Agent config (ProgramData\Preflight\config.json). The bootstrap token is deleted
 * from disk as soon as enrollment succeeds; the device key lives in the DPAPI file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { IS_WIN, dataDir, paths } from './paths.js';

export const AgentConfig = z.object({
  serverUrl: z.string().url().optional(),
  bootstrapToken: z.string().min(16).optional(),
  deviceId: z.string().uuid().optional(),
  checkinSec: z.number().int().min(5).max(600).default(15),
  startupDelaySec: z.number().int().min(0).max(3600).default(120),
  scheduleMin: z.number().int().min(5).max(1440).default(60),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export function ensureDataDir() {
  const dir = dataDir();
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  if (IS_WIN) {
    // §8: SYSTEM + Administrators only
    spawnSync('icacls', [dir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { windowsHide: true });
  }
}

export function loadConfig(): AgentConfig {
  const p = paths.config();
  if (!existsSync(p)) return AgentConfig.parse({});
  const raw = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  const r = AgentConfig.safeParse(raw);
  if (!r.success) throw new Error(`bad ${p}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}

export function saveConfig(c: AgentConfig) {
  ensureDataDir();
  writeFileSync(paths.config(), JSON.stringify(c, null, 2));
}
