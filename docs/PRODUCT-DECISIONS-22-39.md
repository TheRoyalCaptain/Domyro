# Domyro — Confirmed product decisions D-22 through D-39

**Document ID:** PRODUCT-DECISIONS-22-39  
**Date:** 2026-10-30  
**Status:** Owner-approved feature requirements. Exact engineering and milestone allocation is a proposed plan until overall G0 sign-off.  
**Implementation:** Not authorized. No application code is included.

## How to read this document

Each numbered decision is the exact set of features chosen by the owner. **Every checked option within a question is additive**: it must be designed for support, not treated as competing alternatives.

- **Confirmed:** requested features and constraints.
- **Recommended phase:** our proposed implementation sequence based on D-36, not approval to drop features.
- **Acceptance:** intended observable behavior, to be finalized with architecture/hardware testing.
- **Not selected:** remains undecided, not forbidden. Do not infer interest or approval from a non-selection.

D-36 has precedence for release scope: the owner explicitly selected **a compact, very reliable Domyro 1.0**. The comprehensive product vision is larger than the 1.0 release; desired advanced capabilities are scheduled after 1.0 unless essential to the stable base. Foundation contracts must allow later additions without breaking identity, authorization and persistence.

## D-22 — Dashboard functionality

**Approved together:** ready-made dashboard templates; complete drag-and-drop editor; custom widgets created/added by users; separate tablet/wall-panel mode.

**Suggested delivery:**
- 1.0: templates for standard household and room overview, responsive card layout with simple editor, persistent layouts, real device states, accessible edit alternative.
- After 1.0: full drag-and-drop editor with resize/reorder/grid snapping, import/export of user-authored widget definitions, safe widget extension API and wall/tablet kiosk profiles.
- Product design for the full editor and tablet mode is required before implementation even if shipped later.

**Acceptance:**
1. Template instantiation uses actual site/room/device capabilities and never generates fake controls.
2. Editing a dashboard persists across devices and restart; dragging/resizing never silently loses elements.
3. Custom widgets are validated by capability/permission and may not bypass API authorization or execute privileged browser code.
4. Tablet mode handles touch, fullscreen, optional screen wake policy (subject to OS permissions), security, unauthorized logout and reconnect.

**Open:** widget authoring model (declarative vs sandboxed code), third-party widget permission model, first release date for full drag-and-drop.

## D-23 — Areas and buildings

**Approved together:** floors and room groups; interactive **2D floorplans**.

**Suggested delivery:** 1.0 floors, rooms, groups and site hierarchy; post-1.0 interactive 2D plan editor/renderer, room/device markers, safe control and responsive zoom.

**Acceptance:** a device can move between floors/rooms/groups without losing history or entity identity. Floorplan points use entity IDs, respect user permissions, show true availability and support an accessible non-visual alternative.

**Not selected:** 3D house display; multi-building maps within a single location. These are not requirements.

## D-24 — Scenes

**Approved together:** control multiple devices; scheduled execution; conditions/exceptions; snapshot scene from current device states.

**Suggested delivery:** 1.0 multi-device scene, current-state capture, partial failure reporting and schedule via shared automation engine. Complex conditional scenes may arrive in an early 1.x release if necessary to preserve 1.0 reliability. Scene definitions and execution are versioned from day one.

**Acceptance:** only readable state values become snapshot actions; unavailable/read-only capabilities are shown as unsupported and not silently included. Scheduling is timezone/DST-safe. Conditions use the same typed evaluator as automations. Partial success is never represented as all-success.

**Open:** scene conflict and priority behavior with active automations.

## D-25 — Advanced automation editor

**Approved together:** variables, calculations, complex conditions; branches, loops, waits; reusable scripts/subflows; live tests, simulation and debugging.

**Suggested delivery:** 1.0 stable typed graph, basic branch, delay, bounded repeat, local variables, trace/simulation and a useful graphical editor; post-1.0 reusable subflows, advanced calculations/expressions and live step-through debugging when safe. Shared runtime across simple and advanced editors remains mandatory.

**Acceptance:** deterministic validation with type/unit checks, bounded loops, no arbitrary script execution, no physical effects in dry-run, resumable safe waits, immutable revision for running jobs, audited permissions and explicit unknown/unavailable branches.

**Open:** exact expression language and what “live test” may change on real devices; default dry-run must not actuate devices.

## D-26 — Plugin installation policy

**Approved:** every plugin installation requires **manual confirmation** by the authorized administrator.

This applies whether the package comes from a curated catalog, a bundled source that requires separate installation, or side-loaded files. Show publisher, source, signature/reputation when available, version, required privileges and compatibility before confirmation.

**Suggested delivery:** 1.0 installation safety/permission model and built-in adapters; full public catalog and sideload experience after 1.0. Do not automatically install optional plugins or silently grant expanded permissions.

**Clarified by later D-44:** installed plugins may be **automatically checked for available updates**, but **both download and installation are manual**. Per-plugin permissions UI depth and custom upload beyond previously approved D-09 remain separate design decisions. D-09 separately confirms that a curated catalog and sideloading are part of the long-term product vision; D-26 only governs the **manual authorization of installation**, not whether those distribution channels are permitted.

## D-27 — Energy management

**Approved together:** realtime electricity/gas/water measurements; cost calculations with dynamic tariffs; solar and home-battery management; smart EV charging.

**Suggested delivery:** 1.0 has a reliable numeric sensor/history capability suitable for energy entities; after 1.0 energy dashboards, unit-aware measurement/cost and tariff accounting; later solar, battery optimization and EV charging subject to device/inverter/car compatibility and safety testing.

**Acceptance:** explicit source measurement units, meter reset handling, sensor sampling and cost provenance; tariff schedules including taxes/network fees are configurable; computed cost is presented as an estimate when appropriate. EV charging honors minimum/maximum current, failsafe stop, circuit limits and explicit user limits; do not promise support for every charger or car.

**D-52 resolves first-release scope:** **simple energy sensor trend graphs ARE in 1.0**; cost/dynamic tariffs, solar, home battery and smart charging remain later. Still open: tariff jurisdictions and supported advanced hardware.

## D-28 — Cameras

**Approved together:** live feed in dashboard; recorded video browsing/storage; motion detection/notifications; ONVIF and RTSP.

**Suggested delivery:** plan camera entities and security scopes early; after 1.0 ONVIF discovery/RTSP live view, then recordings and playback, then detection/event alerts and retention policies as a dedicated module. Continuous transcoding and object recognition are substantial scope; not part of a compact 1.0 by default.

**Acceptance:** authenticated streams, camera privacy scope, playback authorizations, storage quota/retention, encrypted credentials, failure diagnostics, no accidental exposure to WAN. ONVIF and RTSP are different capabilities; not all cameras expose them.

**Open:** storage location and max recording age, recording trigger modes, codec/transcoding strategy, local-only video vs opt-in remote streaming.

## D-29 — Notifications

**Approved together:** phone push; email; outgoing webhooks/external services; severity levels, critical alerts and notification rules.

**Suggested delivery:** 1.0 in-app notifications + event journal + pluggable notification routing; email/webhooks early 1.x; phone push via supported PWA/native platform permission and delivery constraints; advanced critical-notification policies later after testing.

**Acceptance:** authenticated destinations and secrets, retry/dedup/backoff, per-user priorities, mute/schedule, rate-limit and audit. Critical does not mean guaranteed delivery; background push behavior differs by platform and permission.

**Open:** priority levels, retention, retry SLA, email configuration, choice of push transport and delivery guarantees.

## D-30 — Languages

**Approved:** German (**de-DE**) in addition to already-decided Dutch (**nl-NL**) and English (**en**).

**Superseded by binding D-50:** ship complete Dutch and English in the first stable **1.0**; German **only after 1.0**. Preserve translation-key architecture from day one. Do not imply German is required in the first stable release.

**Acceptance:** full setup and essential screens, errors, date/time/units and accessibility labels translated; languages are user configurable and independent of site timezone; automated missing-key checks.

**Not selected:** French and Spanish or community translation authoring as separate committed products.

## D-31 — System diagnostics

**Approved together:** live CPU/RAM/disk/network usage; per-device/per-integration logs; error reports and diagnostic exports; automatic warnings about faults and storage.

**Suggested delivery:** 1.0 host and service health, bounded structured logs, redacted export, storage alerts and operator-friendly problems list. Advanced time-series resource dashboards after 1.0.

**Acceptance:** clear distinction between host/container resource scopes; safe log retention, redaction and authorized access; actionable error classification; resource use and disk full alarms; diagnostic export does not contain passwords or fabric keys.

**Open:** sample periods, historical retention, warning thresholds, NAS/USB monitoring semantics.

## D-32 — Presence detection

**Approved together:** motion sensors and manual home/away state; GPS and mobile app; Bluetooth proximity; Wi-Fi/network presence.

**Suggested delivery:** 1.0 motion-derived state, explicit manual home/away toggle and basic occupancy automations; after 1.0 Wi-Fi/Bluetooth (with consent and supported discovery), GPS mobile/native companion with privacy controls and confidence/fusion models.

**Acceptance:** explicit user opt-in for location, device-specific consent, configurable grace periods and false-presence suppression, local aggregation and expiring presence signals; presence must not be treated as a guaranteed life-safety or access-control signal.

**Open:** multi-device location fusion policy, local vs remote GPS uploads, household users' independent consent, mobile background behavior and battery impact.

## D-33 — Voice assistant

**Approved:** a fully **local voice assistant** in the eventual Domyro ecosystem, without a mandatory cloud provider.

**Suggested delivery:** post-1.0; evaluate local wake word, speech-to-text, intent engine, text-to-speech and hardware performance; isolate audio capture and secrets. Support opt-in microphones.

**Acceptance:** basic commands and status questions work without internet, enforce current household permissions, no continuous cloud audio upload, explicit microphone indicators and deletion controls.

**Not selected:** cloud AI voice provider or branded assistant integrations as additional owner requirements.

## D-34 — Protocol independence

**Approved together:** continue supporting external services like Zigbee2MQTT; develop a built-in Zigbee controller; manage all supported protocols from one Domyro interface; make external services optional once internally implemented alternatives are stable.

**Suggested delivery:** 1.0 unified interface and external Zigbee2MQTT/MQTT/Matter adapters. Post-1.0 own Zigbee coordinator integration (review zigpy/alternatives) with staged migration tooling; legacy external adapters remain supported.

**Acceptance:** a Zigbee coordinator is controlled by **one coordinator software at a time**. Never launch direct Zigbee over the same USB coordinator while Zigbee2MQTT owns it. Migration uses explicit backup and consent; devices/entities retain or have mapped identities where safe; users can choose external or native service.

**Open:** which Zigbee stack/language/process boundary, support for direct USB hardware, transition/migration feature and any direct Matter controller alternative.

## D-35 — Exactly three intended differentiators

1. **Beautiful, fast, clearly organized dashboards.**
2. **More powerful automations.**
3. **More local and independent operation.**

These are the three selected competitive priorities, in the user's supplied order. Stability and reliability remain **mandatory quality criteria**, not a fourth differentiator. Installation usability, extensibility and integrations are supporting quality/workflow capabilities, not additional chosen top-three marketing differentiators.

## D-36 — Scope of Domyro 1.0

**Approved choice:** a **compact, highly reliable first release**, *not* a near-complete Home Assistant clone.

Proposed **minimum stable 1.0 scope** (G0 owner review still required):
- Native Ubuntu Server (VM and bare metal) secure installer, Docker, Umbrel packaging; tested support matrix.
- Local accounts, site/area/device/entity registries, basic access control, secure setup.
- MQTT + Zigbee2MQTT real device control and an independent Matter controller integration with simulator/contract tests **and real-device release validation** before claiming support.
- Simple usable dashboards/templates, room control, basic layout editing, pending/confirmed state; PWA.
- Basic scenes, schedules and automation graph with simple editor and safe advanced subset.
- PostgreSQL reliability, local and owner-requested backup targets, operational diagnostics, signed releases and manually approved application updates.
- No automatic installation of Domyro releases; no unapproved plugin installation.
- Basic localization and accessibility, documented limitations.

Longer-term features D-22–D-34 and D-37–D-39 are **not cancelled**. Their delivery may be phased after 1.0 unless a specific security prerequisite must be present before release. Owner sign-off will decide the final 1.0 minimal scope when dependencies are estimated.

## D-37 — Account security

**Approved together:** TOTP authenticator-based MFA; passkeys with supported device biometrics; step-up reauthentication for high-risk actions; view/revoke active sessions and logged-in devices.

**Suggested delivery:** strong password auth/session lifecycle, TOTP and session revocation 1.0, with passkeys as an early-following feature if full cross-platform browser reliability is not yet proven. Step-up access and high-risk scopes are a mandatory release safety requirement.

**Acceptance:** hardware/key and authenticator enrollment/recovery, MFA setup confirmation, anti-replay/rate limits, per-session revocation, session audit and passkey credential portability/recovery plan; OS biometrics are mediated by platform authenticators, Domyro never reads raw biometric templates.

**Open:** whether passkeys are mandatory for 1.0 or early 1.x, recovery-code requirements and role-specific MFA policy.

## D-38 — Automated backups

**Approved together:** flexible daily/weekly/monthly schedules; automatic deletion by retention policy; multiple simultaneous backup destinations; automated backup integrity checks.

**Suggested delivery:** 1.0 backup scheduler, versioned encrypted archives, local/USB/SMB/NAS/FTP targets (with safer FTPS/SFTP offered), configurable retention, per-target status and hash/manifest verification. Full periodic restore simulation and multihost replication after 1.0 if resource cost is excessive; a real clean restore must pass before 1.0.

**Acceptance:** schedule and retention defined per destination; independent per-target error (failed USB does not delete good NAS backup); verify archive signature/checksum/decryption safely; never erase other files on removable disks; alerts on missed jobs or low storage. Plain FTP requires user acknowledgement and pre-encrypted archive.

**Open:** default retention ages, same-backup fanout vs independent job scheduling, automatic verification type/depth, exact snapshot consistency guarantees and whether managed protocol-service config is included.

## D-39 — Community

**Approved:** anyone may **propose features through GitHub Issues**. Contributions/official merges remain solely @TheRoyalCaptain's decision, with AGPL-compliant forks permitted.

**Suggested delivery:** establish issue template and feature label after GitHub ruleset/owner control is ready and G0 planning is approved; do not auto-create implementation tickets without owner go-ahead.

**Not selected:** independently hosted forum, user-voting roadmap, community plugin-submission policy beyond the already confirmed D-09 integration ecosystem. Unchecked items are not bans.

## Scope comparison (proposal; not silently locked)

| Domain | Compact 1.0 | After 1.0 |
|---|---|---|
| Dashboard | Responsive templates, basic layout edit, trusted widgets | Full DnD, custom widget SDK, tablet/kiosk |
| Areas | Site, rooms, floors, room groups | Interactive 2D floorplans |
| Scenes | Multi-device + snapshot + schedule | Full conditional/exceptions UX |
| Automation | Deterministic graph, simple editor, bounded advanced subset, trace | Complex expression packs, reusable subflows, live step debugger |
| Plugins | Safe owner confirmation, built-in drivers | Full catalog/sideload UX and SDK |
| Energy | **Simple unit-aware energy graphs from supported live/history entities** (D-52) | Dynamic tariffs, solar/battery/EV charging |
| Cameras | Entity/security groundwork | ONVIF/RTSP, live streaming, recording, detection |
| Notifications | Local inbox and internal event routing | Push/email/webhook/priority rules |
| Language | NL+EN | **German de-DE after 1.0** (D-50); others by future decision |
| Diagnostics | Host health, errors, redacted logs/export, disk alerts | Advanced resource analytics |
| Presence | Motion + home/away | GPS, BLE, Wi-Fi and fusion |
| Voice | Interfaces not blocked by architecture | Fully local assistant |
| Zigbee | Zigbee2MQTT managed from one UI | Own direct controller optional |
| Accounts | TOTP, session control, step-up | Passkeys if not proven safe for 1.0 |
| Backup | Scheduling, retention, multi-target, validation | Broader restore verification/replication |
| Community | GitHub Issues ideas | Extras only on future explicit choice |

**The 1.0 column is an architectural recommendation, not a new owner decision.** Both the scope and technical approach need G0 sign-off.

## Open questions retained for future decisions

- **O-01 resolved by D-48:** 1.0 templates and simple edits; full drag-and-drop later. Exact simple edit widget capabilities still open.
- **O-02 resolved by D-49:** 1.0 simple rules + safe basic visual editor; rich subflows/debug later. Exact initial node set still open.
- **O-03 resolved by D-44:** metadata checks automatic; plugin downloading and installation manual. Safe upload/permission UI details remain open.
- **O-04 resolved by D-50:** German after stable 1.0; exact later minor version and translation QA effort still open.
- **O-05:** Camera storage, codec/transcoding, recording retention and per-camera privacy.
- **O-06:** Dynamic electricity pricing markets, supported power/solar/EV hardware and charging safety rules.
- **O-07:** Phone push implementation constraints for PWA vs future native application.
- **O-08:** Location permission model and presence sensor-fusion behavior.
- **O-09:** Exact local voice hardware/performance specification.
- **O-10:** Passkeys first stable vs 1.x; account recovery design.
- **O-11:** Multi-target backup retention, restore verification frequency, FTP/FTPS/SFTP security details.
- **O-12:** Community triage/issue template and formal external contribution acceptance policy.
- **O-13:** First supported direct Zigbee adapters and migration pathways.

Related: [MASTERPLAN.md](MASTERPLAN.md), [DECISIONS.md](DECISIONS.md), [PRODUCT-UX.md](PRODUCT-UX.md), [AUTOMATION-ENGINE.md](AUTOMATION-ENGINE.md), [INTEGRATIONS.md](INTEGRATIONS.md), [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md), [ROADMAP-BACKLOG.md](ROADMAP-BACKLOG.md).
