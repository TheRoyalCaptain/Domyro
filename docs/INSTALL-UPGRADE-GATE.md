# Domyro — Installer and upgrade safety: mandatory owner deployment gate

**Decision:** D-53 · **Owner approved** · 31 October 2026  
**Priority:** P0 **hard blocker for installing Domyro on the owner's server or recommending production installation**.  
**Status:** Acceptance specification; **deployment gate CLOSED**. Development now includes Ubuntu host preflight, a signer for multiarch **source** bundles, Ed25519 verification, an isolated test-directory release switch and pointer-only rollback, authenticated encryption of small synthetic backup fixtures, and a machine-readable blocklist. **These do not yet comprise a complete installer, integrated updater, production-grade full-system PostgreSQL/config restore or safe production rollback**. See [SAFETY-FOUNDATION.md](SAFETY-FOUNDATION.md) and [../config/installation-readiness.json](../config/installation-readiness.json).  
**Does not authorize:** any install/deployment on the owner's Ubuntu Server, VM, Umbrel, Home Assistant environment or physical devices.

## Owner's explicit requirement

The owner will **not install Domyro on their own server** until BOTH are available **and validated**:

1. A **complete, trusted, one-command native Ubuntu Server LTS installer**, including all required prerequisites, initial setup and per-supporting-service choices.
2. A **safe, reliable update experience** that protects configuration, device bindings, keys and user data, supports backups and recovery and does not leave the installation broken after normal, supported upgrades.

"Never breaks" is a **quality target**, not a technically honest guarantee of zero defects or zero downtime under every condition. The product must preflight, test, fail safely, recover where feasible and transparently document unavoidable risks. An **unrecoverable migration, unrecoverable secrets loss, uncontrolled restart or silent partial upgrade blocks release**.

User's prior policies remain binding: core Domyro update *checks/download-only staging* may be automatic if explicitly enabled; **installing updates and their restarts always requires explicit admin approval** (D-13). Installed plugin updates only auto-*check*, while plugin downloading **and** installing are separate manual actions (D-44). Do not silently update the underlying Ubuntu operating system.

## 0. Machine-readable readiness (intentionally FAIL CLOSED)

The versioned [installation-readiness.json](../config/installation-readiness.json) explicitly records outstanding blockers, and `npm run gate:status` prints them without touching the host. `npm run gate:require` requires **technical readiness and separate owner-server deployment consent**. The tag-triggered [release safety workflow](../.github/workflows/release-gate.yml) requires **technical release readiness only**, not consent for an installation on the owner's server. **No production packages are currently published by that workflow**. A published release never implies permission to deploy to owner equipment. Manually changing status booleans is not proof of test results: independent evidence and the owner's later deployment authorization remain mandatory. GitHub Actions on Ubuntu x86-64 and ARM64 is useful for isolated tests, but **does not prove a complete bare-metal Ubuntu installation**.

### MQTT + site-scoped device registry progress (still NOT an installation)

A read-only MQTT.js Zigbee2MQTT client has passed ephemeral broker tests and a new site-scoped PostgreSQL device/observation schema can store stable IEEE device identities. These are separate development capabilities: **no approved real-hardware Zigbee2MQTT integration, secure broker credentials, automatically enabled site-bound broker-to-DB service, user-authorized actuation or independent physical testing exists**. D-53 installation readiness remains **closed**. See [MQTT-READONLY-FOUNDATION.md](MQTT-READONLY-FOUNDATION.md).

### Isolated native service layout and child-process restart rehearsal (2026-11-01)

A new development-only rehearsal creates a private **temporary** Ubuntu-like `/opt/domyro`, `/etc/domyro`, `/etc/systemd/system` and `/var/lib/domyro` layout (all **inside the sandbox**, never in the real host filesystem). It writes but does not install or activate a systemd unit, checks that laying out a second time is idempotent, validates every staged file anew against the Ed25519-signed release and rejects extra/mutated files or a changed unit. The real staged Domyro server is run in a **separate unprivileged Node process**, probed on a loopback port, stopped, and started again. Tests include signature corruption, mid-install failure and source/unit tampering, with scratch cleanup. **This is neither a systemd-managed service nor an installed Ubuntu VM**, and no package dependencies, service account, PostgreSQL, onboarding, actual updater or full-system recovery are provided. D-53 stays CLOSED. See [NATIVE-SERVICE-REHEARSAL.md](NATIVE-SERVICE-REHEARSAL.md).

### Signed source-bundle boot rehearsal (2026-11-01)

The developer release packer now bundles the **entire bounded source and web runtime tree**, not only a nine-file placeholder, and derives the signed database schema requirement from contiguous SQL migrations (currently 3). A new **disposable localhost rehearsal** verifies the signature, artifact hash and native architecture, boots the **actual staged Domyro HTTP server**, checks health, login HTML, and assets, and then cleans up the temporary directory. It deliberately expects readiness to return HTTP 503 with no PostgreSQL or official onboarding, and tests tampered signatures and injected failures. This is a test of **source-package completeness and localhost boot only**. No Node/npm dependency packaging, production key, native systemd installer, full database/secret recovery or update runtime is present. D-53 remains CLOSED. See [NATIVE-INSTALL-REHEARSAL.md](NATIVE-INSTALL-REHEARSAL.md).

### Installer planning and local Update Center milestone (2026-11-01)

The repository now contains a **pure Ubuntu 24.04 amd64/ARM64 installer planner** validating mandatory PostgreSQL choice, separate service selection, verified existing connections, reserved ports, existing-install upgrade routing and unimplemented managed provisioning. It can render a **non-installed** systemd draft. The authenticated localhost developer UI has an **owner/admin-only Systeemupdates** overview showing the unavailable official signing feed and D-53 closure; the backend explicitly rejects any install request with HTTP 423. Signed update metadata can be assessed offline for channel, schema, architecture and user download-delay preferences, but **no production feed, download worker, privileged installer or running system updater exists**. The code is tested, and D-53 remains CLOSED. See [INSTALLER-UPDATE-CENTER-MILESTONE.md](INSTALLER-UPDATE-CENTER-MILESTONE.md).

### Private scratch-only configuration restoration milestone (2026-11-01)

The development module now restores explicitly selected **encrypted test-only** Domyro/Mosquitto/Zigbee2MQTT configuration files into a newly created private test directory, never to existing service paths. Full AES-GCM authentication and per-file hashes are validated before/after writing; existing targets are rejected, interruptions clean up their own partial output, and a completion marker is only created last. An on-disk audit checks the file set, hashes and restrictive permissions. An isolated CI test restores a separate PostgreSQL 17 database backup **and** a separate config fixture in one disposable test environment. These are **not** coordinated or full-system snapshots, not actual service restarts, and not proof of a safe real disaster recovery. D-53 remains CLOSED. See [SCRATCH-CONFIG-RESTORE.md](SCRATCH-CONFIG-RESTORE.md).

### Local catalog and configuration fixture milestone (2026-11-01)

A read-only local backup catalog now detects encrypted PostgreSQL backups and explicitly selected small Domyro/Mosquitto/Zigbee2MQTT **test configuration fixtures**, authenticates each snapshot, and stores non-secret immutable checksum receipts. A separate recovery coverage contract enumerates PostgreSQL, app configuration, auth/recovery keys, uploads, Mosquitto, Zigbee2MQTT and Matter fabrics. Since an authenticated file is **not** a proven end-to-end recovery, all backup removal suggestions remain **hard-disabled**. None of the fixture code captures live service secrets or restores a running installation. See [BACKUP-CATALOG-RECOVERY.md](BACKUP-CATALOG-RECOVERY.md).

### Tested PostgreSQL archive/restore milestone (2026-11-01)

A real PostgreSQL 17 `pg_dump` custom-format archive is encrypted with AES-256-GCM + scrypt, authenticated and checked with SHA-256, then restored via `pg_restore --single-transaction --exit-on-error` **only into a deliberately empty isolated test database**. Tests verify users, sites, rooms, Zigbee devices and observations across Ubuntu amd64/ARM64 with Node 22/24, reject tampering, and prove a malformed authenticated archive does not populate the target. See [POSTGRES-BACKUP-RESTORE.md](POSTGRES-BACKUP-RESTORE.md).

The earlier 20 MiB in-memory v1 and a **2 GiB bounded streaming v2** developer proof now coexist. Streaming v2 encrypts actual `pg_dump` output into a private no-overwrite file and authenticates it fully before passing an unpublished temporary archive to `pg_restore` for a disposable empty test database. A 27 MiB stream and failed-export/tampering tests run in CI. This is NOT a complete whole-system backup. See [STREAMED-BACKUP-V2.md](STREAMED-BACKUP-V2.md).

**D-53 remains CLOSED:** neither the v1 nor v2 proof restores full Domyro configuration/integration secrets/Matter fabrics, safely recovers a populated live DB, or integrates with a complete installer/manual-updater/rollback transaction. Do not call either a complete backup system.

### PostgreSQL milestone (still not an installation)

A development-only PostgreSQL schema/migrator, internal user/site/area/session primitives, **console-only first-owner initialization and an experimental localhost login/room interface** now exist. The schema migrator runs **only through an explicit CLI invocation** on a separately configured local test DB; no automatic DB setup takes place at server startup or during update polling. **Real PostgreSQL backup, restore, migration recovery, secure production onboarding/MFA/account recovery and the one-line native installer remain unfinished**. Do not mark D-53 as passed based on these CI tests. See [PERSISTENCE-FOUNDATION.md](PERSISTENCE-FOUNDATION.md).

## 1. Complete one-line native Ubuntu Server installer

The official documentation must offer **one clear, copyable installation command** for a clean supported Ubuntu Server LTS host (both amd64 and arm64; physical and VM). It may launch an interactive terminal wizard followed by a secure browser-based onboarding wizard. One command means **one trusted entry point**, not unverified blind execution.

Required behavior:
- Obtain a verified/signature-checked official release manifest and pinned installer; verify origin and SHA-256 or stronger digest, and follow a maintained key-rotation policy.
- Check supported Ubuntu LTS version, architecture, privilege, CPU/RAM/disk, network, port conflicts, hostname availability, DNS, service accounts, USB access and required protocols (including IPv6/mDNS for Matter).
- Show a clear plan and wait for the owner's approval before changing packages, services or network settings. Support safe dry-run, cancel and resume.
- Install/configure Domyro with **native systemd**, no required Docker, dedicated restricted account and durable data/secrets. The installer must not expose unauthenticated setup to the internet.
- Let admin independently choose **managed installation, existing connection or defer if optional** for PostgreSQL, Mosquitto, Zigbee2MQTT, Matter.js and future supporting services. Never seize an existing Zigbee coordinator, database, broker or HA setup silently.
- Initialize database/schema, local trusted owner setup and encrypted configuration storage; ensure the first authenticated onboarding can be completed.
- Offer access by local IP:port and supported conflict-aware mDNS, plus optional own-domain/reverse-proxy guidance, without opening a WAN port by default.
- Register and verify core/updater systemd services, healthchecks, recovery assets, log paths, startup behavior, plugin update policy and backup wizard.
- Show exact installed versions, service health, safe support diagnostics and the local UI address. **A healthy HTTP server alone is NOT sufficient evidence** of usable installed Domyro.
- If install fails, do not damage an existing service or erase user data. Mark a partial install as incomplete and support documented resume/cleanup.

The one-line command must be **genuinely runnable**, not placeholder text, before the user is advised to install. Official download endpoints and release signing must be published and tested; no fabricated install URL.

## 2. A dependable upgrade path, not just a package installer

The **installed** Domyro must expose the following update flow to the authenticated administrator (with CLI recovery if UI is unavailable):

1. **Discover:** optionally check signed release metadata in the background; allow user-controlled verified download-only staging/delay according to D-13. No package installation or restarts during checking/downloading.
2. **Preflight:** report current/target app, database, Matter server, Zigbee2MQTT/MQTT, plugin versions, active automations, disk space, architecture, OS compatibility, changed permissions, migrations and expected interruption. Block updates that fail compatibility or safety checks.
3. **Prepare recovery:** create a consistent encrypted backup of PostgreSQL and all required app configuration, site/entity identity, integration keys, plugin configuration and Matter fabric secrets where installed and owned. Verify backup decryptability and manifest before risking persistent state. Preserve an independently readable rollback manifest and previous runnable application release.
4. **Owner authorizes:** display version and release notes, breaking/irreversible changes, time and exact expected effects. Reauthenticate for dangerous updates. An explicit **Install** action starts each update.
5. **Apply safely:** stop/drain only Domyro-owned processes needed for the update; never automatically update Ubuntu or reflash a Zigbee adapter. Stage immutable signed artifacts; use atomically switched package/release references where practical. Keep failed state diagnostic evidence without storing secrets in logs.
6. **Post-update health:** run readiness, migration version, login/session, API, frontend assets, database access, key availability, automation and owned integration service checks. Successful process startup alone does **not** pass the health gate.
7. **Recover:** on failure, stop a bad version, restore the previous compatible binaries/service configuration; restore database **only where the migration has a proven safe reversal or a verified consistent snapshot is explicitly restored**, without discarding writes made since backup silently. If automatic rollback is unsafe, remain in protected maintenance/recovery mode and explain precise administrator steps.
8. **Audit and notify:** record final status, exact versions, backup and rollback references, affected services and useful sanitized diagnostics. Do not say "updated" until the post-update gate passes.

**Non-negotiable:** A migration that cannot be reversed must be identified before applying. It may require an additional owner confirmation or a different compatibility strategy; never promise a rollback that would lose credentials/data or damage Matter fabrics.

## 3. Full lifecycle requirements

- Support **clean install**, restart after power loss, **repair**, idempotent installer rerun, manual app upgrade, failed-upgrade recovery, encrypted backup/restore and **uninstall preserving data by default**.
- Support **offline recovery using local shell** when the web interface fails; the repair command must be authenticated by a trusted console user and narrowly scoped.
- Support agreed backup targets local/USB/SMB/NAS/FTP (with FTPS/SFTP preferred). Keep owner default 7 daily / 4 weekly / 12 monthly. Backup failure cannot be misreported as success or cause destructive cleanup.
- Detect and respect externally managed services. Never upgrade an external broker, PostgreSQL or Zigbee2MQTT merely because Domyro itself is updated.
- Service-manager updates are a different, explicitly confirmed admin operation. No automatic core/OS/plugin installation.
- Publish supported app upgrade paths (e.g. prior stable to current stable and supported patch levels). Disallow untested leaps and major incompatible changes.
- During a successful upgrade, preserve: users, auth factors and recovery codes, permissions, sites/rooms, entity IDs, scenes, automations and schedules, event/history integrity, dashboard layouts, encrypted integration secrets, plugin version/permission metadata and Matter fabrics when relevant.
- No loss of existing Home Assistant configuration, other services, or Zigbee coordinator ownership.

### Current isolated test progress (not approval)

An initial read-only Ubuntu host preflight and a staged-release file pointer-switch prototype now exist. The latter checks signed bytes and staged-file integrity, requires a manual version confirmation and can restore a previous **symlink** after a test health probe fails. This is not process rollback, database restore, a complete installer or a supported update. The files are listed in [SAFETY-FOUNDATION.md](SAFETY-FOUNDATION.md).

GitHub Actions has been configured for Ubuntu x86-64 and ARM64 development tests; VM/bare-metal system installation and actual recovery scenarios remain **unchecked**. No real deployment is authorized by these changes.

## 4. Acceptance criteria before owner-server installation

**All must pass on isolated test hosts**, not the owner's operational server:

- [ ] One-command clean Ubuntu Server LTS install works end-to-end on **amd64 and arm64**, representative VM and bare-metal targets, with complete prompts and no Docker requirement.
- [ ] Re-running the one-line installer is idempotent; clean failure and interrupted installation are recoverable without compromising existing services.
- [ ] Selecting each installer service decision (install, connect existing, defer if optional) produces expected health/status. Existing Home Assistant/MQTT/Zigbee2MQTT environments remain unaffected.
- [ ] Local dashboard, owner login, persistence, service health and first relevant device setup can be completed after installation.
- [ ] Fresh stable-to-next-supported-stable update passes on both architectures with settings, history, device IDs, accounts, secrets, dashboards and automation preserved.
- [ ] Core automatic checks/download-only staging **never install** packages, run migrations or restart anything.
- [ ] Manual update warns of breaking changes and requires explicit approval; post-update tests verify real readiness and relevant protocols.
- [ ] Injected failure (package download/signature, full disk, unavailable database, broken migration, unexpected reboot and unsuccessful restart) causes either proven safe rollback or guarded recovery mode with clear instructions.
- [ ] Actual **restore from a blank test host** works using an encrypted backup and correct secret material; backup retentions and external device disconnects are tested.
- [ ] Secure owner-account recovery works when the UI and primary auth are unavailable; recovery cannot be activated by a remote unauthenticated user.
- [ ] Uninstall defaults to preserving data, and CLI repair/rollback procedures remain available for recovery.
- [ ] CI integration and repeatable isolated VM tests enforce installer/update regression coverage; release notes identify known limitations.
- [ ] Owner explicitly approves installing on their own operational server **after** these criteria pass. Approval to code under [G0-IMPLEMENTATION-START.md](G0-IMPLEMENTATION-START.md) does not authorize installation.

## 5. Prioritization

- **NOW:** continue application development and isolated CI/local VM tests (no modification of the owner's production environment). Installer and update safety engineering are **P0 critical-path work**, not late optional polish.
- **NOT YET:** owner installing from the currently available `npm start` foundation preview; it is not an installer, has no login, database, devices or update path, and must not be presented as safe for production.
- **AFTER PASSING GATE:** publish official verified installation instruction and supported update/recovery guide, then seek a **separate** owner decision on a personal server installation. Do not automatically start deployment.

**Related decisions:** D-13, D-14, D-15, D-18, D-20, D-36, D-38, D-40, D-41, D-44 and D-45. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md), [DEPLOYMENT.md](DEPLOYMENT.md), [TEST-RELEASE.md](TEST-RELEASE.md), [G0-READINESS.md](G0-READINESS.md), [ROADMAP-BACKLOG.md](ROADMAP-BACKLOG.md).
