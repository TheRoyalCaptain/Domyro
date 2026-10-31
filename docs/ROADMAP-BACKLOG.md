# Domyro — Delivery roadmap and executable backlog

**Roadmap v1.1 · M1 foundation source development authorized on 2026-10-31, production/release gates open**

## 1. Planning method

This backlog is organized by dependency and demonstrable outcomes, not by speculative calendar dates. Each task ID is intended to become a GitHub issue AFTER masterplan approval. Issue text will then contain objective, boundaries, owner, acceptance criteria, tests and dependencies.

Priorities: **P0** blocks supported 1.0; **P1** first later wave; **P2** future.  
Relative effort: **S** <=2 focused development days, **M** 3-7, **L** >7 or uncertain; these are early sizing categories, not delivery promises.  
Status: **M1 foundation server/web/status/initial tests started**. Other engineering work remains planned; the first preview is intentionally not a full product.

## 2. Milestones and dependency map

M0 = product architecture and sign-off [blocks all source work].  
M1 = safe development foundation (identity, registry, API, DB, web).  
M2 = first live hardware vertical slice, true MQTT and Zigbee2MQTT.  
M3 = Matter working with supported real device on a configured IPv6 LAN.  
M4 = resident experience, scenes, rules and advanced editor.  
M5 = packaging on three platforms, operational reliability and security.  
M6 = public beta, compatibility review, real-world testing and 1.0 gates.  
M7 = ecosystem/remote/mobile/energy/AI expansion after 1.0.

Critical path: M0 -> M1 -> M2 -> M4 -> M5 -> M6; Matter M3 proceeds in parallel after M1 and gates M6. Native/Umbrel installation engineering begins early at M1 and must not become an end-of-project surprise.

## 3. Epics and tasks

### EPIC PL — Planning and governance

- **DOM-001 P0 S:** Review and approve this masterplan, product boundaries and version contract. Accept: signed decision record, no unresolved G0 blockers.
- **DOM-002 P0 S:** Produce and verify the architecture diagram, module boundaries, data lifecycle and network topology. Accept: no hidden Home Assistant dependency.
- **DOM-003 P0 M:** Audit dependencies against confirmed AGPL-3.0-only, including plugins and redistributed binaries. Accept: vetted compatibility list and third-party notices; choice of license itself is already final.
- **DOM-004 P0 S:** Establish tested hardware matrix and network diagram. Accept: at least real Zigbee2MQTT lamp/plug, sensor, broker and Matter Wi-Fi/Thread candidate identified.
- **DOM-005 P0 S:** Trademark/name clearance and GitHub governance risk review. Accept: CODEOWNERS still covers all files, owner-approved temporary **GOV-01 unprotected-main waiver** is documented, and privileged users/apps audited; activating rulesets is a later recommended hardening task **not a G0 blocker**.
- **DOM-006 P0 S:** Finalize API schema and data migration policy ADRs. Accept: reviewed resource and error envelopes.

### EPIC DEV — Development foundation

- **DOM-010 P0 M:** Initialize pnpm/TypeScript monorepo and quality conventions. Accept: reproducible clean build, test and lint on x86_64 + ARM64 candidates.
- **DOM-011 P0 M:** CI with lint, typecheck, unit tests, dependency audit and artifact storage. Accept: failed check blocks merging.
- **DOM-012 P0 M:** Core PostgreSQL schema/migration runner. Accept: clean install, upgrade and failed migration tests.
- **DOM-013 P0 M:** Initial setup wizard and local administrator provisioning. Accept: cannot operate uninitialized system or reuse bootstrap token.
- **DOM-014 P0 M:** Authentication, sessions, basic role/permission infrastructure. Accept: forbidden operations denied by server and WS.
- **DOM-015 P0 M:** REST v1 schemas, validation, errors and versioning. Accept: OpenAPI and contract tests generated.
- **DOM-016 P0 M:** WebSocket snapshot/delta/resync transport. Accept: ordered state after reconnect and missing event range.
- **DOM-017 P0 M:** Structured logs, trace IDs, health readiness and metrics. Accept: redacted logs and integration fault visibility.

### EPIC CORE — Devices, commands, history

- **DOM-020 P0 M:** Sites, floors, rooms, devices and entities registries. Accept: persistent stable identities after rename/reboot.
- **DOM-021 P0 M:** Capability catalog and supported feature validation. Accept: incompatible controls impossible via API.
- **DOM-022 P0 M:** State ingestion with quality/availability. Accept: stale/unknown vs known distinguished.
- **DOM-023 P0 L:** Command dispatcher, idempotency and observed-vs-requested ledger. Accept: no false confirmation and unsafe retry.
- **DOM-024 P0 M:** Transactional event outbox/automation event subscription. Accept: recovery after crash avoids silent lost critical events.
- **DOM-025 P0 M:** History, retention policy, numeric measurement storage. Accept: bounded queries and owner-managed retention.
- **DOM-026 P0 M:** Device discovery reconciliation, grouping and removal. Accept: physical device IDs not duplicated due to friendly-name change.

### EPIC MQTT — Real first hardware

- **DOM-030 P0 M:** Configurable TLS capable MQTT connection, broker health and resubscription. Accept: disconnect/restart handled.
- **DOM-031 P0 M:** Generic MQTT discovery/config and mapping UI. Accept: real or simulated switch read+write with validation.
- **DOM-032 P0 M:** Zigbee2MQTT discovery and exposes parser. Accept: lamp, plug, battery sensor mapped to correct capabilities.
- **DOM-033 P0 M:** Zigbee2MQTT command/acknowledgment and observations. Accept: physical device state confirmed independently.
- **DOM-034 P0 M:** Zigbee2MQTT timed pairing and lifecycle. Accept: permit_join ends and rename stable.
- **DOM-035 P0 S:** E2E hardware proof video/test report. Accept: real bulb+sensor, no HA needed, restart and reconnect pass.

### EPIC MAT — Matter controller

- **DOM-040 P0 M:** Standalone OHF Matter.js server lifecycle and storage. Accept: persistent fabric on restart.
- **DOM-041 P0 M:** Matter WebSocket adapter, node mapping, capability conversion. Accept: current state and actions visible in registry.
- **DOM-042 P0 L:** QR/manual commissioning, Multi-Admin, error/retry/cleanup UI. Accept: real supported device paired without partial leftovers.
- **DOM-043 P0 M:** IPv6/mDNS and Thread preflight diagnostics across install platforms. Accept: actionable messages for network failures.
- **DOM-044 P0 M:** Matter supported-device matrix and fault recovery. Accept: controlled light and one selected sensor device + service restart pass.
- **DOM-045 P0 M:** Fabric credentials backup/restore validation. Accept: supported tested restoration path with documented caveats.

### EPIC UX — Usability and dashboards

- **DOM-050 P0 M:** Tokens, themes, accessible UI component library and responsive shell. Accept: light/dark and keyboard paths.
- **DOM-051 P0 M:** Resident overview, rooms and favorites. Accept: live device controls with error/pending states.
- **DOM-052 P0 M:** Device detail, diagnostic information, filters and editing. Accept: permission-aware views.
- **DOM-053 P0 L:** Dashboard widget registry, edit/save layout, per-user defaults. Accept: responsive, validated capability-aware widgets.
- **DOM-054 P0 M:** Scenes creator, preview/run/partial outcome. Accept: scene failure visible per target.
- **DOM-055 P0 M:** Dutch and English extraction/localization, quality pass. Accept: core flows translated and no raw errors.
- **DOM-056 P0 M:** PWA installation and offline shell/reconnect semantics. Accept: no fake offline command execution.
- **DOM-057 P0 M:** WCAG AA accessibility review on core flows. Accept: tested with keyboard and screen reader.

### EPIC AUTO — Automation

- **DOM-060 P0 L:** Flow graph JSON schema, static validator, versioning. Accept: impossible/unsafe graphs rejected.
- **DOM-061 P0 L:** Trigger evaluator (state, thresholds, time, sun, event). Accept: boundary and DST tests.
- **DOM-062 P0 L:** Conditions, action engine, wait/timer persistence, concurrency modes. Accept: restart test and no unsafe repeats.
- **DOM-063 P0 M:** Plain language simple rule editor compiling into shared flow graph. Accept: round-trip deterministic.
- **DOM-064 P0 L:** Advanced visual node editor with accessible list alternative. Accept: edit/publish and validate real graphs.
- **DOM-065 P0 M:** Execution trace, debugging and simulation mode. Accept: determine why each automation executed or failed.
- **DOM-066 P0 M:** Recursion/rate guards and admin action scopes. Accept: device storm and privilege escalation tests fail safe.

### EPIC DEPLOY — Docker, native Linux, Umbrel

- **DOM-070 P0 M:** Reproducible multiarch OCI images with persistent data and health checks. Accept: documented cold install.
- **DOM-071 P0 M:** Docker Compose production-like stack and secure config template. Accept: local onboarding and backup work.
- **DOM-072 P0 L:** Native Ubuntu Server LTS (amd64+arm64) packaging, systemd, upgrade/uninstall path. Accept: bare-metal/VM native installs work without Docker on both architectures.
- **DOM-073 P0 L:** Umbrel app-store package and browser-based setup. Accept: install/update/restore without Portainer or SSH.
- **DOM-074 P0 M:** Integration-specific network/USB/mDNS preflight and docs. Accept: actionable error rather than silent failure.
- **DOM-075 P0 M:** Backups, integrity validation and restore wizard. Accept: clean restore on each supported platform.
- **DOM-076 P0 M:** Signed GitHub-release discovery with independent auto-check, optional auto-download and delay policy (0h/12h/24h/72h/7d/custom), safe staging, explicit owner-controlled install, preflight and rollback. Accept: no release is ever automatically installed or causes a restart; all compatibility and failed-migration cases preserve production. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).
- **DOM-078 P0 M:** Native Ubuntu LTS download-only systemd timer on amd64+arm64 with restricted staging. Accept: signed artifact download at delay eligibility; zero automatic dpkg/apt installation and zero automatic service restart.
- **DOM-079 P0 M:** Docker/umbrelOS-specific update UX and capability detection. Accept: Docker pull-only never recreates containers; Umbrel update/install remains owned by App Store with unsupported staging controls hidden.
- **DOM-077 P0 S:** Multiarch compatibility matrix, platform version pinning and support policy. Accept: published pass/fail data.
- **DOM-107 P0 L:** Verified single-command Ubuntu Server ISO installation on bare metal and VM. Accept: clean install with dependency preflight, secure prompts, rollback and browser onboarding, no Docker requirement.
- **DOM-108 P0 L:** Native Ubuntu UI service manager (PostgreSQL, Mosquitto, Zigbee2MQTT, Matter.js) with privileged allowlist, service ownership detection, health/logs and admin-confirmed installation/update/removal. Accept: existing services unaffected, no arbitrary root actions.
- **DOM-109 P0 L:** Encrypted local/USB/SMB/NAS/FTP+FTPS backup adapters and restore validation. Accept: correctly tested live and disconnected destinations, security warnings and restore success.
- **DOM-110 P0 M:** Matter-ready simulated test harness and hardware-compatibility gate. Accept: commissioning flow and contract tests without hardware; no unverified compatibility claims.
- **DOM-111 P0 M:** Evaluate runtime/database stack based on reliability, fault isolation, performance, security and maintainability. Accept: measurement-backed ADR for G0 before app implementation.

### EPIC SEC — Security, privacy, reliability

- **DOM-080 P0 M:** Formal threat model and rights matrix. Accept: mapped trust boundaries and abuse cases.
- **DOM-081 P0 M:** Auth/MFA, CSRF, trusted proxy hardening and secret storage. Accept: negative security tests pass.
- **DOM-082 P0 M:** Audit trail, log redaction and privacy retention UI. Accept: no password/token leaks.
- **DOM-083 P0 L:** Secure plugin runtime foundation and permissions model. Accept: plugin crash and forbidden access contained.
- **DOM-084 P0 M:** Dependency/SBOM/image signature and disclosure pipeline. Accept: integrity verified before release, and only @TheRoyalCaptain authorizes official release publication.
- **DOM-085 P0 L:** Soak, chaos/reconnect and backup/restore reliability suite. Accept: published reproducible test reports.

### EPIC ECO — Open ecosystem (P1)

- **DOM-090 P1 L:** Public integration SDK and API compat test suite.
- **DOM-091 P1 L:** Curated catalog listing, publisher verification and signing.
- **DOM-092 P1 M:** Sideload/permission reapproval/rollback UI.
- **DOM-093 P1 L:** Extended local vendor adapters and compatibility matrix.
- **DOM-094 P1 L:** Read-only Home Assistant bridge and phased migration tool.
- **DOM-095 P1 L:** Optional remote access relay architecture, key lifecycle and external audit.

### EPIC FUT — Future extensions (P2)

- **DOM-100 P2 L:** Native iOS and Android companion apps.
- **DOM-101 P2 L:** Domyro OS appliance image and update recovery.
- **DOM-102 P2 L:** Local speech and optional AI integrations.
- **DOM-103 P2 L:** Advanced energy, tariffs, solar, battery and EV charging.
- **DOM-104 P2 L:** ONVIF/media dashboards and camera workflows.
- **DOM-105 P2 L:** Direct Zigbee, Z-Wave/BLE/KNX and additional transport stacks.
- **DOM-106 P2 L:** Multi-site management and optional federated devices.

### EPIC PRODUCT — Owner-approved capabilities D-22 to D-39

These tasks are **planned issue definitions**, not live GitHub Issues and not authorization to code. **P0 means a core requirement or G0 scoping activity**, not necessarily the entire future feature set must ship in 1.0. All long-term capabilities remain in the owner-approved product vision.

- **DOM-112 P0 M:** Draft compact 1.0 release boundary for D-22..D-39, incorporating binding D-40..D-52 stage decisions; approve remaining technical stage gates. Accepted: every selected feature mapped to 1.0 or later without dropping requirements.
- **DOM-113 P1 L:** Full drag/drop dashboard, custom widget contracts and touch/wall-panel mode. Accepted: responsive and accessible editing, safe user widgets.
- **DOM-114 P1 L:** Interactive 2D floorplans bound to rooms/entity IDs. Accepted: no unauthorized device control or broken mappings.
- **DOM-115 P0 M:** Multi-device scene snapshot plus schedules; conditions built on automation engine. Accepted: partial failures, actual-state snapshot, timezone-safe schedules.
- **DOM-116 P1 L:** Advanced expression, subflows, graph live-debugger and non-actuating simulation. Accepted: bounded recursion, typed graph, permission-aware tracing.
- **DOM-117 P0 S:** Explicit admin approval for **every** plugin installation. Accepted: plugin installer cannot proceed unattended or omit permissions preview.
- **DOM-118 P2 L:** Energy analytics, dynamic tariffs, solar/home battery and safe EV charging. Accepted: correct units, tariff provenance and charging limits.
- **DOM-119 P2 L:** ONVIF/RTSP live video, recording, playback, motion events/alerts. Accepted: encrypted credentials, per-camera authorization and storage limits.
- **DOM-120 P1 L:** Push/email/webhook notification router, priority rules and retry handling. Accepted: opt-in destinations, deduplication, platform delivery caveats.
- **DOM-121 P0 M:** Dutch+English i18n foundation for 1.0 and locale architecture for future German translation. Accepted: fully reviewed NL/EN and no promise of de-DE before first stable 1.0; see DOM-140.
- **DOM-122 P0 M:** Live host/driver diagnostics, resource telemetry, redacted logs/export and storage alerts. Accepted: secrets never leak, site permissions enforced, fault notifications work.
- **DOM-123 P1 L:** Manual/motion, GPS/mobile, BLE and Wi-Fi presence adapters with consent and TTL. Accepted: explicit permission, no private cross-user location leak.
- **DOM-124 P2 L:** Fully local voice pipeline and intent routing. Accepted: offline voice for approved actions with auth/permissions.
- **DOM-125 P2 L:** Native Zigbee coordinator and explicit coexistence/migration mode. Accepted: no dual owner of same coordinator; external Zigbee2MQTT remains supported.
- **DOM-126 P0 S:** Establish measured top-three differentiators and UI/automation/local-first acceptance. Accepted: tracked UX speed, automation testability and offline operation.
- **DOM-127 P0 M:** TOTP, session management, risky-action reauthentication, passkeys planning. Accepted: role/session security and verified passkey rollout target.
- **DOM-128 P0 L:** Scheduled multi-destination encrypted backups, configurable retention and integrity checking. Accepted: independent target outcomes, repeatable restore, default **7 daily/4 weekly/12 monthly**, bounded deletion. See DOM-135.
- **DOM-129 P0 S:** Enable public GitHub feature requests through Issues with triage template. Accepted: owner-only merges, no public vulnerabilities.

### EPIC FINAL SCOPE — Binding decisions D-40 to D-52

These are **planned tasks**, not GitHub Issues or working software. The user has approved the **features and 1.0-vs-later phase decisions**, while implementation details remain G0 work.

- **DOM-130 P0 M:** Validate Ubuntu Server LTS native install on x86-64 and ARM64; bare metal and VM, signed package support. Acceptance: reproducible success and error handling on both architectures; version and ARM64 hardware matrix.
- **DOM-131 P0 M:** One-command installer: per supporting service choose managed install, existing connection or defer. Acceptance: independently confirmed choices for PostgreSQL/MQTT/Zigbee2MQTT/Matter without overwriting services.
- **DOM-132 P0 M:** Local discovery/access: IP:port, conflict-aware mDNS domain, secure custom domain/reverse proxy. Acceptance: multicast fallback, trusted proxy, Host/Origin/WS and TLS checks.
- **DOM-133 P1 L:** Design optional secure federation/pairing for independent Domyro servers. Acceptance: stand-alone operation, mutual consent, site scopes, encrypted connectivity and revocation.
- **DOM-134 P0 M:** Plugin catalog automatic version checks with manual download and manual installation. Acceptance: no asset download or binary change during background checks.
- **DOM-135 P0 M:** Implement 7 daily/4 weekly/12 monthly default backup retention policy. Acceptance: multi-destination safe pruning, verified restore points, no deletion after target failure.
- **DOM-136 P0 M:** Per-automation missed scheduled event action: skip, bounded catch-up or approve. Acceptance: outage/DST tests, missed-run audit, no dangerous automatic replay.
- **DOM-137 P0 M:** Single-use recovery codes plus secure local physical/VM-console recovery. Acceptance: code one-time, no remote backdoor, session revocation/audit.
- **DOM-138 P0 M:** Ship 1.0 dashboard templates with simple persisted editing only. Acceptance: accessible add/remove/reorder and correct live states; advanced DnD later.
- **DOM-139 P0 M:** Ship 1.0 simple rules and safe basic visual automation editor. Acceptance: one engine, bounded graph, no unapproved side effects.
- **DOM-140 P1 M:** Complete full German de-DE localization after first stable 1.0. Acceptance: NL/EN 1.0 stays complete; de-DE QA passes in later release.
- **DOM-141 P1 L:** Design and implement optional first-party remote access after 1.0. Acceptance: VPN/reverse proxy 1.0 docs; later service opt-in, independently audited, no cloud requirement.
- **DOM-142 P0 M:** Basic energy measurement graphs from actual supported entities in 1.0; cameras post-1.0. Acceptance: real unit-aware time series, stale state, no camera implementation claim in 1.0.

**Milestone discipline:** D-36 mandates a compact, reliable 1.0; no untested video recording, direct Zigbee replacement, EV charging or local voice engine may be slipped into 1.0 to inflate feature count. Phasing proposals: [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md). Before issue creation, update task dependencies and estimates once exact 1.0 scope is owner-approved.

### EPIC INSTALL/UPDATE QUALITY — Owner-hard deployment gate D-53

- **DOM-143 P0 L:** Deliver fully verified **one-command** Ubuntu Server LTS amd64+arm64 installer plus safe owner-approved core upgrades, compatible migrations, encrypted backup/restore, post-upgrade health and fail-safe rollback/recovery. **Progress:** Ubuntu read-only preflight, signed developer source-bundle builder, isolated test-directory staging/pointer rollback, encrypted **synthetic** snapshots, service/retention planners and closed D-53 installation gate are tested on hosted amd64+arm64. **No complete installer, PostgreSQL recovery, safe live updater, real-device tests or owner deployment**. **Accept:** all D-53 tests, including interrupted install/update, mismatched versions, missing services, disk-full, bad signatures and clean-host restore pass on isolated bare-metal/VM test hosts. **Hard gate: never install on the owner's operational server until tested and separately authorized.** See [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md). This is a parent/acceptance gate for DOM-072, DOM-076, DOM-078, DOM-107 and related backup/security tasks, not duplicate code work.

**Current DOM-143 engineering increment:** Ubuntu LTS preliminary read-only host preflight, signed in-memory bundle stage, symlink switch and test-probe rollback simulation, negative tamper tests, amd64/arm64 CI matrix. **All real native installer/updater/database restoration work remains uncompleted.** See [SAFETY-FOUNDATION.md](SAFETY-FOUNDATION.md).

## 4. GitHub issue template (used only after G0)

Title: DOM-### [epic] measurable outcome.  
Body: problem, user value, non-goals, dependencies, design link, tasks, exact acceptance tests, security/privacy impact, supported environments, estimated complexity and rollback plan.  
Labels: type/feature, type/bug, type/docs, area/core, area/ui, area/integrations, area/security, priority/P0..P2, status/blocked, needs/design.  
Milestones: M0 through M7.  
Work (after explicit G0 sign-off): prefer feature branch -> PR -> owner review -> tests -> changelog/docs -> merge. **GOV-01:** GitHub review/ruleset is not currently enforced; the owner has elected to defer it. Direct writes remain technically possible for permitted users/apps, so use least privilege and audit activity. Add required CI checks and branch restrictions if/when the owner opts in.

## 5. Definition of ready (DoR)

Scope small enough, dependency known, reference design and API contract linked, acceptance criteria measurable, test environment identified, adverse safety effects documented, no unresolved licensing issue.

## 6. Definition of done (DoD)

Code and tests, security/permission checks, error handling, usability/accessibility considerations, migration/backwards compatibility, docs and Dutch/English strings, observability, reproducible build, reviewed PR, CI green and acceptance demonstrated on supported hardware when relevant.

## 7. Key deliverables by gate

- G0: project plan, architecture and owner decisions signed; **GOV-01 allows proceeding without branch rules** and records the residual risk; a separate explicit owner authorization is mandatory, **no code until then**.
- G1: trustworthy scaffold, local auth, DB, one frontend view, tests.
- G2: real Zigbee2MQTT and generic MQTT flows with observable truth.
- G3: independent Matter devices commissioned and controlled.
- G4: scenes/automations, resident dashboards, system ops.
- G5: Docker+Linux+Umbrel verified, backups+security+accessibility, public 1.0.

No target dates are promised before the scope is sized by actual prototype/hardware work. M2 is the first objective proof that Domyro is a smart-home platform rather than a static UI.

## 8. Detailed specifications for work items

- DOM-012/020–026 → [DATABASE.md](DATABASE.md): tables, indexes, migration and state integrity.
- DOM-014–017/022–024 → [API-CONTRACT.md](API-CONTRACT.md): authorized HTTP/WS behavior.
- DOM-060–066 → [AUTOMATION-ENGINE.md](AUTOMATION-ENGINE.md): deterministic graph, schedules, power-loss rules.
- DOM-070–079 → [DEPLOYMENT.md](DEPLOYMENT.md) and [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md): three platforms, networking, packages, manual-only installation and user-controlled downloads.
- DOM-030–045 → [HARDWARE-PILOT.md](HARDWARE-PILOT.md): non-disruptive hardware validation.
- DOM-001–006 → [G0-READINESS.md](G0-READINESS.md): actual approval and repository-branch protection gates.
- DOM-107–111 → [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md): Ubuntu Server ISO native/VM, managed services, backups, Matter readiness and evidence-based stack choice.

- DOM-112–129 → [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md): cumulative feature commitments, proposed release phasing, privacy and acceptance criteria.
- DOM-130–142 → [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md): finalized first-release scope, network, backup, recovery, plugin, multi-server and platform requirements.
- DOM-143 → [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md): **no owner-server install until one-command installer and safely upgradable/recoverable lifecycle are proven**.

**Important:** backlog tasks remain definitions, not GitHub Issues. **M1 foundation source work has begun** with owner authorization; no real hardware deployment or production release has occurred.
