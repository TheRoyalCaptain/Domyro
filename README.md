# Domyro

**Your home. Your rules.**

> **AI-DEVELOPED PROJECT · HUMAN-LED**
>
> **Domyro is built using AI, in close collaboration with and under the supervision of [@TheRoyalCaptain](https://github.com/TheRoyalCaptain).** @TheRoyalCaptain sets the requirements, directs development and holds final responsibility for official project decisions, review and releases. AI helps create code, designs, tests and documentation; its output is not assumed to be error-free or production-ready.
>
> [Read the full AI development disclosure](docs/AI-DEVELOPMENT.md).

Domyro is an open-source, local-first smart-home platform under active development. The repository includes an early executable **development-only foundation** and detailed specifications for the eventual full product.

> **Status: 0.1 development foundation.** @TheRoyalCaptain explicitly authorized M1 foundation coding on 31 October 2026. The preview has **experimental localhost login and PostgreSQL, but no production onboarding, real protocol integration or device control**. **D-53 hard gate:** the owner will **not install Domyro on their own server** until a verified complete one-command Ubuntu installer and tested **manual safe-upgrade + backup/recovery lifecycle** exist, followed by a separate owner deployment approval. See [D-53 installation gate](docs/INSTALL-UPGRADE-GATE.md).

**Latest verified CI milestone:** 134/134 tests on all four Ubuntu 24.04 Node 22/24 AMD64/ARM64 combinations. Offline signed catalog selection now rejects version rollback and same-version signed-manifest equivocation, while selecting the newest compatible SemVer release. Separate disposable AMD64/ARM64 CI boots a **verified signed development source tree with locked production dependencies through actual transient systemd**, then verifies manual restart and automatic crash recovery. These are **development tests, not permission to install**. A new fsynced **crash-intent journal** in the isolated pointer-switch prototype survives a SIGKILL test and blocks unsafe repeat activations; it does not automatically restore databases or authorize deployment. See [crash-intent evidence](docs/CRASH-INTENT-REHEARSAL.md), [signed catalog](docs/SIGNED-RELEASE-CATALOG.md), [signed-source systemd CI](docs/SIGNED-SOURCE-SYSTEMD-CI.md) and [download-only staging](docs/SIGNED-DOWNLOAD-REHEARSAL.md).

**Current installer progress:** Read-only Ubuntu preflight, signed **development source** bundles, isolated release pointer rollback, encrypted test fixtures and a strict [machine-readable owner-installation gate](config/installation-readiness.json) are tested. The M1 code also supports **PostgreSQL schema migrations, persistent sites/rooms and Argon2id-based loopback-only login with authenticated room management** in isolated development tests. M2 preparation now includes **an opt-in, read-only Zigbee2MQTT observer over real MQTT**, tested with a disposable broker, and an independent site-scoped PostgreSQL device/observation registry **plus explicit tested snapshot ingestion**; live device control remains disabled. **An encrypted PostgreSQL 17 backup and clean-test-database restore are now verified, including a new experimental bounded streaming v2 path. Experimental encrypted configuration fixture backup and a conservative local backup catalog now exist. A new private scratch-only configuration restore and independent file-hash audit are now tested alongside separate PostgreSQL scratch recovery. A local admin-only **Systeemupdates** overview, signed-release download-eligibility model and fail-closed native Ubuntu installation planner have also been added and tested. Source releases now contain the complete bounded runtime code tree and signed manifest DB schema version; a disposable signed-bundle localhost rehearsal boots the real HTTP server and checks assets, while refusing to call it production-ready. An additional sandboxed native-service rehearsal builds temporary Ubuntu-like paths, refuses unexpected unit/source changes, and tests a real separate Node child process across a stop/start cycle. The host's systemd and services are never touched. Reproducible locked npm dependencies are now installed inside disposable signed-release sandboxes on both architectures, and a real two-version child-process update with induced failure restores the old process. Ubuntu systemd-analyze checks the draft unit syntax without activating a service. No installation can be started from this preview. Production onboarding, full-system secrets/config restoration, one-command installer, live recovery and production-safe upgrades still do not exist. Do NOT install Domyro on your server.** [Read the detailed limitations](docs/SAFETY-FOUNDATION.md).

## Product commitments

- Independent automation and device platform: not a Home Assistant frontend.
- Fully functional local control without mandatory cloud subscription.
- Public free and open-source software under **GNU AGPL-3.0-only**. Forks are allowed, but **only @TheRoyalCaptain** approves changes and releases in official upstream. Dependency-license review remains a release gate.
- Installation targets from first supported release: Docker Compose, **native Ubuntu Server LTS x86-64 and ARM64 (bare metal or VM)**, and Umbrel. The verified one-command Ubuntu installer offers **per-service choices** to install/manage, connect to an existing dependency or defer optional dependencies. Debian is a future compatibility evaluation, not an official native 1.0 requirement.
- Initial protocol priorities: MQTT, Zigbee2MQTT and Matter.
- Progressive web app first, later native mobile apps.
- Domyro updates: optional automatic **checking and downloading** with user-controlled delay (12h/24h/72h/7d/custom), but **NEVER automatic installation or restart**. Underlying OS updates are out of scope.
- **1.0:** simple rules and safe basic visual automation editor. **After 1.0:** richer visual flows, scripts/subflows and debugging.
- Product direction: beautiful, fast dashboards; powerful automations; maximum practical local independence. **1.0** includes templates/simple dashboard editing and **basic energy measurement graphs**. Full drag/drop, camera features, German, optional Domyro remote access and local voice follow after the **compact, stable 1.0**.
- Optional future remote-access relay and curated + sideloadable integrations.
- Home Assistant bridge only for transition and subsequent migration assistance.
- AI and speech deliberately follow a reliable base.

## Run the development preview (isolated development computer ONLY)

**Do not run these commands on the owner's actual server or Home Assistant environment.** The user explicitly wants to defer any such installation until the complete one-command installer and safe update/recovery system have been independently validated.

Node.js 22.12+ is required. The starter preview requires no additional installed packages or database:

```bash
git clone https://github.com/TheRoyalCaptain/Domyro.git
cd Domyro
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm start
```

Then open `http://127.0.0.1:8844` **on the same computer**. The experimental local account screen is at `/login`, but is only usable with an explicitly initialized **isolated test database**. The development preview is **not safe to expose publicly**; production security and onboarding remain incomplete. See [DEV-START.md](docs/DEV-START.md) for limits and next steps.

## Documentation index

1. [Masterplan](docs/MASTERPLAN.md): scope, locked choices, versions, success metrics, non-goals.
2. [System architecture](docs/ARCHITECTURE.md): stack, data model, event lifecycle, interfaces and failure behavior.
3. [Product and user experience](docs/PRODUCT-UX.md): screens, flows, users, accessibility, dashboard editor.
4. [Protocols and integrations](docs/INTEGRATIONS.md): MQTT, Zigbee2MQTT, Matter, compatibility and plugin API.
5. [Security and operations](docs/SECURITY-OPERATIONS.md): threat model, authorization, remote access, updates, backups.
6. [Delivery roadmap and backlog](docs/ROADMAP-BACKLOG.md): phases, epics, concrete tasks and definition of done.
7. [Quality and release strategy](docs/TEST-RELEASE.md): validation, release gates, benchmarks, incidents.
8. [Decisions and sign-off](docs/DECISIONS.md): architecture decisions and approvals required before coding.
9. [Repository governance and owner-only approvals](docs/GITHUB-GOVERNANCE.md): licensing, CODEOWNERS, branch protection and explicit GitHub setup steps.
10. [Database contract](docs/DATABASE.md): schema, identities, state truth, history, retention and recovery.
11. [API contract](docs/API-CONTRACT.md): REST v1, WebSocket events, access policies, command confirmations and error handling.
12. [Automation engine specification](docs/AUTOMATION-ENGINE.md): triggers, graph validation, schedules, concurrency and safety.
13. [Deployment specification](docs/DEPLOYMENT.md): Docker, native Ubuntu LTS amd64/arm64 and Umbrel, persistence and networking.
14. [Hardware pilot](docs/HARDWARE-PILOT.md): safe non-disruptive Zigbee2MQTT/Matter testing on real devices.
15. [Approval and readiness register](docs/G0-READINESS.md): exact blockers and owner decisions before coding.
16. [Software-update policy](docs/SOFTWARE-UPDATES.md): download-only automation, manual installation, native Linux and Umbrel limitations.
17. [Ubuntu native services and backup targets](docs/PLATFORM-SERVICES-BACKUPS.md): one-command installer, managed services, Matter readiness, local/SMB/FTP/USB backups.
18. [Product decisions D-22–D-39](docs/PRODUCT-DECISIONS-22-39.md): approved full product capabilities and competitive priorities.
19. [Product decisions D-40–D-52](docs/PRODUCT-DECISIONS-40-52.md): native Ubuntu/ARM64, selectable services, local addressing, plugin updates, backups, automation recovery and final 1.0 feature cut.
20. [Run development foundation](docs/DEV-START.md): verified local preview and limitations.
21. [Owner's limited foundation start authorization](docs/G0-IMPLEMENTATION-START.md): implementation authorization and remaining gates.
22. [D-53 installer and upgrade safety gate](docs/INSTALL-UPGRADE-GATE.md): **no installation on owner equipment** before verified one-command install, manual upgrades and proven recovery.
23. [0.1 installer/update/backup safety foundation](docs/SAFETY-FOUNDATION.md): signed development artifacts, isolated version switching, encrypted test fixtures, dry-run planning and tested limitations.
24. [Machine-readable installation readiness gate](config/installation-readiness.json): fail-closed checklist; no owner deployment permission or real installation instructions yet.
25. [PostgreSQL and security foundation](docs/PERSISTENCE-FOUNDATION.md): transactional migrations, multi-site data boundaries and Argon2id sessions.
26. [Local authentication development preview](docs/LOCAL-AUTH-FOUNDATION.md): console-only initial owner, loopback login, HttpOnly cookies, CSRF, sites/rooms; **not production security**.
27. [Read-only Zigbee2MQTT MQTT preview](docs/MQTT-READONLY-FOUNDATION.md): real disposable-broker tests, IEEE-stable devices, cross-site PostgreSQL tests, **no real home control or production connectivity**.
28. [PostgreSQL 17 encrypted backup and empty-test-database restore](docs/POSTGRES-BACKUP-RESTORE.md): genuine pg_dump/pg_restore integration tests with failure injection; **not complete-home backup or safe production update**.
29. [Streaming encrypted PostgreSQL backup v2](docs/STREAMED-BACKUP-V2.md): real streaming pg_dump, authenticated private-file restore in an empty test database; **not production backup/restore**.
30. [Backupcatalogus en configuratieherstelvoorbereiding](docs/BACKUP-CATALOG-RECOVERY.md): immutable encrypted backup receipts, selected development config fixtures, fail-closed coverage checks; **no automated deletion or production restore**.
31. [AI development disclosure](docs/AI-DEVELOPMENT.md): clear AI-built project attribution, human direction, supervision and official maintainer responsibility of @TheRoyalCaptain.
32. [Private scratch-only configuration restore](docs/SCRATCH-CONFIG-RESTORE.md): authenticated test-fixture restoration, no overwrites, post-write integrity checks, rollback on ordinary failure; **not production recovery**.
33. [Installer en updatecentrum: nieuwe ontwikkelstap](docs/INSTALLER-UPDATE-CENTER-MILESTONE.md): signed releasebeleid, admin-only updateoverzicht en native Ubuntu-planner; **geen uitvoerende installer/updater**.
34. [Volledige bronbundel en geïsoleerde installatieproef](docs/NATIVE-INSTALL-REHEARSAL.md): ondertekende volledige ontwikkelbron, echte localhost-opstartproef en gesimuleerde storingen; **nog geen systeeminstallatie**.
35. [Native servicemap- en procesproef](docs/NATIVE-SERVICE-REHEARSAL.md): een afgeschermde Ubuntu-mappenstructuur, een niet-geactiveerde systemd-unit, een los Node-proces met herstartproef en nieuwe handtekening-/bestandscontroles; **nog geen systemd-installatie**.
36. [Vastgepinde afhankelijkheden en echte update-/rollbackproef](docs/NATIVE-DEPENDENCIES-AND-UPDATE-REHEARSAL.md): npm-lockfile en npm ci, native runtime-validatie, twee ondertekende versies met procesherstart, rollback en systemd-analyse; **D-53 gesloten**.
37. [Ondertekende download-only staging en echte systemd-crashherstelproef](docs/SIGNED-DOWNLOAD-REHEARSAL.md): strikt lokale HTTP-download met SHA-256, downloadvertraging, staging zonder activering en systemd-crashherstel op tijdelijke GitHub Ubuntu-machines; **geen productie-updater of installatie**.

**Current project gate:** **approved for M1 foundation source development only** by the owner on 31 October 2026, while final architecture, real hardware, deployment and public release acceptance remain incomplete. **GOV-01:** the owner chose to continue without branch protection for now, so other permitted accounts/apps could technically push directly.

### Licensing and contributions

The official license is [GNU AGPL version 3 only](LICENSE) (SPDX: `AGPL-3.0-only`). Others may inspect, fork, modify and redistribute under its terms. **Only @TheRoyalCaptain** has official contribution/release authority **by project policy**. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODEOWNERS](.github/CODEOWNERS). **GOV-01:** branch protection is consciously deferred; CODEOWNERS does not prevent a write-authorized account/app from pushing directly. Review privileges and commits until protections are enabled.

## Rules during development

M1 code, documentation and tests are now explicitly authorized. Do **not** provision the owner's server, publish production images, open WAN access, install smart-home services on existing hardware, migrate/reset Zigbee meshes or claim that device integrations work until separately tested and approved.

Reference material is recorded in the relevant documents. Trademark and name clearance, dependency license review and a first real hardware inventory remain explicit pre-release checkpoints.
