# Domyro 0.1 — Local owner account and authenticated room preview

**M1 foundation only. This is not a finished authentication subsystem or native installer.**  
**D-53 deployment gate: CLOSED. Do NOT run on the owner's operational server.**

## What has actually been built

The development preview now contains:

- **Console-only, one-time owner initialization**. A CLI operation checks that migrations are complete, obtains an installation-scoped PostgreSQL advisory transaction lock, refuses to take ownership if any account already exists, and commits the owner account, home/site and owner membership atomically. It neither exposes a web bootstrap token nor resets existing accounts.
- Argon2id password hashing, random 256-bit session tokens stored as SHA-256 hashes, expiring sessions, logout/revocation, disabled-account checks and generic invalid-login responses.
- **A loopback-only, early HTTP auth API**. It rejects access originating outside 127.0.0.1/::1 and requires an explicitly local Host; write requests require the exact same Origin. Strict SameSite and HttpOnly session cookie; CSRF token returned on authenticated same-origin responses and required for writes. A basic, process-local failed-password rate limit is present.
- Authenticated `GET /api/v1/auth/me`, `GET /api/v1/sites`, `GET /api/v1/sites/{id}/areas` and manager/owner-only `POST /api/v1/sites/{id}/areas`. All site/room reads and writes are SQL-parameterized and scoped to an active site membership.
- `/login`: a **development-only** login and room-management screen. User display text is added through textContent, without inserting raw values as HTML. No JWTs, passwords or bearer tokens are saved in localStorage or sessionStorage.
- PostgreSQL integration tests on disposable databases validate one-time bootstrap, login, CSRF, guest write refusal, forced logout, forged Host header rejection, and unknown-user rate limiting.

## Deliberately limited to localhost

This is an early **development preview**, not the final network security architecture. The example server only enables the HTTP auth service when its requested bind address is explicitly loopback (`127.0.0.1` or `::1`). The auth service also verifies the requesting TCP peer and local Host. Opening the preview to the LAN does **not** enable auth.

The dev cookie is restricted to the loopback HTTP preview. It is not a production-grade secure HTTPS cookie, does not support reverse-proxy trust configuration or TLS termination, and must not be used as a production session policy. The future installer needs proper HTTPS, TLS-aware cookie policy, Host/Origin validation across IP/mDNS/own-domain access and trusted proxy handling.

## For an isolated developer CI/VM only

**These are not installation instructions for the owner's server.** The actual supported one-command installer does not exist yet.

The preview requires a separate local test PostgreSQL database with migrations applied explicitly:

```bash
npm install --ignore-scripts
npm run db:check
npm run db:migrate    # Explicitly changes the isolated test DB only
```

Run `npm run auth:bootstrap -- --login dev-owner --site "Testwoning" --password-file /absolute/private/dev-only-password-file` **only inside the isolated test VM/database**. The password file must be a private regular file with no group/other permissions, must not be a symlink, and must never be committed. The CLI accepts the password via file rather than shell arguments or command-line history. Use a strong unique developer-only secret. Remove the file after the account is created. The CLI refuses to create a second owner when any account exists.

Then start `npm start` and open `http://127.0.0.1:8844/login` from the same isolated computer.

No database, OS packages, services or applications are provisioned automatically. Browser login endpoints stay unavailable if the server is started without an explicit isolated PostgreSQL connection. No Home Assistant, Zigbee or MQTT settings are accessed.

## Not yet completed or approved

- **No finished browser-based first-run owner setup**, pairing or recovery. Console bootstrap is a narrow development primitive, not the final owner onboarding.
- Rate limiting is in-process only; production requires bounded global/account/IP limits and distributed consistency across workers and restarts. There is no MFA (TOTP/passkeys), recovery-code or local console recovery flow, reauthentication/step-up, device trust, robust session management UI, intrusion lockouts or audited security events.
- HTTPS, `Secure` cookies and a vetted multi-host/reverse-proxy deployment have not been implemented. Access must remain loopback-only.
- Login is not enabled for WAN/LAN use, and no complete installer, device commands, real Zigbee2MQTT/Matter adapter, encrypted whole-database backup or rollback-safe upgrades exist.
- Default application readiness remains **503** and `productionReady=false`. The closed [machine-readable D-53 gate](../config/installation-readiness.json) must remain closed even though these early security tests pass.
- Security review, production dependency-lockfile audit, end-to-end browser tests and actual hosted install/upgrade tests remain release blockers.

See [PERSISTENCE-FOUNDATION.md](PERSISTENCE-FOUNDATION.md), [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [DEV-START.md](DEV-START.md), and [G0-READINESS.md](G0-READINESS.md).
