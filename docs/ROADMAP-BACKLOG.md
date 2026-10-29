# Domyro — Delivery roadmap and executable backlog

**Planning baseline v1.0 · planning only, no application code**

## 1. Planning method

This backlog is organized by dependency and demonstrable outcomes, not by speculative calendar dates. Each task ID is intended to become a GitHub issue AFTER masterplan approval. Issue text will then contain objective, boundaries, owner, acceptance criteria, tests and dependencies.

Priorities: **P0** blocks supported 1.0; **P1** first later wave; **P2** future.  
Relative effort: **S** <=2 focused development days, **M** 3-7, **L** >7 or uncertain; these are early sizing categories, not delivery promises.  
Status: every task **planned/unstarted**.

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
- **DOM-005 P0 S:** Trademark/name clearance and GitHub official-upstream protection. Accept: risks documented, all CODEOWNERS paths covered by @TheRoyalCaptain, active `main` PR/codeowner ruleset verified with a test PR; no unauthorized bypass actor.
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
- **DOM-072 P0 L:** Native Debian/Ubuntu packaging, systemd, upgrade/uninstall path. Accept: service works with no Docker dependency.
- **DOM-073 P0 L:** Umbrel app-store package and browser-based setup. Accept: install/update/restore without Portainer or SSH.
- **DOM-074 P0 M:** Integration-specific network/USB/mDNS preflight and docs. Accept: actionable error rather than silent failure.
- **DOM-075 P0 M:** Backups, integrity validation and restore wizard. Accept: clean restore on each supported platform.
- **DOM-076 P0 M:** Release-channel/update checker, preflight and rollback procedure. Accept: failed migration does not corrupt production.
- **DOM-077 P0 S:** Multiarch compatibility matrix, platform version pinning and support policy. Accept: published pass/fail data.

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

## 4. GitHub issue template (used only after G0)

Title: DOM-### [epic] measurable outcome.  
Body: problem, user value, non-goals, dependencies, design link, tasks, exact acceptance tests, security/privacy impact, supported environments, estimated complexity and rollback plan.  
Labels: type/feature, type/bug, type/docs, area/core, area/ui, area/integrations, area/security, priority/P0..P2, status/blocked, needs/design.  
Milestones: M0 through M7.  
Work: branch -> PR -> review -> tests -> changelog/doc updates -> squash merge. Main is protected. Use required CI checks and no direct pushes once established.

## 5. Definition of ready (DoR)

Scope small enough, dependency known, reference design and API contract linked, acceptance criteria measurable, test environment identified, adverse safety effects documented, no unresolved licensing issue.

## 6. Definition of done (DoD)

Code and tests, security/permission checks, error handling, usability/accessibility considerations, migration/backwards compatibility, docs and Dutch/English strings, observability, reproducible build, reviewed PR, CI green and acceptance demonstrated on supported hardware when relevant.

## 7. Key deliverables by gate

- G0: project plan + decisions signed, branch protection and owner-only approvals validated; **no code until then**.
- G1: trustworthy scaffold, local auth, DB, one frontend view, tests.
- G2: real Zigbee2MQTT and generic MQTT flows with observable truth.
- G3: independent Matter devices commissioned and controlled.
- G4: scenes/automations, resident dashboards, system ops.
- G5: Docker+Linux+Umbrel verified, backups+security+accessibility, public 1.0.

No target dates are promised before the scope is sized by actual prototype/hardware work. M2 is the first objective proof that Domyro is a smart-home platform rather than a static UI.
