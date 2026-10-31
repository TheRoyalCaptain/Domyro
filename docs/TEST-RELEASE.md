# Domyro — Test, compatibility and release plan

**Planning baseline 1.0 · 2026-10-29**

## 1. Test pyramid and coverage

- Pure domain unit tests: state normalization, capability constraints, graph validator, schedules, idempotency, permission predicates.
- Adapter fixture tests: real anonymized Zigbee2MQTT message examples, MQTT edge cases, Matter node change events.
- Contract tests: API request/response, WebSocket snapshot+deltas, plugin SDK version boundaries.
- Integration tests: PostgreSQL transactions, outbox recovery, broker reconnect, Matter server restart and plugin sandbox.
- Browser E2E: onboarding, room control, scenes, simple and advanced automations, mobile navigation, PWA loss/reconnect.
- Hardware-in-loop: dedicated Zigbee2MQTT coordinator, battery sensor, lamp/plug, supported Matter Wi-Fi or Thread device with borderrouter; repeat against real hardware.
- Installation E2E: native **Ubuntu Server LTS amd64 AND arm64** on bare metal and VM, first-run per-service installer choices, Docker images on their supported architectures, compatible Umbrel version and clean disk restore. Debian is not a required officially supported native 1.0 target.

Coverage target: critical domain logic branches 90%+ and overall statement coverage 80%+ for stable core; coverage is a minimum indicator, never a substitute for behavioral tests.

## 2. Performance baseline

Benchmark device: Linux x86_64, 4 vCPU / 4 GiB RAM / SSD, 250 entities, 20 state events/second, 5 dashboards connected, 10 active automations.

Acceptance targets:
- command admitted p95 <250ms locally excluding physical driver/network time;
- MQTT event to subscribed UI p95 <1s;
- automation trigger to dispatch p95 <500ms locally excluding device actuation;
- interactive dashboard p95 <3s on defined mobile/desktop clients;
- continuous 24h load without crashes or unbounded heap growth.
- 1,000 entities, 50 events/s and more simultaneous clients become post-1.0 scaling stretch tests, not baseline guarantees.

Measure p50/p95/p99, CPU, heap, DB size, event backlogs, dropped frames and power consumption when practical. Publish exact hardware, software versions and test script before claiming results.

## 3. Device compatibility tests

At minimum:
- MQTT: retained, reconnect, duplicate, QoS variation, invalid JSON, oversized payload and unauthorized topics.
- Zigbee2MQTT: renamed device, sensor offline, battery vs mains semantics, join expiry, exposed feature schema updates, groups and command state-confirmation gap.
- Matter: initial pairing, multi-admin where hardware supports, commissioning failure, fabric persistence, service failure and IPv6/mDNS breakdown.
- UI: control disabled when unavailable, no fabricated state, keyboard navigation, Dutch/English and mobile viewport.
- Automation: repeat triggers, missed DST hours, duplicate incoming events, restart mid-delay, concurrency control, **per-automation skip/bounded catch-up/approval of missed events**, and unsafe non-idempotent action rejection.
- Security: guest cannot modify admin functions through API/WS, audit redaction, session expiry, CSRF and plugin isolation.
- Backup: correct DB snapshot, corrupted archive, wrong password, restore older schema, missing radio/fabric keys and **7 daily/4 weekly/12 monthly default retention across multiple independent destinations**.

## 4. Release process

Development -> alpha -> public beta -> release candidate -> stable. SemVer (MAJOR.MINOR.PATCH) for software; plugin SDK has its own version/compatibility range. API /api/v1 is maintained for the major compatibility window; schema migration compatibility clearly published.

Every release:
1. Review merged issues and changelog.
2. Run required CI, dependency and vulnerability checks.
3. Compile and sign OCI images and native packages; generate SBOM.
4. Run clean install, upgrade and restore regression checks.
5. Validate selected hardware protocol matrix.
6. Record known limitations and migration instructions.
7. Produce release artifacts and immutable digests.
8. Publish release notes in Dutch and English, with rollback guidance.
9. Monitor opt-in diagnostics and community reports.

Release candidate must remain unaltered except by new RC release tags; do not silently overwrite artifacts.

## 4A. Acceptance planning for D-22..D-39

The owner approved all selected capabilities in the full product roadmap but chose a **compact, highly reliable 1.0**. Apply these checks before release commitments:

- Dashboard: 1.0 must have responsive templates, true-state device control, accessible layout editing; later full DnD and custom widgets require validation/sandboxing.
- Scenes: test multi-device execution, current-state capture, scheduling and partial failure; condition-heavy scenes follow approved milestone.
- Automation: test graph validation, bounded loops, waits/restart, variables, trace and zero-actuation simulations; reusable subflows/live debugging receive a dedicated release gate.
- Plugins: automatically **check update metadata only**, with **manual download and separate confirmed manual installation** (D-44 and D-26). Test negative proof: no network asset download or deployment from a periodic check.
- Energy: **simple live/historical energy measurement charts are mandatory in 1.0** for supported devices, with correct physical units and missing/stale handling. Dynamic tariffs/solar/battery/EV optimization remain later. Camera live/recording/motion capabilities are **post-1.0**, not release claims.
- Notifications/presence: do not imply PWA push or GPS background tracking is guaranteed across mobile platforms.
- Diagnostics: tests cover redacted logs, access-controlled exports, resource pressure and storage alerts.
- Backup: daily/weekly/monthly scheduling, **default 7 daily/4 weekly/12 monthly snapshots**, multiple targets, independent results, retention and encrypted archive validation must not erase good backups after another target fails.
- Identity: TOTP and step-up are foundational; passkey QA covers recovery and compatible browsers before release.
- Languages: **full Dutch and English in 1.0**, **German (de-DE) only after the first stable release (D-50)**; no German 1.0 obligation or ambiguous launch milestone.
- Public Issues accept proposals only; protected main and official release approval remain owner-only.

Reference: [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md).

## 4B. Release gates fixed by D-40..D-52

1. Official native installation succeeds on **Ubuntu Server LTS amd64 and ARM64** with supported bare-metal/VM test environments. Test every selectable supporting-service path, including existing-service connection and skipped optional service.
2. All three local access options tested where supported: IP:port, mDNS host (including collisions/fallback), own domain/reverse proxy with WS/TLS/trusted headers.
3. One host may own multiple sites without access leakage; independent servers remain operable without linking; optional federation is not misrepresented as 1.0.
4. Plugin updater automatically checks only metadata, never downloads/installs assets without separate actions and no silent restart.
5. Default 7 daily/4 weekly/12 monthly backup rotation survives failed NAS/USB/FTP target, preserves a verified recovery point and reports errors.
6. Power-loss test distinguishes `skip`, bounded `catch_up` and `confirm_before_catch_up`, rejects blind non-idempotent replay and honors approval expiry.
7. Valid recovery code is single-use, expired/revoked code fails; trusted local physical/VM-console recovery succeeds under explicitly authorized host privileges; remote unauthenticated recovery cannot.
8. The 1.0 dashboard offers templates and simple edits; simple rules and safe basic flow editor share engine; simple energy graphs use real sensor data and correct units.
9. 1.0 ships NL/EN, **no functional camera claims and no Domyro-hosted relay**; German, cameras and optional managed remote access are later milestones.

Full requirements and tests: [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 4C. D-53: Owner-server installation is blocked until verified installer and upgrades

Release/owner deployment must not be recommended based solely on a running dev server. Gate is **not passed** until all measurable items in [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md) have passed: genuine one-command Ubuntu Server LTS amd64/arm64 bare-metal+VM install with per-service wizard; interrupted-install recovery; signed artifacts; manual update approval and zero automatic installs/restarts; upgrade across supported version pairs preserving accounts, data and integration keys; failure injection (disk full, corrupt signature, DB unavailable, killed process, network error, incompatible migrations) with proven safe rollback or recovery mode; encrypted backup, clean-machine restore and CLI fallback. After independent tests, the owner still must explicitly authorize their own server installation.

**An absolute guarantee that software can never break is not technically possible.** A release is blocked if tested supported upgrades have unresolved data-loss, unsafe rollback or no-recovery failures. A documented known issue is not an excuse to bypass this gate.

## 5. QA gates

**Alpha:** real end-to-end device control, no dangerous automatic retries, first auth and state reliability.  
**Beta:** all 1.0 protocol categories functioning with stated compatibility matrix, installation on three target families, PWA, automation editors, full backup/restore and basic RBAC.  
**Stable:** no known unmitigated critical/high security vulnerabilities, no open release-blocking data-loss issue, no unrecoverable upgrade pathway on supported installations, compatibility docs and review signoff.

Severity handling:
- S0: credential theft, unauthorized unlock, irrecoverable data loss — block release; publish mitigation as soon as available.
- S1: crashes, widespread incorrect device state, broken backup — block stable.
- S2: bounded failure with workaround — may release with documented known issue.
- S3: cosmetic/polish — backlog.

## 6. Support and maintenance

Supported: explicitly documented OS versions, CPU architectures and container/firmware ranges; compatibility outside this matrix is best-effort.

No remote service/customer SLA promised before staffing, monitoring and incident response exist. Maintainer issue templates, minimal reproduction instructions, log-redaction guide, security contact and bug triage procedure must be available before open beta.

## 7. Go/no-go checklist for version 1.0

- [ ] All **53 owner product decisions (D-01..D-53)** reflected in design and release phasing; D-53 requires a complete installer and recovery-safe update workflow **before owner-server deployment**.
- [ ] No hidden Home Assistant or proprietary-cloud runtime dependency.
- [ ] True live Zigbee2MQTT + MQTT + Matter tests passed.
- [ ] State/command truth, reconnect and idempotency correct.
- [ ] Resident+admin UX and both automation editors tested.
- [ ] Docker, native Linux and Umbrel installs upgraded and restored through explicit owner-initiated installation, never through automatic download; verify native timer cannot invoke package installs or restarts.
- [ ] Auto-check off sends no scheduled release requests; download delay (12h/24h/72h/7d/custom) stages only; invalid signatures/low disk/offline/critical security release never trigger silent install; Umbrel App Store remains authoritative. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).
- [ ] PWA accessible; **Dutch and English 1.0** fully reviewed, German scheduled **after 1.0** (D-50).
- [ ] Security, plugin isolation, privacy and backup gates passed, including **manual confirmation of every plugin installation**, TOTP/step-up/session controls, and integrity checks of multi-destination backups.
- [ ] Original Domyro source licensed under AGPL-3.0-only, all third-party licenses compatible/noticed, image signatures and SBOM published.
- [ ] Reproducible benchmark/test results and known limits published.
- [ ] Official release authorization recorded specifically from @TheRoyalCaptain; no other account or bot may approve an official Domyro release.
