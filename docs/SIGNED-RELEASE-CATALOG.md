# Signed release catalog selection (offline development proof)

**Development date:** 2 November 2026  
**Status:** offline prototype only. **D-53 CLOSED.** Do not deploy to owner servers.

Domyro is an **AI-developed project under the supervision of and in collaboration with [@TheRoyalCaptain](https://github.com/TheRoyalCaptain)**. The project owner retains release and deployment authority.

## Implemented

The new `src/lifecycle/signed-release-catalog.mjs` function `selectSignedUpdateFromCatalog` accepts a **caller-supplied, in-memory** bounded list (maximum 64) of individually Ed25519-signed manifests, one **externally pinned** publisher public key, the installed version, Ubuntu architecture, database schema, update preferences, current time and an optional previously trusted high-water release version.

It verifies each signature against the one pinned key, rejects malformed/unsigned entries, detects **conflicting valid signed manifests for the same version** and refuses the entire catalog in that case, deduplicates identical signed manifests, and sorts compatible versions by strict SemVer rather than upload or publication order. It can skip newer releases that are incompatible with the current architecture, database schema or selected stable/beta channel. A trusted high-water mark blocks a catalog rollback and prevents selecting versions below that mark, even if signed. The caller is responsible for obtaining the high-water mark from **trusted durable local state**, never from the remote catalog itself.

The result distinguishes a selected candidate, no compatible release, an untrusted/empty catalog, equivocation and rollback. It also exposes the existing download-only eligibility/delay advice. **Every result has `installAllowed:false`, `automaticInstall:false`, `manualInstallRequired:true` and `installationGate:'D-53'`.** A candidate is not installation consent.

## Tests and scope

`tests/signed-release-catalog.test.mjs` covers newest SemVer selection, incompatible releases, stable/beta filtering, forged signatures, conflicting valid signatures, exact duplicates, high-water rollback, an incompatible newer high-water candidate, download delay, future publication timestamps and invalid input.

The test suite runs with Node 22/24 on GitHub-hosted Ubuntu 24.04 AMD64/ARM64. It does not make network requests, read or write owner state, invoke systemd, perform migrations, install packages or connect to a device.

## Not yet implemented

This is **not an official release feed, update service or trust-root management system**. A production implementation still requires owner-approved signing keys and rotation/revocation, an authenticated official feed with anti-replay/freshness rules, durable protected high-water storage, offline recovery policy, secure staged downloads, full-system backups, manual owner approval, rollback/recovery and end-to-end independent tests. This module is not wired into the live Update Center and cannot enable installation.

See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md), [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
