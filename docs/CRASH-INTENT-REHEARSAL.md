# Crash-visible activation intent: isolated release rehearsal

**Date:** 2 November 2026  
**Scope:** development-only source-pointer activation in private scratch directories.  
**Gate:** **D-53 CLOSED**. No real installation, updater, device control or owner-server access.

Domyro's isolated `switchActiveBundle` prototype now records a bounded `.activation-intent.json` **before** changing the `current` symlink. It writes the intent with exclusive creation, restrictive permissions and file `fsync`, then `fsync`s the containing directory. Pointer changes also sync the containing directory. On a successful health probe, both the signed candidate and active pointer are reverified before the intent is removed. On a failed probe, the previous signed release is restored and verified before intent removal.

The journal contains only the previous version (or null for initial activation), target version, format identifier and closed gate. It does not contain keys, tokens or database credentials. It is a crash **indicator**, not a complete recovery transaction. A left-behind intent always blocks subsequent activations, even if someone manually removes a leftover activation lock. Corrupted, oversized, symlinked or hardlinked intent files are rejected. Reads are bounded on the opened inode.

## Read-only interrupted-state inspection

`inspectInterruptedActivation({root,trustedPublicKeyPem})` checks the existing marked scratch root and returns `clean`, `unresolved_lock` or `interrupted`. In an interrupted state it reports the observed pointer, whether the pointer matches either expected version, and whether the previous/candidate **source trees** pass signed verification. It never changes a symlink, clears a lock, restarts a process or restores data. It always returns `automaticRecoveryAllowed:false` and `gate:'D-53'`.

## Tested interruption

`tests/activation-journal.test.mjs` stages two test-key-signed versions, activates the old one, then starts the new activation in a **child Node process**. The child is killed with **SIGKILL after the pointer has changed**, simulating sudden loss of the updater process. The parent checks that the durable intent survives, that the new pointer is observable, that inspection reports an interrupted transaction and that another activation is refused. Additional tests cover normal completion, failed-probe rollback, journal tampering during health probing, corrupted rollback source, malformed/oversized/symlinked/hardlinked journals, missing root and orphaned lock.

These tests run on GitHub-hosted Ubuntu 24.04 AMD64 and ARM64 under Node 22/24. They do **not** simulate an actual host power cut, kernel crash, storage-cache loss, database migration, coordinated systemd shutdown or an OS reboot. `fsync` is a necessary durability primitive but not a guarantee against defective hardware or filesystems.

## Mandatory next work

A real installer/updater needs a trusted persistent release signing key and authenticated update source; privileged service coordination and process fencing; an exclusive lock across reboot; an authenticated backup/restore record for PostgreSQL, configuration, secrets and Matter; a verified recoverable database migration strategy; and VM-based reboot/power-loss tests. Only then can an owner-approved **manual** update or rollback be considered. **Do not run this prototype on the owner's actual Ubuntu server.**

**Attribution:** Domyro is developed using AI, under the supervision of and in collaboration with [@TheRoyalCaptain](https://github.com/TheRoyalCaptain). AI-generated changes remain subject to independent review and testing.
