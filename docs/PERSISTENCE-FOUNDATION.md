# Domyro M1: PostgreSQL, multi-site data and internal authentication primitives

**Status:** Executable development foundation, **includes experimental localhost authentication, but NOT a production-ready login, full recovery or production installation**.  
**Owner deployment decision D-53:** CLOSED. No installation or upgrade on the owner's actual host.

## Implemented in this iteration

- SQL migrations `001_foundation.sql` and `002_installation.sql`: one installation identity, users, sites/homes, site memberships (owner/admin/manager/resident/guest), areas/rooms and hashed-token sessions.
- `migrator.mjs`: checksum-pinned, sequential migrations with a session advisory lock, single DB transaction, rollback on errors, mismatch/newer-version refusal and explicit separate check/apply operations. **Server startup and update checks never migrate automatically.**
- `db-config.mjs`: the current preview **only** accepts PostgreSQL on loopback; remote TLS/database configuration and secure credential storage are reserved for the official installer.
- `site-repository.mjs`: transactional site creation bound to an existing owner user, user-scoped site/area queries and manager/owner-only area creation. All runtime values are SQL parameters. Site authorization here is at the *application SQL query* layer, not yet PostgreSQL Row-Level Security: a DB administrator still has access.
- `credentials.mjs`: Argon2id password hashing/verification (64 MiB, 3 passes), random 256-bit session tokens, SHA-256 token digest stored in PostgreSQL, expiry/revocation and disabled-user checks. These primitives now power a **loopback-only development HTTP API**; full HTTPS production security is not implemented. No plaintext passwords or bearer tokens are persisted.
- The development HTTP preview can report actual PostgreSQL migration status when a local test database is configured, but still **returns 503 readiness** because production authentication, recovery, device management and a safe installer are incomplete.
- Test suite uses disposable PostgreSQL 17 containers for CI on Ubuntu 24.04 **amd64 and ARM64** with Node.js 22 and 24. Verifies migrations, rollback/reapply, cross-site read/write isolation, persistence across connections, Argon2id verification and session revocation.

## Development-only database commands

The user has explicitly chosen **not** to install Domyro on their own server. Do not run this against the owner's home servers or production databases. For isolated developer environments only:

```bash
npm install --ignore-scripts
# Point DOMYRO_DATABASE_URL to an isolated localhost-only Postgres TEST database.
# Safe, read-only inspection:
npm run db:check
# Explicit schema modification, only after reviewing the SQL:
npm run db:migrate
```

Migration is **not** part of `npm start` or software update checking. There is no production database provisioning or credential rotation yet. Never include credentials in GitHub code, logs or support screenshots.

## Design/release blockers remain

- **Experimental localhost login and console-only first-owner bootstrap are now implemented**, with HttpOnly SameSite cookie, CSRF protection and in-memory login throttling. **Not production-grade:** HTTPS/Secure cookies across domains, distributed rate limiting, MFA/TOTP/passkeys, recovery codes, audited session UI and step-up authentication are still missing. No unauthenticated site API is exposed.
- Missing actual devices/entities, state/event outbox and history, MQTT and Matter integrations, and automations.
- No full data encryption/backup/blank-host PostgreSQL restore, no proven migrator recovery across a production update, no Ubuntu native one-command installer or safe manual update workflow. D-53 remains blocked.
- Dependency versions are **exact-pinned at top-level**, but the committed npm lockfile, full transitive dependency audit, SBOM and reproducible artifact-signing process remain future release gates. Do not publish production packages based solely on CI.
- The SQL schema is versioned immutably once deployed. Future changes must add higher-numbered SQL migrations, never silently rewrite previously applied migration files.
- Remote databases are not yet enabled in the development preview. Future managed/external PostgreSQL selection must enforce TLS and carefully scoped roles.
- GitHub branch protection remains owner-deferred GOV-01.

See [LOCAL-AUTH-FOUNDATION.md](LOCAL-AUTH-FOUNDATION.md), [DATABASE.md](DATABASE.md), [DEV-START.md](DEV-START.md), [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), and [G0-READINESS.md](G0-READINESS.md).
