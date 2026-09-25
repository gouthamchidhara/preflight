// Validates a `PreflightAgent.exe check --out report.json` run on a real Windows machine (CI):
// every rule produced a contract-valid result and nothing failed *structurally*
// (missing script, bad JSON, timeout, PowerShell syntax). Hardware verdicts are allowed to fail.
import { readFileSync } from 'node:fs';
import { Result, DEFAULT_RULES } from '@umd/contracts';

const file = process.argv[2];
const report = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const structural = /no script for check type|produced no JSON|invalid script output|timed out|runner crash|ParserError|Missing closing|Unexpected token/i;
const expected = DEFAULT_RULES.filter((r) => r.context === 'agent').length;
let bad = 0;
for (const r of report.results) {
  const ok = Result.safeParse(r).success && !structural.test(String(r.actual));
  if (!ok) bad++;
  console.log(`${ok ? '  ' : '!!'} ${r.status.padEnd(11)} ${r.ruleId.padEnd(24)} ${String(r.actual ?? '').slice(0, 100)}`);
}
console.log(`\n${report.results.length}/${expected} results, ${bad} structural problem(s). Identity: ${JSON.stringify(report.identity)}`);
if (report.results.length !== expected || bad) process.exit(1);
