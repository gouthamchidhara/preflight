// Bundles the agent CLI into one CommonJS file for a Node single executable (SEA).
// Windows packaging (build-exe.ps1) turns it into PreflightAgent.exe.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist-sea');
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(out, 'agent.cjs'),
  legalComments: 'none',
  logLevel: 'warning',
});
writeFileSync(
  join(out, 'sea-config.json'),
  JSON.stringify({ main: join(out, 'agent.cjs'), output: join(out, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2),
);
console.log(`bundled -> ${join(out, 'agent.cjs')}`);
