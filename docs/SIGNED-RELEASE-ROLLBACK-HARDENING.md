# Signed release and rollback integrity hardening

**Scope:** isolated development release staging and pointer-switch rehearsal only.  
**Status:** D-53 **CLOSED**. Not a production installer, updater, backup or rollback guarantee.

Domyro's `src/lifecycle/transactional-release.mjs` already verifies an Ed25519-signed manifest and signed artifact bytes before staging, and rechecks the signed file inventory before an isolated activation. This milestone tightens the checks that prevent a previously staged release from being replaced or weakened while waiting for explicit approval.

## Changes verified in CI

- **Receipt authenticity and filesystem identity:** the `.receipt.json` must be a regular, single-linked, non-symlink file. Its size is bounded before reading, and it cannot be writable by group or others. A symlink to an otherwise valid receipt is rejected.
- **Signed file integrity:** every signed source file must be a regular, single-linked, non-symlink file, must not be group/world writable and must match the signed bytes. Hardlinks to external paths are rejected.
- **Directory inventory and permissions:** unexpected directories, including empty ones, are rejected. Release and nested source directories must not be group/world writable.
- **Rollback preflight:** if a previous release is active, its entire signed inventory is re-verified **before** the candidate pointer can be changed. A corrupted previous version prevents the update and the candidate probe is never invoked.
- **Explicit non-production result:** a successful isolated switch reports `installationApproved:false` and `gate:'D-53'`, so a test result cannot be mistaken for production authorization.

Regression tests live in `tests/transactional-release-hardening.test.mjs`, and run as part of the existing Node 22/24, Ubuntu 24.04 amd64/arm64 CI matrix.

## What this does NOT prove

The rehearsal's `verifiedBackup:true` is still only a caller-provided **test flag**, not independent evidence that PostgreSQL, configuration, encryption keys, Zigbee2MQTT and Matter fabrics can be restored. The pointer switch does not control a production systemd service, coordinate database migrations, prevent all filesystem races, survive host power loss with a durable recovery journal, or validate a real Ubuntu ISO install. The rollback preflight proves only that the previous **signed source tree** is intact at that instant.

No production installer or automatic update is permitted. Full-system backup/restore and reboot/power-loss fault injection are required before the installation gate can be reconsidered.

**Project attribution:** Domyro is developed with AI, under the supervision of and in collaboration with [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).
