# Domyro: pinned runtime dependencies and real two-version update rehearsal

**Developer milestone:** 1 November 2026  
**Repository:** [TheRoyalCaptain/Domyro](https://github.com/TheRoyalCaptain/Domyro)  
**Governance:** AI-developed in cooperation with and under the supervision of [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).  
**Installation gate D-53: CLOSED.** Nothing in this milestone is authorized for deployment to the owner's Ubuntu servers, Home Assistant, MQTT/Zigbee2MQTT network, or Matter fabrics.

## 1. Lockfile and reproducible dependencies

`package-lock.json` is now committed and contains pinned transitive dependencies with npm registry-integrity hashes. The prior `npm install` CI step has been replaced with:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

The reproducible lockfile is now included in the Ed25519-signed **source release bundle** as well as `package.json`. The development-only npm dependency rehearsal (`src/lifecycle/native-dependency-rehearsal.mjs`) stages the signed bundle into a new OS-created temporary directory, validates the source against the signed manifest, and performs an actual `npm ci --omit=dev --ignore-scripts` inside that directory. All package download and extraction output remains isolated; postinstall scripts are never executed. It checks that the versioned lockfile matches the manifest's package metadata, and verifies actual imports and function availability for `@node-rs/argon2`, `pg`, and `mqtt`, including a real Argon2 password hash/verification round trip.

The sandbox is removed on success or failure. The tests run with Node 22 and Node 24 on Ubuntu 24.04 x86-64/AMD64 and ARM64. A temporary generator workflow used to make the initial lockfile has been removed.

**Still missing:** official signed provenance for the registry tarballs beyond npm integrity, reviewed supply chain policies, a pinned Ubuntu-provisioned Node runtime, artifact-level reproducible binary build evidence, offline dependency availability and a production-safe service installation/uninstall.

## 2. Running native update rehearsal with actual processes

`src/lifecycle/native-update-rehearsal.mjs` stages **two separately signed Domyro source releases** under a disposable release store. It requires exact version confirmation, verifies each bundle, boots a real Node child process running the original version, and checks the localhost health/status/login endpoints.

The rehearsal then stops the old process and switches the current release pointer to the candidate. It starts the new version as a distinct process and probes it. In a deliberately injected candidate-health failure, the existing transactional release code reverts the version pointer and the rehearsal **starts and probes the previous real process again**, rather than merely asserting that a pointer string changed.

The result explicitly remains:

- `productionApproval: false`
- `databaseMigrated: false`
- `systemdActivated: false`
- `realBackupTested: false`
- D-53 remains **closed**

This is a **test-only rollback of source code and processes**, not of real PostgreSQL/configuration state. It cannot be used as the owner-approved update engine. The deliberately synthetic `verifiedBackup: true` argument in the isolated release-probe harness is **not** evidence of a real complete snapshot.

## 3. Genuine Ubuntu systemd syntax verification

The existing non-installed systemd draft is now inspected with `systemd-analyze verify` on both Ubuntu architectures. The CI runner provides Node through a separate test path, so the verification substitutes the runner's executable **in a temporary copy of the unit only**. The actual unit draft still requests `/usr/bin/node`, which must be packaged/provisioned during the real installer. **No service is enabled or started via systemd**, and no unit file is installed in the host's `/etc/systemd/system`.

## 4. CI acceptance and remaining blockers

All **96/96 automated tests passed across 4/4 Ubuntu CI jobs**, including the signed-bundle source boot, native dependency provisioning, two-version process update, forced rollback, real disposable PostgreSQL recovery, and new systemd syntax tests.

Before installation becomes permissible we still need:

1. Complete native Ubuntu LTS **one-command installer**, including privileged account/policy setup, immutable runtime ownership, ports, verified dependencies, PostgreSQL configuration and optional services.
2. A **fully secured and owner-authorized** web update flow, real signed feed/key lifecycle, release download/staging and full system rollback/recovery.
3. Full encrypted **multi-service** backup and verified restore of live application data, configuration, secrets and Matter fabrics.
4. Independent clean-VM and in-place upgrade recovery tests, power-loss and disk-full failure tests, and bare-metal hardware acceptance on both amd64 and ARM64.
5. A separate explicit deployment approval from @TheRoyalCaptain, even if all technical checks pass.

Do not present these development tests as a release or ask the owner to run an installer. See [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [NATIVE-SERVICE-REHEARSAL.md](NATIVE-SERVICE-REHEARSAL.md), [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md) and [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md).
