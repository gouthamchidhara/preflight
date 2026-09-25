/**
 * Runs a PowerShell script with a timeout and output cap (§6.2).
 * Params travel base64-encoded in PREFLIGHT_PARAMS — never on the command line,
 * where Windows argument quoting mangles JSON.
 */
import { spawn, spawnSync } from 'node:child_process';
import { IS_WIN } from './paths.js';

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface Shell {
  run(script: string, params: unknown, timeoutMs: number, opts?: { stdin?: string }): Promise<ShellResult>;
}

const OUTPUT_CAP = 256 * 1024;

export function powershellCommand(): string {
  if (process.env.PREFLIGHT_PWSH) return process.env.PREFLIGHT_PWSH;
  return IS_WIN ? 'powershell.exe' : 'pwsh';
}

export function killTree(pid: number | undefined) {
  if (!pid) return;
  if (IS_WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

/** Generic runner: any command + args, params in env. Used by the PowerShell shell and by tests. */
export function makeShell(command: string, argsFor: (script: string) => string[]): Shell {
  return {
    run(script, params, timeoutMs, opts) {
      const started = Date.now();
      return new Promise((resolve) => {
        const child = spawn(command, argsFor(script), {
          env: { ...process.env, PREFLIGHT_PARAMS: Buffer.from(JSON.stringify(params ?? {}), 'utf8').toString('base64') },
          windowsHide: true,
          detached: !IS_WIN,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let done = false;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (d: string) => {
          if (stdout.length < OUTPUT_CAP) stdout += d;
        });
        child.stderr.on('data', (d: string) => {
          if (stderr.length < OUTPUT_CAP) stderr += d;
        });
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, timeoutMs);
        const finish = (code: number | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started });
        };
        child.on('error', (e) => {
          stderr += String(e.message);
          finish(null);
        });
        child.on('close', (code) => finish(code));
        if (opts?.stdin) child.stdin.write(opts.stdin);
        child.stdin.end();
      });
    },
  };
}

export const powershell = (): Shell =>
  makeShell(powershellCommand(), (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]);
