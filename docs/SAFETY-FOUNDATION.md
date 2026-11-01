# Domyro 0.1 — Update, backup and installer safety foundation

**Milestone:** M1 / DOM-143 preparatory code  
**Status:** Pure safety rules plus **isolated release directory staging**, **pointer-only test rollback**, a **development source-bundle signing utility** and a **bounded encrypted test snapshot primitive**. Tested on hosted Ubuntu x86-64/ARM64 CI, **but NOT** an installer, real updater, PostgreSQL backup/restore engine, production release or deployment approval.  
**Owner deployment gate D-53:** CLOSED. No installation on the owner's own server until complete safe one-command installation and update/restore lifecycle is built, tested and separately approved.

## Streaming PostgreSQL backup v2 (still NOT deployable)

`src/lifecycle/streamed-backup.mjs` and `src/lifecycle/streamed-postgres-backup.mjs` encrypt real PostgreSQL output in chunks to an atomic private no-overwrite file. An authenticated temporary plaintext archive is passed to scratch-only `pg_restore` **after** AES-GCM verification. The v2 path is capped at 2 GiB by default; a 27 MiB streaming fixture, a real PostgreSQL round-trip, failed exporters, malformed archives and tampering are covered by isolated tests. This is NOT a full-system back-up or production restore. See [STREAMED-BACKUP-V2.md](STREAMED-BACKUP-V2.md).

## New PostgreSQL 17 encrypted backup + restore proof (NOT deployable)

`src/lifecycle/postgres-snapshot.mjs` now invokes real PostgreSQL 17 `pg_dump` and `pg_restore` tools with strictly local credentials; encrypts and authenticates a bounded custom-format dump; validates it; and restores **only into a new empty disposable test database**. CI tests on x86-64 and ARM64 verify actual user/site/room/device/observation data survives, incorrect passwords and damaged backups fail, an authenticated but invalid PostgreSQL archive leaves the target empty, and populated restore targets are rejected. **No complete service configuration/Matter/secrets backup, streaming large datasets, production restore or core-update integration exists yet.** See [POSTGRES-BACKUP-RESTORE.md](POSTGRES-BACKUP-RESTORE.md).

The separate `src/lifecycle/backup-file-store.mjs` and tests now also prove **private 0600 encrypted file persistence, fsync-before-publication, atomic no-overwrite hardlink publishing, symlink rejection and saved-file-to-clean-database restore**. This does not implement scheduled jobs, external backup targets or full-system recovery.

## Newly implemented (not deployable) building blocks

- `src/lifecycle/native-preflight.mjs`: read-only Ubuntu LTS/architecture/resource eligibility, without changes to the host.
- `src/lifecycle/transactional-release.mjs`: in an **isolated temporary test directory** stage release files only after signature/hash verification, recheck staged files before activation, then switch a version pointer with a health probe and revert the pointer if it fails. It **does not** stop/restart systemd, migrate/restore PostgreSQL, manage processes or guarantee crash-safe recovery of a real deployment.
- `tools/build-release.mjs`: build and sign **development source-bundle artifacts** for amd64/arm64 with an explicit developer-provided Ed25519 private key. Neither an official signing key nor an installable native Ubuntu package exists yet. Never commit a private key.
- `src/lifecycle/encrypted-backup.mjs`: AES-256-GCM + scrypt encryption/decryption of **small in-memory test data**, with tamper/wrong-password tests. This is **not** PostgreSQL backup or a recoverable home dataset.
- `tests/isolated-upgrade-e2e.test.mjs`: cross-module test of signed test bundles, fixture encryption, bad health and pointer-only rollback on both artifact architectures.
- `config/installation-readiness.json`, `scripts/check-installation-gate.mjs` and the release-gate workflow: keep **owner-server installation blocked by default**. No automated release is created.

## Implemented modules

| Module | What is implemented | What it does NOT do |
|---|---|---|
| `src/lifecycle/release.mjs` | Ed25519 detached signature verification of the exact release manifest bytes, SHA-256 artifact digest validation, strict version comparison and fail-closed manual-upgrade preflight. | Does not pin an official distribution signing key, fetch/download binaries, install packages, migrate databases, restart services, make backups or perform rollback. |
| `src/lifecycle/backup-retention.mjs` | A deterministic **read-only** retention planner for **7 daily, 4 weekly and 12 monthly** snapshots, calculated independently for each target. Preserves held, foreign, failed or unverified copies and last healthy snapshot. | Does not verify snapshots, create back-ups, mount USB/SMB/FTP, call `rm` or delete data; `proposedRemovals` are **not** executable instructions. |
| `src/lifecycle/install-plan.mjs` | A non-mutating decision planner for PostgreSQL, Mosquitto, Zigbee2MQTT and Matter.js: locally managed, external or deferred when optional. Detects already-existing unowned services and refuses automatic takeovers. | Does not install anything, open ports, create users, execute systemd commands, touch a Zigbee coordinator or change the host. |

These rules are the first isolated, testable building blocks for the required one-line installer and manual update workflow, **not a claim that either workflow exists**.

## Test coverage

`npm test` covers:
- Deny-by-default site permission and real observed versus requested state (existing foundation).
- Strict SemVer order and malformed prereleases.
- Signed manifest authentication, invalid signatures, wrong trusted key, tampered artifacts and malformed/duplicate artifact targets.
- Update authorization, version/architecture compatibility, database migration restrictions, free space and recent verified recovery snapshot requirements.
- Independent NAS/USB retention policies, held/foreign/unverified snapshots, safe retention floor and invalid metadata.
- Optional versus mandatory native supporting-service choices, missing external services and refusing to take control of a foreign service.

Run local isolated development tests without touching production servers:

```bash
npm test
npm run check
```

GitHub Actions also runs these checks on Node 22 and 24. The ephemeral Ed25519 test keys are **generated by the test process** and are **not official release-signing keys**.

## Security and design notes

- `assessManualUpgrade` is a **pure planning function**. A future trusted updater must obtain the signing public key from a verified pinned trust store, not from an untrusted manifest or download response.
- Backup statuses passed into the update preflight are currently *test inputs*. Actual backup consistency, verification, decryptability and restore testing are **not yet implemented**. Do not wire a UI button directly to this function and describe the result as a production authorization.
- Database schema changes are **blocked** by the current preflight until reversible migration or tested protected recovery machinery exists.
- The retention planner's buckets are UTC day, Monday-start week and month. Exact household time-zone semantics, archive ownership attestation, multi-target verification and safe deletion executor are still undecided/testable design work.
- The installer plan contains **no privileged helper**. Real Linux service management will require a narrowly restricted process with authentication and clear administrator consent.
- The code has no third-party runtime dependencies, and new modules have no network, filesystem-write or device side effects.

## Additional implementation: isolated release-directory staging and host preflight

**Development-only, tested components (not production lifecycle):**

- `src/lifecycle/native-preflight.mjs` checks Ubuntu LTS, amd64/arm64 CPU architecture and preliminary resource requirements, without changing the host.
- `scripts/inspect-native.mjs` prints read-only host checks using `npm run preflight:read-only`; **this is not an installer**.
- `src/lifecycle/transactional-release.mjs` stages in-memory bundles after verifying a pinned Ed25519 release signature and artifact digest. It rejects unsafe paths, keeps staged releases separate and requires a version-specific confirmation and a caller-reported verified backup before an isolated pointer switch.
- The switch re-verifies the signed receipt and every staged file against its content, probes health using a **test-supplied callback**, and restores the previous release symlink if the callback fails. It does not restart processes, alter a database, make a real backup or guarantee safe production rollback.
- Integration tests use disposable temporary directories, deliberately corrupted bundles/files and a failing health probe. No actual installed OS package, application data or server services are touched.
- GitHub Actions targets `ubuntu-24.04` and `ubuntu-24.04-arm`, each with Node.js 22 and 24. These are **runner tests**, not bare-metal deployment certification.

**Security gaps remain:** no official pinned release-signing public key, no downloadable signed production bundle, no account authentication, no privileged but restricted service helper, no PostgreSQL snapshot consistency, no genuine readiness probe and no crash-safe process/systemd transaction journal. The caller-provided `verifiedBackup` flag is **only a test contract** and must not be trusted as proof until tied to the validated backup subsystem.

**The owner-server installation gate is still CLOSED.**

## Outstanding D-53 gate (still CLOSED)

An actual one-command install command will only be published **after** official key pinning/distribution, safe per-service native Ubuntu installer, fully functional PostgreSQL/auth/API and real-device integrations, dependency review, real encrypted database backups, manual updater and database-safe rollback/recovery, VM and bare-metal multiarch failure injection, and separate owner approval. These are not solved by signing source ZIP/JSON files or passing hosted unit tests.

Before owner-server deployment: publish and verify a real one-command Ubuntu LTS amd64/arm64 installer; implement secure owner login/PostgreSQL and configurable managed dependencies; real update download staging and explicit manual install; encrypted backup+restore across supported targets; isolated upgrade and fault-injection tests, including database migrations and crash-safe recovery; and formal owner's separate server installation authorization.

See [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [TEST-RELEASE.md](TEST-RELEASE.md), [DEV-START.md](DEV-START.md).
