/**
 * Device key at rest (§5.4): DPAPI machine scope on Windows, 0600 file elsewhere (dev only).
 * The secret is passed to PowerShell via env, never argv.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { IS_WIN } from './paths.js';
import { powershellCommand } from './shell.js';

function dpapi(mode: 'Protect' | 'Unprotect', input: string): string {
  const script =
    mode === 'Protect'
      ? "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:PF_IN); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'LocalMachine'))"
      : "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($env:PF_IN); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'LocalMachine'))";
  const r = spawnSync(powershellCommand(), ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, PF_IN: input },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (r.status !== 0) throw new Error(`DPAPI ${mode} failed: ${(r.stderr || '').trim().slice(0, 300)}`);
  return r.stdout.trim();
}

export function saveSecret(path: string, secret: string) {
  if (IS_WIN) writeFileSync(path, dpapi('Protect', secret));
  else {
    writeFileSync(path, secret, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}

export function loadSecret(path: string): string | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return null;
  return IS_WIN ? dpapi('Unprotect', raw) : raw;
}
