# Domyro 0.1: first executable development foundation

**Status:** development preview, **not** a smart-home product or production installation.

## D-53 warning: do NOT install on the owner's server

The owner explicitly **does not want a server installation** until the production-grade one-command Ubuntu Server installer, manual upgrade path, tested recovery and backup are all ready. **This page is exclusively a developer's isolated local preview**, not instructions to install Domyro on the owner's Ubuntu/VM/Umbrel or HA setup. Even a complete tested installer will require the owner's **separate later consent** for their own server. See [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md).

## Quick local start

Prerequisites: Node.js **22.12+** (Node 22/24 targeted in checks). The CLI uses exact-pinned development dependencies; **no PostgreSQL server is installed by these commands**. Migrations only run when explicitly requested against an isolated test database.

```bash
git clone https://github.com/TheRoyalCaptain/Domyro.git
cd Domyro
npm install --ignore-scripts
npm test
npm start
```

Open http://127.0.0.1:8844 in the browser. Use `DOMYRO_PORT=8845 npm start` to choose another local port.

The preview binds only to **127.0.0.1** by default. **Do not expose it directly to the Internet**: login, access controls, persistence and device control are *not implemented yet*. For isolated lab LAN testing only, an administrator may explicitly set `DOMYRO_HOST=0.0.0.0` with an appropriate VM/firewall. This is **not** the final Ubuntu installer and does **not** modify existing Home Assistant, MQTT brokers, Zigbee mesh or OS services.

## Development-only installer readiness

Run `npm run gate:status` to see the documented open release blockers. The `gate:require` command must **fail** until the complete installer, stable authenticated Domyro and recoverable upgrade workflows have passed independent tests and the owner authorizes their own installation. These are readiness diagnostics only, **not** instructions to install on the owner's server. See [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md).

## What works now

Additional **read-only lifecycle modules** are now present under `src/lifecycle/`: signed manifest / artifact verification and manual-upgrade preflight; multi-destination backup retention planning (default 7 daily / 4 weekly / 12 monthly); and per-service installation decision validation. They do **not** download, install, update, migrate, mount disks, delete backups or run privileged commands. See [SAFETY-FOUNDATION.md](SAFETY-FOUNDATION.md).

- A local, standalone Node.js HTTP service and responsive development dashboard in Dutch/English.
- `GET /api/v1/health/live` returns 200 when the process is live.
- `GET /api/v1/health/ready` deliberately returns **503**, since persistence/integrations are not configured.
- `GET /api/v1/public/status` returns a real summary of what is and is **not** connected. There are no fabricated devices.
- Static asset allowlist, restrictive browser security headers, default loopback binding and read-only API routes.
- Early **not-yet-API-wired** pure domain utilities for deny-by-default site permissions and observed-vs-requested hardware state, covered by Node tests.
- GitHub Actions checks for Node.js 22 and 24.

## PostgreSQL and account-security foundation

The preview now includes explicit **PostgreSQL migrations**, real persisted multi-site/area repository operations, Argon2id password and revocable hashed-session primitives. They are tested against disposable CI PostgreSQL 17 on amd64/ARM64. **No authentication endpoint or owner onboarding is exposed**, so `/api/v1/health/ready` must still return 503, even when a test DB is migrated. The preview does not install/configure PostgreSQL itself or run schema migrations automatically. See [PERSISTENCE-FOUNDATION.md](PERSISTENCE-FOUNDATION.md).

## Explicitly not implemented yet

No authentication/login API, secure admin setup, real device control/MQTT/Matter, secured rooms HTTP APIs, histories, secure WebSockets, React PWA, complete native installer, PostgreSQL managed provisioning, database restore, Docker/Umbrel production image or plugin installer. PostgreSQL schema and internal repository/session primitives exist, but are not a production app. This is a **foundation**, not version 0.1 released to users.

## Next engineering milestone

1. Select verified maintained runtime/framework/package versions and complete dependency security/license review.
2. Add PostgreSQL migrations, local owner bootstrap, sessions and real site-scoped authorization.
3. Replace the temporary static UI with React/Vite, retaining the no-fake-data and accessibility semantics.
4. Add MQTT and Zigbee2MQTT with test devices and permission, and prove real observed/confirmed state.
5. Later validate real Matter, native Ubuntu LTS amd64+arm64 installers, Docker and Umbrel as separately supported deployment targets.

No cloud accounts or telemetry are required. This increment does not publish an official production release.
