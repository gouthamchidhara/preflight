/**
 * Device identity + live telemetry (checkin: onAC / lanUp / wwanReady), via checks/_identity.ps1.
 * Cached for 5 minutes so the 15 s checkin does not spawn PowerShell every time.
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Shell } from './shell.js';
import { lastJsonLine } from './runner.js';

export const Identity = z.object({
  hostname: z.string().default(''),
  serial: z.string().default(''),
  assetTag: z.string().default(''),
  model: z.string().default(''),
  osBuild: z.string().default(''),
  onAC: z.boolean().default(false),
  lanUp: z.boolean().default(false),
  wwanReady: z.boolean().default(false),
});
export type Identity = z.infer<typeof Identity>;

const TTL = 5 * 60_000;
let cache: { at: number; value: Identity } | null = null;

export async function getIdentity(shell: Shell, checksDir: string, force = false): Promise<Identity> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.value;
  const script = join(checksDir, '_identity.ps1');
  let value: Identity | null = null;
  if (existsSync(script)) {
    const out = await shell.run(script, {}, 30_000);
    const r = Identity.safeParse(lastJsonLine(out.stdout));
    if (r.success) value = r.data;
  }
  // Fallback keeps the agent alive even if WMI is broken; serial falls back to hostname.
  value ??= Identity.parse({ hostname: hostname(), serial: `HOST-${hostname()}`, osBuild: process.platform });
  if (!value.serial) value.serial = `HOST-${value.hostname || hostname()}`;
  cache = { at: Date.now(), value };
  return value;
}

export function resetIdentityCache() {
  cache = null;
}
