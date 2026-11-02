# Isolated interrupted-activation recovery rehearsal

**Status:** development-only source-pointer drill. **D-53 remains CLOSED.**
Domyro is an AI-built project under the supervision of and in collaboration with
[@TheRoyalCaptain](https://github.com/TheRoyalCaptain).

## Scope

`src/lifecycle/isolated-crash-recovery.mjs` adds a deliberately constrained
`rehearseInterruptedPointerRecovery()` function for a **disposable test directory**.
It is not connected to the HTTP API, any installer, a background task or a real
server. It performs **no systemd, database, configuration, MQTT, Zigbee2MQTT,
Matter, network, package or user-account operation**.

The function requires all of:

- A private direct child of the OS temporary directory named
  `domyro-recovery-rehearsal-*`, containing a valid isolated release marker.
- Explicit `testOnly: true`, `processExited: true` and
  `verifiedBackup: true` arguments.
- The exact previously active signed version repeated in
  `confirmedPreviousVersion`.
- An intact persisted crash intent, matching active version pointer and a
  previously signed release that re-verifies against the supplied trusted key.
- An exclusive temporary recovery lock; any concurrent recovery is rejected.

The `processExited` and `verifiedBackup` inputs are **caller assertions**,
not independently proven facts. They must never be accepted as production
authorization. The real installer needs actual process fencing, coordinated
database/config/Matter restoration and independent recovery evidence.

## Recovery sequence in tests

1. Stage and verify two Ed25519-signed development source bundles.
2. Activate the old version, then SIGKILL the child updater after the pointer
   changes to the new version.
3. Verify that the intent and old/new versions survived.
4. Explicitly approve the old version in the disposable fixture only.
5. Re-verify the old signed source and journal, atomically switch the
   **test-only** symlink back and fsync its parent directory.
6. Re-verify the restored pointer and old source, then remove the stale
   activation lock and clear the durable intent.
7. Remove the separate recovery lock. Only then can another isolated
   switch proceed.

If any integrity or authorization check fails, the drill refuses the change.
If a filesystem error occurs after pointer rollback, the intent remains until
the cleanup and verification sequence succeeds. A leftover recovery lock
also blocks later source switches and appears in read-only diagnostics.

## Explicitly not proven

This is not a real power-loss test, process-fencing implementation, PostgreSQL
restore, Matter-fabric recovery, safe migration, or production rollback.
There is no production signing key, service quiescence proof, full backup
attestation, one-line installer, or permission to deploy. The current
`config/installation-readiness.json` D-53 checks remain false.

Run locally only inside disposable test fixtures via `npm test`.
Do not copy this procedure to an owner server or use it on live services.

## Interrupted recovery retry and lock-ownership regression (2026-11-02)

The recovery test suite now terminates a **separate recovery process with
SIGKILL** at two deliberately injected, test-only checkpoints: immediately
after the old source pointer is restored and after the stale activation lock
has been removed but **before** the durable activation intent is cleared.
Both windows must retain the intent and exclusive recovery lock. A second
recovery attempt fails closed while the lock remains. In the disposable test,
an operator then removes the confirmed stale lock and explicitly retries the
same signed previous version; the retry completes and the read-only diagnosis
returns to `clean`. These tests do **not** automatically clear stale locks.

The recovery function also compares the recovery-lock inode it originally
created with the inode present during cleanup. A replaced lock is not
silently deleted, and the intent remains for manual investigation. This is a
**fixture-only defensive check, not an atomic host process fence**: an
adversarial concurrent filesystem writer can still race between checking and
unlinking, so this function must not be repurposed for live updates.

The `onTestCheckpoint` callback exists solely to exercise these controlled
crash windows inside the disposable recovery rehearsal. It does not grant
permission to touch production services or relax D-53.
