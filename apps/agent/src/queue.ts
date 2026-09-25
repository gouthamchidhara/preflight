/**
 * Disk-backed upload queue (§6.4): one file per item, written atomically,
 * deleted only after a 2xx. Survives restarts and offline periods.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface QueueItem<T> {
  name: string;
  body: T;
}

let seq = 0;

export class DiskQueue<T = unknown> {
  constructor(
    private dir: string,
    private cap = 500,
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  push(kind: string, body: T): string {
    // time + in-process sequence keeps FIFO order even within the same millisecond
    seq = (seq + 1) % 1_000_000;
    const name = `${Date.now().toString().padStart(15, '0')}-${seq.toString().padStart(6, '0')}-${kind}.json`;
    const tmp = join(this.dir, `${name}.tmp`);
    writeFileSync(tmp, JSON.stringify(body));
    renameSync(tmp, join(this.dir, name));
    this.trim();
    return name;
  }

  /** Oldest first. Corrupt files are removed so one bad file never blocks the queue. */
  list(): QueueItem<T>[] {
    const out: QueueItem<T>[] = [];
    for (const name of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        out.push({ name, body: JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as T });
      } catch {
        rmSync(join(this.dir, name), { force: true });
      }
    }
    return out;
  }

  remove(name: string) {
    rmSync(join(this.dir, name), { force: true });
  }

  size(): number {
    return readdirSync(this.dir).filter((f) => f.endsWith('.json')).length;
  }

  private trim() {
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - this.cap))) rmSync(join(this.dir, f), { force: true });
  }
}
