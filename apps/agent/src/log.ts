/**
 * Minimal file logger with size rotation (no worker threads, SEA-safe). Never log secrets.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export function createLogger(opts: { dir?: string; console?: boolean; level?: Level } = {}): Logger {
  const min = ORDER[opts.level ?? 'info'];
  const file = opts.dir ? join(opts.dir, 'agent.log') : null;
  if (opts.dir && !existsSync(opts.dir)) mkdirSync(opts.dir, { recursive: true });

  const rotate = () => {
    if (!file || !existsSync(file) || statSync(file).size < MAX_BYTES) return;
    rmSync(`${file}.${KEEP}`, { force: true });
    for (let i = KEEP - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    renameSync(file, `${file}.1`);
  };

  const write = (level: Level, msg: string, extra?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
    if (opts.console) (level === 'error' || level === 'warn' ? console.error : console.log)(`[${level}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
    if (file) {
      try {
        rotate();
        appendFileSync(file, line + '\n');
      } catch {
        /* logging must never crash the agent */
      }
    }
  };
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
