# Domyro — Planning sign-off and readiness register

**G0-REGISTER · 2026-10-30 · Status: NOT APPROVED FOR DEVELOPMENT**

This checklist is the source of truth for whether Domyro may begin implementing application code. Having an extensive plan does not imply all design decisions are approved.

## 1. What the project owner already decided

- [x] Build a serious public independent Home Assistant alternative.
- [x] GNU AGPL-3.0-only is the project source license; lawful community forks allowed.
- [x] Official upstream merges/releases require exclusive approval by @TheRoyalCaptain.
- [x] Docker and Umbrel are packaging targets; **native Ubuntu Server LTS on amd64+arm64** is the required native 1.0 platform (bare metal/VM). Debian is not a 1.0 native support promise.
- [x] Modern resident UI plus advanced admin features.
- [x] MQTT, Zigbee2MQTT and Matter are initial protocol priorities.
- [x] One automation execution engine with simple and advanced editors.
- [x] PWA first, native mobile later.
- [x] Local-first, optional easy remote product later.
- [x] Curated catalog with optional plugin sideloading.
- [x] Transitional Home Assistant bridge and later migration tools.
- [x] AI/voice after the reliable first release.
- [x] First measurable success is actual physical device control.
- [x] No executable application code before project-wide plan sign-off.
- [x] **D-13:** Users control Domyro release checking/downloading and an optional download delay; installation is ALWAYS manually approved, never automatically scheduled. No Domyro control of Linux/umbrelOS system updates.
- [x] **D-14..D-21:** Ubuntu Server ISO native bare metal/VM; native UI-managed dependent services + container external services; Matter readiness without local test hardware; reliability/performance-led tech evaluation; secure one-command installer; multisite granular RBAC; local/SMB/NAS/FTP/USB backups; extensive specifications before implementation. See [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md).
- [x] **D-22..D-39:** owner-approved cumulative dashboard, building, scene, advanced automation, plugin confirmation, energy, camera, notification, German, diagnostics, presence, local voice, protocol, top-three differentiation, compact v1, security, backup and GitHub Ideas choices. See [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md).
- [x] **D-40..D-52:** Ubuntu LTS x86-64+ARM64; choose per supporting service; local multi-sites and optional future server linking; IP:port+mDNS+custom domain; plugin checks-only; backup default 7/4/12; per-flow missed-run options; recovery codes + local console; 1.0 simple dashboard and visual automation editing, NL/EN, simple energy charts; cameras/German/Domyro relay later. See [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 2. Proposed technical ADRs still needing an explicit yes/no

| ADR | Recommended choice | Alternative and consequence | Owner status |
|---|---|---|---|
| A-02 | TypeScript/Node.js modular monolith + React | Python backend increases ready-made automation ecosystem but splits stack | Proposed |
| A-03 | PostgreSQL in production | SQLite is simpler but changes durability/concurrency assumptions | Proposed |
| A-04 | REST v1 + authenticated WebSocket | GraphQL adds complexity; pure WS is harder for external clients | Proposed |
| A-05 | Zigbee2MQTT first | Direct Zigbee increases coordinator scope and can disrupt mesh | Proposed |
| A-06 | OHF Matter.js Server as independent adapter | Own controller stack has large maintenance/security cost | Proposed |
| A-07 | One typed, revisioned automation graph | Separate engines cause incompatible behavior | Proposed |
| A-08 | Isolated executable plugins | Plugin-in-process is simpler but high-risk | Proposed |
| A-09 | Future optional audited remote relay | VPN/reverse proxy only requires less infrastructure | Proposed |
| A-10 | Real native **Ubuntu Server LTS amd64+arm64** + Docker + Umbrel | Native Ubuntu must work bare metal+VM; Debian may be evaluated later | Proposed implementation details, target platforms accepted D-40 |

**Do not infer approval solely from no objection or general messages such as “oké.”** Record a later explicit decision and the date in `docs/DECISIONS.md`.

## 3. Practical prerequisites (must resolve before G0)

- [ ] Confirm lab hardware/VM and exact Ubuntu Server LTS versions on **both x86-64 and ARM64**; native 1.0 must validate both, while Debian native production support is NOT a selected 1.0 requirement.
- [ ] Identify exact harmless Zigbee lamp/plug and a sensor; never publish credentials/device IDs.
- [ ] Identify a genuinely available Matter Wi-Fi/Thread test device and network preflight strategy; a separate hardware purchase is not automatically authorized.
- [ ] Determine first managed services (native Mosquitto, Zigbee2MQTT, Matter.js, DB) and service administration permission model; preserve external broker/service mode and no ownership changes without explicit consent.
- [ ] Compare candidate runtimes, language and database choices with explicit reliability/performance/maintainability scorecard; choose a stack, query builder/migration tool and supported versions with evidence.
- [ ] Review third-party AGPL/GPL/other dependency license obligations; confirm separate plugin licensing policy.
- [ ] Review safety and privacy threat model, multi-site permissions and retention settings.
- [ ] Validate encrypted backups against local paths, USB disks, SMB/NAS and secure FTP variants; decide plaintext FTP restrictions and managed-dependency update confirmation policy.
- [ ] Approve verified one-command native installer (preflight, prompts, reversible failures, narrow service management helper).
- [ ] Confirm supported Ubuntu Server LTS release numbers and representative ARM64 hardware, Docker image architectures and umbrelOS version; **no implied official Debian support**.
- [ ] Select secure, nonprivileged native release-check/download timer and separately authorized manual install helper; validate Umbrel App Store limitations without making false download/upgrade promises. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).
- [ ] Verify brand clearance for Domyro before public trademark/promotional launch.
- [ ] Activate **main** branch protection and code-owner review in GitHub; confirm only owner can approve upstream merges.
- [ ] Confirm project owner review and release responsibilities, and what external help may do without approval.
- [x] **D-48..D-52 first-release boundaries accepted:** simple dashboard edits and basic visual editor in 1.0; German, cameras and Domyro relay after 1.0; simple energy charts in 1.0.
- [ ] Confirm passkeys rollout/version, precise safe-basic visual node set and required 1.0 energy-meter units/widgets, while retaining remaining owner-approved future features.
- [x] **Plugin policy resolved D-44:** automatic version checks, but manual downloading and a separate explicit manual install approval. Test that no plug-in asset is downloaded by automatic checks.
- [ ] Specify future camera retention/privacy, GPS data and phone background permissions, advanced energy tariff/EV safety, speech computing requirements, 2D plan editor and backup verification depth.
- [ ] Select the trustworthy console recovery mechanism and recovery-code lifecycle, define missed-trigger catch-up windows and explicit approval queue policy.
- [ ] Specify mDNS collision/fallback, reverse-proxy trusted-header security, default LAN port and future multi-server trust protocol (implementation after 1.0).
- [ ] Approve 7 daily/4 weekly/12 monthly backup retention semantics, independently per destination, and tests for safe pruning after failed jobs.

## 4. Owner GitHub branch protection: blocked by connector permissions

Current status: `.github/CODEOWNERS` exists with `* @TheRoyalCaptain`, but GitHub ruleset listing was empty when checked and current connector cannot modify protections.

Required:
- active ruleset targeting `main`;
- PR requirement, 1 approval, required code-owner review, stale-approval dismissal and no untrusted bypass;
- prevent force pushes and deletion;
- test a non-owner PR cannot merge without owner authorization;
- handle owner's self-authored PR using narrowly constrained owner-only admin route (GitHub does not count self-review).

This setup must remain **open**, not falsely marked complete. No new GitHub action/branch protection settings should be claimed active until verified by a readable repository ruleset.

Instructions: [GITHUB-GOVERNANCE.md](GITHUB-GOVERNANCE.md).

## 5. Security and dependency proof

- [ ] Determine licensing of all copied code, transitive dependencies and protocol servers.
- [ ] Verify AGPL-3.0-only source distribution headers/NOTICE policy and contributor guidelines.
- [ ] Select private vulnerability disclosure route and secure release signing infrastructure.
- [ ] Approve encrypted backup and recovery key storage, especially for Matter fabric.
- [ ] Test role and scope enforcement at API and WebSocket boundaries.
- [ ] Design plugin host permissions and sandbox limits per deployment platform.
- [ ] No requirement to use Domyro remote relay to operate home while offline.

## 6. Implementation milestones after sign-off

M1 foundation → M2 Zigbee2MQTT/MQTT real hardware → M3 independent Matter integration → M4 UX/automation → M5 three-platform install and recovery → M6 public beta/stable gates. Each stage needs its own acceptance checklist and review.

**First functional proof:** authenticated control of an actual safe device with correct command acknowledgment, independent hardware-state observation, live PWA update, persistence over restarts and a reliable sensor reading, without depending on Home Assistant as runtime controller.

## 7. Formal sign-off record template (not filled)

- Date:
- Approved by: @TheRoyalCaptain
- Approved revision/commit:
- ADR status: A-01 already approved; remaining A-02..A-10 explicit decisions:
- License/dependency check completed:
- Hardware pilot equipment confirmed:
- GitHub branch protection independently verified:
- Risk exceptions accepted:
- Permission to begin executable development: **Yes/No**

**Current answer: No.** Product planning continues; no source code, install scripts, container images or deploy actions yet.

## 8. Specification index

- [MASTERPLAN.md](MASTERPLAN.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATABASE.md](DATABASE.md)
- [API-CONTRACT.md](API-CONTRACT.md)
- [AUTOMATION-ENGINE.md](AUTOMATION-ENGINE.md)
- [PRODUCT-UX.md](PRODUCT-UX.md)
- [INTEGRATIONS.md](INTEGRATIONS.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [HARDWARE-PILOT.md](HARDWARE-PILOT.md)
- [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md)
- [GITHUB-GOVERNANCE.md](GITHUB-GOVERNANCE.md)
- [TEST-RELEASE.md](TEST-RELEASE.md)
- [ROADMAP-BACKLOG.md](ROADMAP-BACKLOG.md)
- [DECISIONS.md](DECISIONS.md)
- [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md)
- [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md)
- [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md)
