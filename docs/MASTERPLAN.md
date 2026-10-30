# Domyro — Product & Technical Masterplan

**Document version:** 1.0 planning baseline  
**Date:** 29 October 2026  
**State:** review-ready; implementation gated pending project-owner sign-off  
**Project:** TheRoyalCaptain/Domyro  
**Tagline:** Your home. Your rules.

## 1. Product definition

Domyro is an independent, publicly distributed, self-hosted, local-first home automation platform. It owns device identity, state, events, command dispatch, automations, scenes, accounts, dashboards, history and integration lifecycle. External protocol servers may be used as adapters but must not be mistaken for the Domyro core. Home Assistant may be used only as a voluntary bridge during transition.

### Audience

- Resident: quick and obvious everyday control.
- Advanced resident: templates, automations, energy and custom dashboards.
- Installer/admin: integration setup, diagnostics, firmware metadata, user permissions and backup.
- Developer: documented APIs, SDK, testing and community integrations.
- Maintainer: predictable release, observability and compatibility discipline.

### Differentiation

1. Browser-first installation with understandable errors and no YAML required for ordinary use.
2. Excellent responsive UX, accessible controls and transparent device state.
3. An automation engine with both simple rules and node-based advanced flows, sharing one execution model.
4. Reliable local-first behavior, explicit observability, recoverability and permission boundaries.
5. Open integration ecosystem with audited catalog distribution plus warned, permissioned sideloading.

## 2. Owner decisions (locked)

| ID | Decision |
|---|---|
| D-01 | Build a serious public alternative from inception. |
| D-02 | Domyro-owned code is licensed under GNU **AGPL-3.0-only**; forks/modifications are permitted under AGPL terms. Only @TheRoyalCaptain authorizes changes and releases of official upstream. |
| D-03 | First official installation targets: Docker, native Linux, Umbrel. |
| D-04 | Modern simple resident interface plus advanced admin views. |
| D-05 | Zigbee, MQTT, Matter are the first protocol families to support robustly. |
| D-06 | Both simple rules and advanced visual automation editor. |
| D-07 | Responsive PWA first, native iOS/Android later. |
| D-08 | Optional straightforward remote access is a planned feature, never mandatory. |
| D-09 | Curated integration catalog AND side-loading. |
| D-10 | Temporary Home Assistant bridge and later migration tools. |
| D-11 | AI and speech after the reliable baseline. |
| D-12 | First milestone: genuinely functioning hardware and control, not a mockup. |
| D-13 | Domyro application updates are **never installed or restarted automatically**. Users control automatic release checks/downloads and delay (0h/12h/24h/72h/7d/custom); installing every release remains an explicit manual action. Underlying operating-system updates are out of scope. |
| D-14 | A fully native Domyro installation runs on Ubuntu Server ISO installations on physical hardware **and** VMs, without Docker requirement. |
| D-15 | Native Ubuntu installations can install/configure/manage selected supporting services such as Mosquitto, Zigbee2MQTT, PostgreSQL and Matter.js from the admin UI; existing/external service connections remain available. Container installations use appropriately hosted brokers and services. |
| D-16 | Matter functionality must be engineered ready for onboarding despite no Matter test hardware currently available; publicly confirmed device compatibility requires separate real-hardware validation. |
| D-17 | Choose implementation language and stack based on **measured stability, reliability and speed**, not framework preference alone. |
| D-18 | Fresh supported Ubuntu Server setups install Domyro via **one verified entry command** that orchestrates safe full installation and onboarding with explicit confirmations. |
| D-19 | Multiple households/sites and granular user, room and entity/action permissions are required. |
| D-20 | Backup targets include local storage, SMB/NAS, FTP and removable USB drives; add secure FTPS/SFTP, encryption and plaintext-FTP warnings. |
| D-21 | Work out the most complete feasible specifications **before programming**; project G0 gate remains closed. |
| D-22 | Dashboard templates, full drag-and-drop, user-created widgets, tablet/wall-panel mode. |
| D-23 | Floors and room groups plus interactive 2D floorplans. |
| D-24 | Scenes: multiple devices, scheduling, conditions/exceptions and snapshots from actual states. |
| D-25 | Advanced automations: variables/calculations, branches/loops/waits, reusable scripts/subflows, live tests/simulation/debugging. |
| D-26 | Every plugin installation needs explicit manual administrator confirmation; plugin update checking/downloading still undecided. |
| D-27 | Electricity/gas/water, dynamic tariffs/costs, solar/batteries and smart EV charging. |
| D-28 | Camera live views, recordings/playback, motion alerts, ONVIF and RTSP. |
| D-29 | Phone push, email, webhooks and prioritized/critical notification rules. |
| D-30 | German de-DE alongside previously selected Dutch and English. |
| D-31 | Live CPU/RAM/disk/network metrics, device/integration logs, diagnostic export, proactive faults/storage alerts. |
| D-32 | Presence via motion/manual home-away, mobile GPS, Bluetooth and Wi-Fi/network. |
| D-33 | A fully local voice assistant in a later release. |
| D-34 | Continue Zigbee2MQTT compatibility, build native Zigbee, one unified protocol UI, optional external services once native alternatives are stable. |
| D-35 | Three key differentiators: beautiful/fast/clear dashboards; stronger automations; local independence. |
| D-36 | A compact, highly reliable 1.0 release; advanced features remain promised long-term but can ship later. |
| D-37 | TOTP, passkeys/biometrics where supported, step-up authorization and management of active sessions. |
| D-38 | Daily/weekly/monthly backup scheduling, retention cleanup, multiple targets, automated integrity checks. |
| D-39 | Public GitHub Issues for feature requests; @TheRoyalCaptain retains sole official merge/release authority. |

All D-22..D-39 choices are cumulative, approved **product requirements**. The proposed version split is separately documented in [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md); unchecked options are not silently accepted or forbidden.

## 3. Scope and version contracts

**Proof of hardware (0.1 / vertical slice):** one real Zigbee2MQTT device, a generic MQTT device and their entities, observed state, an acknowledged command, realtime UI, login, basic installation and event logging. Matter integration begins in parallel, but is not allowed to delay this earliest slice.

**Private alpha (0.3):** SQLite is not offered as a production alternative; PostgreSQL-backed system, setup wizard, resident dashboard, basic rules, device lifecycle, native Linux install candidate, Umbrel package candidate, real Matter commissioning in lab.

**Public beta (0.8):** robust end-to-end MQTT/Zigbee2MQTT/Matter, two automation editors, backup/restore, basic role-based permissions, PWA installability, logs and diagnostics, Dutch/English, reliable install targets, security review and compatibility matrix.

**1.0 stable:** the owner explicitly wants a **compact, very reliable** release. Prioritize tested MQTT/Zigbee2MQTT/Matter functionality, local-first dashboards/templates, essential scenes/automations and three installation targets; protect security, backups, user control over manually installed updates and data integrity. The full dashboard editor, energy optimization, cameras, native Zigbee controller and local voice assistant remain long-term requirements, but are not necessarily 1.0 blockers. German is a required additional language; precise launch timing subject to translation quality and scope review.

**After 1.0:** native mobile apps; remote-access product if security gates completed; full ecosystem catalog and sandbox hardening; direct Zigbee coordinator without Zigbee2MQTT; extensive energy, camera and AI features; Domyro OS; enhanced migration.

### Explicit non-goals for 1.0

- Bundling a required cloud account, subscription or third-party telemetry.
- Reimplementing Zigbee network firmware / Matter protocol stack from scratch.
- Running simultaneously as a second coordinator on an existing Zigbee adapter.
- Guaranteed support for every Home Assistant integration or device.
- Fully automatic translation of arbitrary Home Assistant automations.
- Professional alarm certification, life-safety guarantees or medical monitoring.
- Delivering a custom operating system, mobile-native apps or AI agent before core stability.
- Hosting unreviewed plugins inside the core process with unrestricted permissions.

## 4. User journeys

**First install:** choose installer > start service > open local onboarding > select language/timezone > establish first admin > detect network interfaces > connect MQTT broker or provision supported option > add first device > choose room > see control card > define scene > set backup reminder.

**Daily control:** resident selects room > controls device > sees pending state and confirmed hardware state or informative error > favorites and scenes readily accessible > works with internet disconnected.

**Advanced automation:** select trigger > configure conditions > add actions/waits > simulate or validate flow > save version > enable > review execution trace > fix failed node.

**Maintenance:** admin sees service health > checks for official releases (if enabled) > optionally downloads verified artifacts after a user-chosen delay > displays release notes and backup requirements > waits indefinitely for an explicitly confirmed manual installation > runs post-install health checks and offers documented recovery. Automatic checking/downloading must never install, restart or upgrade the running version. On Umbrel, app installation/upgrading remains under Umbrel's App Store control.

**Migration:** admin enables a separate restricted Home Assistant bridge > reads HA entities/events via supported APIs > tests candidate mappings > marks transferred devices > prevents duplicate actuation or loops > disconnects the bridge when migration is complete.

## 5. Priority taxonomy

- P0 = required for an acceptable 1.0; subset explicitly required for first hardware proof.
- P1 = first minor releases after 1.0, unless critical for a deployed installation.
- P2 = longer-term ecosystem.
- P3 = research/opportunities, no commitment.

| Product domain | 0.1 | 1.0 / P0 | Post-1.0 |
|---|---|---|---|
| Device/state/command | real Zigbee+MQTT | robust registry, history, errors | complex diagnostics |
| Matter | lab proof targeted | commissioning, state, commands for tested types | expanded device classes |
| UI | responsive device list | dashboard templates, basic layout editor, rooms, scenes, accessibility | full drag-and-drop, custom widgets, tablet/wall mode, 2D floorplans |
| Rules | one trigger-one action | triggers, conditions, waits, schedules and traces | AI suggestions |
| Advanced automation | architecture ready | visual editor for safe subset | reusable subflows/scripts |
| Deployment | Compose dev/proof | Docker, native Linux, Umbrel | bespoke OS |
| Identity | single admin | roles, TOTP, session control, step-up for risky actions | passkeys if not verified for 1.0, stronger SSO/federation |
| Backups | export prototype | encrypted backup/restore verified | remote vault destinations |
| Remote | none | secure reverse proxy/VPN docs | optional Domyro relay |
| Catalog | bundled adapters | safe curated installation mechanism or documented restricted beta | expanded community marketplace |
| PWA | responsive | installable offline UI shell and reconnect | native apps |
| HA migration | research | optional read-only bridge for discovery if robust | state/config import tools |

A \"post-1.0\" feature is not promised by the 1.0 date. A marketplace is not the same as allowing arbitrary code to execute: catalog certification and executable plugin hosting have separate release gates.

**Delivery rule:** D-36 requires us to distinguish *features intended for Domyro* from *features shipped in Domyro 1.0*. See [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md). Do not silently remove accepted long-term requirements.

## 6. Product-level reliability requirements

- Critical local commands never depend on internet access.
- Device state distinguishes observed state, pending requested state, unknown state and unavailable state; do not assume a sent command succeeded.
- Device unique identity survives rename, move between rooms, restart, broker reconnect and discovery order changes.
- Offline integrations are isolated and cannot crash Domyro Core.
- Late or duplicated events cannot silently cause multiple physical commands.
- Invalid automation graphs are rejected before enablement.
- System clock/time-zone and DST behavior is defined and tested.
- First-install does not require a cloud account.
- Logs redact credentials and personally identifying home data by default.
- Data retention and export are owner-controlled.

## 7. Target metrics (acceptance targets, not measured claims)

Test baseline: reference Linux x86_64 mini PC with 4 vCPU, 4 GiB RAM, SSD; 250 entities; stable local network; external radio/device latency reported separately.

- Local API command admission p95 < 250 ms (device execution excluded).
- Observed-device MQTT event to web dashboard p95 < 1 second under baseline load.
- Successful automation dispatch p95 < 500 ms after qualifying local event (physical device excluded).
- First interactive dashboard within 3 seconds p95 on defined test devices.
- 24h soak without process crashes, event loss due to app defects or unbounded memory growth.
- 100% of sampled command failures surfaced with explicit state and trace; no silent success.
- Backup/restore run successfully on each supported installation platform.
- Accessibility: WCAG 2.2 AA target for core flows (third-party plugins excluded).
- Automatic hardware compatibility validation on an explicitly documented support matrix.
- Resource consumption and latency baselines collected in CI/test; adjust targets openly if hardware proves them unrealistic.

## 8. Governance and publication

- Public repository; design and code developed transparently.
- **Confirmed source license:** GNU Affero General Public License version 3 only (SPDX `AGPL-3.0-only`), full standard text in repository `LICENSE`. License compatibility of dependencies remains under review. Covered derivatives and modified network deployments must honor AGPLv3 requirements; independently developed programs/plugins require legal analysis.
- **Official maintainer control:** sole merge/release authority belongs to `@TheRoyalCaptain`. Community forks are fully allowed. All official files are assigned to this owner in `.github/CODEOWNERS`; enforce review through GitHub branch rules before external contributions are merged. See `docs/GITHUB-GOVERNANCE.md`.
- Signed releases, dependency provenance, SBOM, update notes and vulnerability disclosure policy before 1.0.
- Only `@TheRoyalCaptain` can approve changes entering the official repository and publish official releases. Community PRs are proposals, not approvals. No other person, automation or app receives an unrestricted merge/bypass role. GitHub web protection activation remains a required security setup task.
- All significant technical changes documented with ADRs and rationale.
- SemVer releases with stable API versioning rules and deprecation windows.
- Dutch and English maintained together for public-facing functionality.

## 9. Hard go/no-go gates

G0: written product, architecture, licensing, threat model, priorities and initial hardware matrix approved by owner. **No implementation before G0.**  
G1: project scaffolding, core APIs, authentication and local dev reliability proven.  
G2: two genuine device flows (Zigbee2MQTT + generic MQTT) with tests, no Home Assistant dependency.  
G3: independent Matter commissioning and control tested on supported hardware and local network.  
G4: automations and dashboard usability, backups, Linux + Umbrel packaging verified.  
G5: 1.0 security, accessibility, restore, update and regression gates pass.

## 10. Dependencies and risks

1. Matter discovery relies on IPv6/mDNS and suitable LAN/Thread border-router configuration; container networking may differ by platform.
2. Zigbee2MQTT state shape and specific exposed capabilities vary by device; generic mapping must not hide unsupported functions.
3. Copyleft licensing and executable third-party plugin distribution need counsel-quality review before public releases.
4. Umbrel application packaging and permissions are tied to active umbrelOS app-store conventions; pin against tested version.
5. Native Linux installation introduces systemd, package and Node runtime maintenance overhead.
6. Optional relay and catalog are substantial services: they must not hold core functionality hostage.
7. Advanced automation is a safety-critical feature; traceability and non-duplication matter more than visual elegance.
8. Brand clearance and trademark checks precede public product branding or commercial distribution.

## 11. Official technical sources

- Zigbee2MQTT messages: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- OHF Matter.js Server: https://github.com/matter-js/matterjs-server
- Matter networking: https://www.home-assistant.io/integrations/matter
- Umbrel store template: https://github.com/getumbrel/umbrel-community-app-store
- AGPL/GPL FAQ: https://www.gnu.org/licenses/gpl-faq.en.html
- Official contribution governance and GitHub protection instructions: `docs/GITHUB-GOVERNANCE.md`

The detailed contracts are split into the adjoining architecture, integration, security, product, roadmap and test documents. These documents supersede informal preliminary technology suggestions when there is a conflict.

### Detailed implementation contract references (documents, not implemented features)

- **Storage:** [DATABASE.md](DATABASE.md)
- **HTTP and realtime protocols:** [API-CONTRACT.md](API-CONTRACT.md)
- **Automation execution:** [AUTOMATION-ENGINE.md](AUTOMATION-ENGINE.md)
- **Three-platform packaging:** [DEPLOYMENT.md](DEPLOYMENT.md)
- **Supervised real-hardware pilot:** [HARDWARE-PILOT.md](HARDWARE-PILOT.md)
- **Formal planning-to-code approval gate:** [G0-READINESS.md](G0-READINESS.md)
- **Owner-controlled updates and manual installation:** [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md)
- **Native Ubuntu installation, managed services and complete backup targets:** [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md)
- **Cumulative owner-approved features D-22 to D-39, release phasing and open decisions:** [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md)

These are proposed detailed specifications. Formal G0 approval of remaining architecture decisions, hardware/compatibility prerequisites, dependency licensing and GitHub rules remains outstanding.
