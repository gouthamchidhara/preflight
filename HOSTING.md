# Hosting the Preflight server

One Node process serves the API **and** the dashboard. Laptops only make outbound HTTPS calls to it.

## What you need

| Item | Pilot (1–10 laptops) | Production |
|---|---|---|
| Server | Any Windows/Linux box with Node 22 (a dev PC works) | Small VM or container (1 vCPU, 2 GB RAM), or Azure App Service |
| Database | None: embedded, files in `DATA_DIR` (single instance only) | PostgreSQL 14+ (e.g. Azure Database for PostgreSQL Flexible, smallest tier) via `DATABASE_URL` |
| Address | `http://<pc-name>:3000` on the lab network | DNS name, e.g. `https://preflight.<corp-domain>` |
| TLS | Not needed in a closed lab | Required. Certificate from the corporate CA on a reverse proxy (IIS/ARR, nginx, App Gateway) forwarding to `:3000` |
| Firewall | Inbound 3000 from the UMDs | Inbound 443 from UMD networks (ground and, if used, cellular) and from tech browsers |
| Outbound | None | `login.microsoftonline.com` (sign-in keys) |
| Sign-in | `AUTH_MODE=dev` (no login; refuses to start if `NODE_ENV=production`) | Entra ID, see below |
| Service | `pnpm demo` or `pnpm start` in a terminal | Run as a service with auto-restart (systemd, NSSM or App Service). Health check: `GET /healthz` |
| Backups | Copy `DATA_DIR` | Daily database backup. The audit log is append-only by design |

Load is small: 500 laptops checking in every 15 s is about 35 requests/second of tiny JSON.

## Run it

```bash
corepack enable && pnpm install && pnpm build
# env (see table), then:
pnpm start
```

## Environment

| Variable | Example | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | `postgresql://preflight:…@db:5432/preflight` | Unset → embedded DB in `DATA_DIR` |
| `DATA_DIR` | `./data` | Embedded DB location |
| `BOOTSTRAP_TOKEN` | 32+ random characters | Goes into the SCCM install command. Laptops use it once to enroll; each then gets its own key. Rotate via `POST /api/v1/enrollment-tokens` |
| `AUTH_MODE` | `entra` | `dev` only for a lab |
| `ENTRA_TENANT_ID` | tenant GUID | |
| `ENTRA_API_AUDIENCE` | `api://<api-app-client-id>` | Token audience the API accepts |
| `ENTRA_CLIENT_ID` | SPA app client ID | Used by the dashboard to sign in |
| `ENTRA_API_SCOPE` | `api://<api-app-client-id>/access_as_user` | |
| `GOLDEN_PATH` | `/srv/preflight/golden/manifest.json` | Defaults to the repo copy |
| `LOG_LEVEL` | `info` | |

Keep `DATABASE_URL` and `BOOTSTRAP_TOKEN` in the service's secret store (e.g. Key Vault), not in files in git.

## Entra ID (identity team)

1. **API app registration**: expose scope `access_as_user`; add app roles `Preflight.Viewer`, `Preflight.Tech`, `Preflight.Admin`.
2. **SPA app registration**: platform *Single-page application*, redirect URI `https://preflight.<corp-domain>/`; API permission to the scope above.
3. Assign groups to roles: techs → `Preflight.Tech`, leads → `Preflight.Admin`, everyone else → `Preflight.Viewer`.

## Laptops

SCCM install command, from the agent zip:

```
powershell.exe -ExecutionPolicy Bypass -File install.ps1 -Server https://preflight.<corp-domain> -Token <BOOTSTRAP_TOKEN>
```

Detection rule: service `PreflightAgent` exists. Uninstall: `uninstall.ps1 -Purge`.
If the server certificate comes from a private CA the laptops don't trust, ship the CA PEM and enable the `NODE_EXTRA_CA_CERTS` line in `PreflightAgent-service.xml`.
