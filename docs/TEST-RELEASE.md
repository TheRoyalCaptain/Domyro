# Domyro — Test, compatibility and release plan

**Planning baseline 1.0 · 2026-10-29**

## 1. Test pyramid and coverage

- Pure domain unit tests: state normalization, capability constraints, graph validator, schedules, idempotency, permission predicates.
- Adapter fixture tests: real anonymized Zigbee2MQTT message examples, MQTT edge cases, Matter node change events.
- Contract tests: API request/response, WebSocket snapshot+deltas, plugin SDK version boundaries.
- Integration tests: PostgreSQL transactions, outbox recovery, broker reconnect, Matter server restart and plugin sandbox.
- Browser E2E: onboarding, room control, scenes, simple and advanced automations, mobile navigation, PWA loss/reconnect.
- Hardware-in-loop: dedicated Zigbee2MQTT coordinator, battery sensor, lamp/plug, supported Matter Wi-Fi or Thread device with borderrouter; repeat against real hardware.
- Installation E2E: Docker x86_64+ARM64, Debian/Ubuntu native x86_64+ARM64, Umbrel supported version and disk restore.

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
- Automation: repeat triggers, missed DST hours, duplicate incoming events, restart mid-delay, concurrency control and unsafe non-idempotent actions.
- Security: guest cannot modify admin functions through API/WS, audit redaction, session expiry, CSRF and plugin isolation.
- Backup: correct DB snapshot, corrupted archive, wrong password, restore older schema and missing radio/fabric key handling.

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

- [ ] All 12 owner decisions preserved in released design.
- [ ] No hidden Home Assistant or proprietary-cloud runtime dependency.
- [ ] True live Zigbee2MQTT + MQTT + Matter tests passed.
- [ ] State/command truth, reconnect and idempotency correct.
- [ ] Resident+admin UX and both automation editors tested.
- [ ] Docker, native Linux and Umbrel installs upgraded and restored through explicit owner-initiated installation, never through automatic download; verify native timer cannot invoke package installs or restarts.
- [ ] Auto-check off sends no scheduled release requests; download delay (12h/24h/72h/7d/custom) stages only; invalid signatures/low disk/offline/critical security release never trigger silent install; Umbrel App Store remains authoritative. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).
- [ ] PWA accessible; Dutch/English strings reviewed.
- [ ] Security, plugin isolation, privacy and backup gates passed.
- [ ] Original Domyro source licensed under AGPL-3.0-only, all third-party licenses compatible/noticed, image signatures and SBOM published.
- [ ] Reproducible benchmark/test results and known limits published.
- [ ] Official release authorization recorded specifically from @TheRoyalCaptain; no other account or bot may approve an official Domyro release.
