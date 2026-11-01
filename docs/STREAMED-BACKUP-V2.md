# Streaming PostgreSQL backup v2 (development milestone)

**Date:** 2026-11-01  
**Status:** Isolated developer/CI proof. **D-53 remains CLOSED**: no official one-line Ubuntu installer, updater, recovery on an occupied database, or authorization to install on the owner's server.

This is an **additive v2 format** alongside the earlier 20 MiB in-memory v1 prototype. It **does not replace or silently migrate** existing backups.

## Implemented

### Authenticated streaming format (DOMYROS2)

- `src/lifecycle/streamed-backup.mjs` encrypts each input chunk with **AES-256-GCM**, deriving a 256-bit key from the passphrase with scrypt (32768/8/1), a random 32-byte salt and a random 12-byte nonce. The header is authenticated as AES-GCM additional data. No full plaintext dump is accumulated in RAM.
- Every backup is first written to an exclusive **0600 temporary file in an existing private 0700 directory**, then fully written, `fsync`-ed and published with a **no-overwrite hardlink**, only when the producing process has exited successfully. Source stream errors, size-limit errors or unsuccessful producer exit leave no visible published backup.
- Reading uses `O_NOFOLLOW`, metadata/inode/permission checks and bounded 64 KiB decryption reads. The complete GCM authentication tag must validate **before** the calling restore routine gets access to the plaintext. The decrypted plaintext is written to an **unpublished private temporary file** and removed after the callback, whether success or failure.
- A configurable maximum plaintext size defaults to **2 GiB** for this development proof, replacing the *v2 path's* old 20 MiB cap. It is still an explicit cap, not unlimited backup capacity. The original v1 route remains bounded to 20 MiB. The filesystem must have enough capacity for encrypted backups **and a temporary decrypted archive**, and that free-space check is not yet integrated.

### PostgreSQL 17 streamed round trip

- `src/lifecycle/streamed-postgres-backup.mjs` pipes actual `pg_dump --format=custom` output into the encrypting stream, and refuses to publish the backup if `pg_dump` fails.
- Restore authenticates/decrypts the **entire encrypted archive first**, validates the PostgreSQL `PGDMP` header, verifies a strict `domyro_restore_test_...` database name, checks that its `public` schema is empty, and feeds the private authenticated archive into `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`. It then verifies Domyro's migration checksums.
- Live databases and any already populated target remain **untouchable**: no `DROP DATABASE`, `--clean`, `--create`, schema reset or automatic application migrations.
- The CI test uses an independent disposable PostgreSQL 17 source and target, inserts a real migrated installation/user/site/room, performs a streaming backup and restore, and checks the restored content. It also tests wrong passwords, a failed exporter, malformed authenticated non-PostgreSQL data and refusal to overwrite an existing backup or restore into an occupied database.
- `tests/streamed-backup.test.mjs` tests a **27 MiB** encrypted/reverified stream, corrupted ciphertext, wrong passwords, interruption/failed producer, size limits and no leaked published files.
- Tests run on Ubuntu 24.04 **amd64 and ARM64**, using Node.js 22 and 24. The PostgreSQL 17 CLI runs in disposable Docker containers **inside CI only**.

## Deliberate boundaries and risks

- This is a **developer-only API**. It has no installer command, backup scheduler, retention execution, USB/NAS/SMB/SFTP storage, compression policy, key vault, key recovery, secure memory lock, streaming support for remote storage, maintenance coordination or automatic update integration.
- When restoring, the entire authenticated plaintext archive temporarily exists **unencrypted on local private disk**. A disk with full-disk encryption and carefully scoped filesystem access is a future deployment prerequisite; secure erase/SSD remanence and interruption cleanup need separate testing and designs.
- AES-GCM authenticity confirms that the file was encrypted with the supplied passphrase and has not been altered. It **does not independently prove** that every application file, integration key, Matter fabric or Zigbee2MQTT configuration is present.
- The database is read during `pg_dump` using PostgreSQL's snapshot semantics, but other services are not quiesced, so **consistent multi-service disaster recovery is unproven**.
- The 2 GiB cap, whole-file temp decryption and strict localhost-only PostgreSQL URL are intentional early restrictions, not a commitment about final performance or a validated volume limit for arbitrary users.
- The test restore runs only against a **pre-created empty disposable database**, so it is NOT suitable for updating/rolling back an existing production Domyro database. Multi-process race prevention, real PG role isolation, protection of the restore target from other writers and crash recovery still require review.

## Next implementation priorities

1. Complete backup catalog and storage targets, safe retention and monitoring.
2. Capture and restore **all** application secrets/configuration, Zigbee2MQTT-managed state and Matter fabric identity consistently with PostgreSQL.
3. Safe owner-authorized disaster restore to a **new dedicated Domyro instance**, with key recovery, full application health checks and later a supported manual upgrade rollback strategy.
4. Native Ubuntu LTS one-command installer for amd64/arm64 with signed immutable releases, selectable dependencies, owner onboarding, service health, and independent VM/hardware tests.

**Do not recommend installing Domyro on the owner's server before the entire D-53 checklist has passed.**

Related: [POSTGRES-BACKUP-RESTORE.md](POSTGRES-BACKUP-RESTORE.md), [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [TEST-RELEASE.md](TEST-RELEASE.md).
