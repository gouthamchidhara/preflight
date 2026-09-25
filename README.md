# UMD Validation

Post-imaging validation stack for UMD rugged laptops (Panasonic Toughbook QJ0681xxxx).
Replaces the paper checklist after SCCM imaging. Design lives in [PLAN.md](./PLAN.md). Laptop-day steps: [PHASE0.md](./PHASE0.md).

## Stack

| Piece | Tech | Purpose |
|---|---|---|
| `apps/agent` | Node 22 SEA, TS, PowerShell 5.1 checks | Windows service on the UMD (Session 0, LocalSystem). Read-only checks + whitelisted fixes |
| `apps/api` | Fastify, zod, Drizzle, Postgres | Check results, rules/policy, jobs, attestations, audit log |
| `apps/web` | React, Vite | Fleet + device dashboard with Entra SSO |
| `apps/mock-agent` | CLI | Fakes agents for dev/tests |
| `packages/contracts` | zod | Shared schemas for agent, API, web |

## Setup

```bash
# Node 22+ and pnpm 9 required
corepack enable
pnpm install

# Dev database (Postgres 16)
docker compose up -d db

pnpm build        # builds every workspace package
pnpm test         # vitest suites
pnpm db:migrate   # T3
pnpm db:seed      # T3
```

## Dev

```bash
pnpm --filter @umd/web dev      # Vite on :5173
pnpm --filter @umd/api dev      # T4
```

## Repo layout

```
apps/agent        Windows service, checks/*.ps1, scripts/*.ps1, installer/
apps/api          Fastify + Drizzle (drizzle/ = migrations)
apps/web          React dashboard
apps/mock-agent   Fake agent CLI
packages/contracts zod schemas
golden/manifest.json  expected values captured in Phase 0 (hashes only, never secrets)
scripts/dev       local dev bootstrap (T5)
tests/integration e2e smoke (T12)
```

## Rules of the road (PLAN.md §0)

- Never hard-code an expected value; use `golden/manifest.json` via policy.
- `TBD(P0-x)` stays a placeholder until Phase 0 captures it.
- Check scripts are **read-only** — the agent never partitions/formats disks or edits BIOS.
- No secrets in code, logs, results, evidence, DB or git. Compare hashes, not values.
