/**
 * Which rules to run: the server's policy when we have one (cached on disk),
 * else the built-in default resolved against the bundled golden manifest (offline mode).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_RULES, Rule, resolvePolicy, type Golden, type Rule as RuleT } from '@umd/contracts';
import { paths } from './paths.js';

const Cached = z.object({ policyVersion: z.number(), rules: z.array(Rule) });

export function loadGolden(): Golden {
  for (const p of paths.goldenCandidates()) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) as Golden;
  }
  return {};
}

export function defaultPolicy(): { policyVersion: number; rules: RuleT[] } {
  return { policyVersion: 0, rules: resolvePolicy(DEFAULT_RULES, loadGolden()).filter((r) => r.context === 'agent') };
}

export function cachedPolicy(): { policyVersion: number; rules: RuleT[] } | null {
  try {
    if (!existsSync(paths.policyCache())) return null;
    const r = Cached.safeParse(JSON.parse(readFileSync(paths.policyCache(), 'utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function savePolicy(p: { policyVersion: number; rules: RuleT[] }) {
  writeFileSync(paths.policyCache(), JSON.stringify(p));
}

export function currentPolicy() {
  return cachedPolicy() ?? defaultPolicy();
}

export function selectRules(rules: RuleT[], f: { stage?: string; ruleIds?: string[] }): RuleT[] {
  return rules.filter((r) => (!f.stage || r.stage === f.stage) && (!f.ruleIds?.length || f.ruleIds.includes(r.id)));
}
