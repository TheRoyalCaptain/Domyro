# Domyro — Decisions, assumptions and sign-off

**Planning baseline v1.0 · 29 October 2026**  
**Implementation status: 0.1 M1 foundation development explicitly approved on 2026-10-31; all hardware/deployment/release gates remain pending**

## A. Owner-approved product decisions

D-01 Public serious independent alternative.  
D-02 **Final and owner-approved:** GNU AGPLv3 **only** (`AGPL-3.0-only`), with community forks permitted and exclusive owner approval for official upstream changes/releases.  
D-03 Docker, native Linux, Umbrel from the first supported release.  
D-04 Polished resident UX with advanced administrator mode.  
D-05 Zigbee, MQTT and Matter support are first-priority.  
D-06 Simple rules and advanced flow editor use the same automation system.  
D-07 PWA first, native iOS/Android later.  
D-08 Optional easy remote access planned (no mandatory cloud).  
D-09 Community side-loading plus curated integration catalog.  
D-10 Transitional HA bridge then migration tooling.  
D-11 AI/speech after basic reliability.  
D-12 First success is actual functioning devices.  
D-13 **Final and owner-approved:** Domyro updates are never installed automatically. Users may allow automatic checking and downloading after their own 0h/12h/24h/72h/7d/custom delay; installation always requires an explicit manual decision. Updates to the underlying Linux/umbrelOS operating system are not controlled by Domyro. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).
D-14 **Approved:** Ubuntu Server ISO as native install target, both bare metal and VM. No Docker required in native mode.
D-15 **Approved:** On native Ubuntu, the admin UI can install/manage optional necessary supporting services with permission; existing network services remain connectable. Container service management respects host boundaries.
D-16 **Approved:** Matter-ready design without owner's Matter devices; real-world hardware validation remains release acceptance requirement.
D-17 **Approved design principle:** select language/database/runtime with evidence on reliability, stability and speed; existing stack still proposed.
D-18 **Approved:** one trusted entry command for full native installation and browser setup, with explicit security prompts.
D-19 **Approved:** multiple homes/sites and granular permissions across users, rooms and entities.
D-20 **Approved:** local, SMB/NAS, FTP and removable USB backup support, with secure FTPS/SFTP and explicit insecure FTP warning.
D-21 **Approved:** specification-first, no application code before comprehensive planning and formal G0 sign-off.
See [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md).

### Additional owner-approved product decisions (2026-10-30)

D-22 **Approved:** Dashboard templates, full drag/drop editing, custom widgets, dedicated tablet/wall mode.  
D-23 **Approved:** Floor and room grouping, interactive 2D floorplans.  
D-24 **Approved:** Multi-device scenes, schedules, conditions/exceptions, capture actual current states.  
D-25 **Approved:** Advanced automation: typed variables/calculations, conditions, branching, loops, waits, reusable scripts/subflows, live tests/simulations/traces.  
D-26 **Approved:** Every plugin installation requires explicit manual approval. **D-44 subsequently fixes updates:** automatic metadata checks, manual downloading and manual installation.  
D-27 **Approved:** Live electricity/gas/water, cost and dynamic tariffs, solar+battery, smart EV charging.  
D-28 **Approved:** Camera live view, recordings/playback, motion detection/alerts, ONVIF/RTSP.  
D-29 **Approved:** Phone push, email, webhooks, critical priorities and notification rules.  
D-30 **Approved:** German alongside Dutch and English. Launch scope pending localization QA decision.  
D-31 **Approved:** Live CPU/RAM/disk/network telemetry, device/integration logs, error export, proactive faults/storage alerts.  
D-32 **Approved:** Presence from motion/manual status, GPS/mobile, BLE, Wi-Fi/network.  
D-33 **Approved:** Eventually, fully local voice assistant.  
D-34 **Approved:** Unified protocol UI, native Zigbee long-term, keep external Zigbee2MQTT, make external services optional when native alternatives proven stable.  
D-35 **Approved:** Three top differentiators: polished fast dashboards; more powerful automations; local independence.  
D-36 **Approved:** Compact, highly reliable 1.0; full product vision to be phased.  
D-37 **Approved:** TOTP, passkeys/biometrics where supported, high-risk reauthentication and active-session management.  
D-38 **Approved:** Daily/weekly/monthly backup schedules, automatic retention, several destinations, automated integrity validation.  
D-39 **Approved:** Anyone may propose feature requests via GitHub Issues; official changes require @TheRoyalCaptain approval.  

### More approved product decisions D-40..D-52 (31 October 2026)

| D-40 | Ubuntu Server LTS **x86-64 and ARM64**, native bare metal and VM; exact LTS versions and ARM hardware matrix still to confirm. |
| D-41 | Installer lets the admin **choose for each supporting service** whether to install/manage, connect an existing service or defer if optional. |
| D-42 | Multiple sites on one server **and** multiple independent Domyro servers that may optionally connect in a future phase; no mandatory cloud. |
| D-43 | Local access through **IP:port, mDNS host such as domyro.local where network supports it, and own domain/reverse proxy**; all three coexist. |
| D-44 | Installed plugin updates are **checked automatically**; **downloads and installations require separate manual actions**. Plugin installation consent D-26 remains. |
| D-45 | Default backup retention: **7 daily, 4 weekly and 12 monthly**, configurable and independently safe across targets. |
| D-46 | Per-automation missed-run policy after outage: **skip, bounded catch-up or ask for confirmation**; unsafe commands never blindly replay. |
| D-47 | Account recovery offers **single-use recovery codes and a secure trusted-local console recovery procedure**. |
| D-48 | **1.0 dashboards:** ready-made templates and simple changes; full drag/drop, custom widgets and tablet wall mode later. |
| D-49 | **1.0 automations:** simple rules plus safe basic visual editor; advanced editor features later. |
| D-50 | **German translation after the first stable 1.0**; 1.0 fully NL+EN. |
| D-51 | **Domyro-managed optional remote access after 1.0**; initial access through owner-managed VPN/reverse proxy. |
| D-52 | **Simple energy charts in 1.0**, camera functions after 1.0; advanced energy/tariffs/solar/EV later. |

**Full precise scope:** [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md). These decisions **supersede earlier unresolved suggestions** about German in 1.0, plugin auto-downloads, Debian being required for native 1.0, camera/energy 1.0 timing and exact editor depth.

**Detailed acceptance and proposed milestones:** [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md). Multiple selected items within each question are cumulative. Unselected items remain undecided, not disallowed.

## B. Proposed technical ADRs for project owner sign-off

| ADR | Decision | Rationale | Alternative / tradeoff |
|---|---|---|---|
| A-01 | **Accepted:** AGPL-3.0-only for original Domyro core/web code; standard license in `LICENSE` | Network-copyleft plus free forks; @TheRoyalCaptain exclusively approves official upstream | Third-party dependency compatibility and independent plugin licensing still require review |
| A-02 | TypeScript/Node.js modular monolith | Shared types, rapid execution, manageable ops | Python core richer ecosystem, Rust better deterministic performance but slower initial development |
| A-03 | PostgreSQL only for supported production | ACID relational registry, history, migrations and reliable transaction outbox | SQLite reduces setup but complicates multi-process writes and growth; embedded alternative future |
| A-04 | REST v1 + authenticated WebSocket snapshots/deltas | Predictable API and realtime updates | GraphQL more complexity without clear benefit |
| A-05 | Zigbee via Zigbee2MQTT first, not direct radio ownership | Fast support with existing mesh and MQTT | Depend on external Zigbee service |
| A-06 | Matter via standalone OHF Matter.js Server | Avoid implementing complex protocol stack | Runtime/network complexity, secure fabric storage |
| A-07 | One typed automation graph; two editors | Prevent two incompatible rule engines | More upfront graph/schema work |
| A-08 | Third-party executable plugins outside core | Risk compartmentalization and crash isolation | Higher packaging/runtime overhead; no absolute sandbox guarantee |
| A-09 | Optional, future remote relay using audited encryption architecture | Local-first and simple opt-in access | Requires dedicated infrastructure and advanced key security |
| A-10 | Three genuinely supported installers, including native systemd Linux | Matches user priorities | Longer initial development and support matrix |
| A-11 | No source code before documented acceptance G0 | Prevent architecture drift and premature commitment | Slower first coding day, less later rework |
| A-12 | **Accepted product policy:** automatic update checking/downloading can be user-enabled; **installation is always manual** | Prevent unapproved restarts and service upgrades | Umbrel platform-managed updates may not provide native artifact staging; capability limitations must be visible |

## C. Remaining G0 approvals

These are intentionally explicit; they are *not* reasons to start implementation while unsettled:

1. **License selected and recorded:** `AGPL-3.0-only`; finish dependency license compatibility and third-party notice audit before public binaries. AGPL obligations do not automatically mean independently developed plugins must use AGPL.
2. **Evaluate stability, speed, reliability and long-term support** of candidate backend/frontend/database stacks, then explicitly approve a final architecture. TypeScript/Node.js + PostgreSQL is still a proposal, not an owner decision.
3. Confirm exact first hardware models: which Zigbee sensor and mains-powered device, which Matter device and which broker.
4. **Ubuntu Server LTS amd64+arm64 required** for native 1.0; confirm exact Ubuntu LTS releases and ARM64 models. Debian is not approved as a native 1.0 requirement. Confirm supported UmbrelOS versions.
5. **Maintainer policy decided:** `@TheRoyalCaptain` alone authorizes official upstream merges and releases. **GOV-01 accepted 31 October 2026:** owner elected to proceed **without mandatory GitHub branch protection for now**. This makes owner-only approval a procedural rule, **not a technical guarantee** against other authorized writers or GitHub Apps. Confirm minimal write permissions, issue handling and code of conduct. See `docs/GITHUB-GOVERNANCE.md`.
6. Approve threat model and the release gate that remote service/marketplace will follow core stability.
7. Confirm initial hardware acceptance criteria and the rule that existing HA/Zigbee mesh remains untouched without explicit consent.
8. Confirm trademark/name investigation before public brand launch.
9. **Key 1.0 allocations are now confirmed by D-48..D-52:** templates/simple dashboard editing; simple rules+basic visual editor; German and cameras after 1.0; basic energy graphs 1.0; Domyro relay after 1.0. Remaining exact technical acceptance (e.g. passkeys scope/backup verification depth) still needs an ADR.
10. **Resolved by D-44:** automatic plugin-update checks are allowed; downloading and installation both require manual actions, with manual plugin installation approval already fixed under D-26.

**Decision status:** A-01 (AGPL-3.0-only) and owner product decisions D-01..D-52 are accepted. **GOV-01:** owner knowingly defers branch protection; CODEOWNERS alone does not enforce sole-authorizer control. A-02..A-11 and remaining hardware/legal/deployment gates are still proposed pending separate formal G0 sign-off. External forks and contributions remain allowed under AGPL.

## C1. Accepted governance exception GOV-01 (31 October 2026)

- **Approved by:** @TheRoyalCaptain, via explicit instruction to continue without branch protection.
- **Scope:** no mandatory GitHub `main` branch ruleset at this stage. Preserve CODEOWNERS and contributor policy.
- **Risk accepted:** anyone with active Write/Maintain/Admin permissions and privileged GitHub Apps may be able to push to `main` directly, regardless of CODEOWNERS; forced branch safeguards and required PR review are not guaranteed.
- **Mitigations:** minimum necessary access to the repository; audit GitHub collaborator and app authorizations, use passkeys/2FA, watch commits; prefer branches+PRs as workflow even if not enforced.
- **Reassessment trigger:** before inviting additional write maintainers or assigning unrestricted unattended GitHub bot access, and before public stable release security review.
- **Does not authorize:** new application code, GitHub Issues, installation or release. G0 remains separately pending.
- **References:** [GITHUB-GOVERNANCE.md](GITHUB-GOVERNANCE.md), [G0-READINESS.md](G0-READINESS.md).

## C2. Owner's limited G0 foundation authorization (31 October 2026)

**Approved by:** @TheRoyalCaptain: 'Oké start maar', in direct reply to the explicit proposed G0 programming start. **Scope:** create M1 foundation source and tests in GitHub. This authorizes **code development**, not production release, installing software on live user servers, touching Zigbee/MQTT/Home Assistant or configuring WAN connectivity. Runtime/framework/DB selection is still subject to documented architecture/security/dependency review.

[Exact limited approval and phase boundaries](G0-IMPLEMENTATION-START.md). Branch protection remains consciously deferred under GOV-01.

## D. Decision record template

- ADR ID and date:
- Status: proposed / accepted / superseded:
- Problem:
- Options and evidence:
- Choice and constraints:
- Consequences/tradeoffs:
- Security, compatibility and licensing effect:
- Reversal/migration path:
- Approver:
- Source links:

## E. G0 acceptance statement

\"\"I approve the Domyro planning baseline, including selected architecture, the licensing strategy after review, priority and deployment scope, risk exclusions, test gates and task list. Implementation and GitHub issue creation may begin only after this sign-off is recorded.\"\"

The explicit owner response on 31 October 2026 **has authorized limited M1 source development**, which is recorded in [G0-IMPLEMENTATION-START.md](G0-IMPLEMENTATION-START.md). This is **not blanket approval** of unreviewed hardware activity, dependency risks or official distribution.

## F. External reference links

- GNU AGPL and GPL FAQ: https://www.gnu.org/licenses/gpl-faq.en.html
- Official GitHub governance policy: `docs/GITHUB-GOVERNANCE.md`
- Source license: `LICENSE`
- Zigbee2MQTT API: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- OHF Matter.js Server: https://github.com/matter-js/matterjs-server
- Matter networking: https://www.home-assistant.io/integrations/matter
- Home Assistant WS API: https://developers.home-assistant.io/docs/api/websocket/
- Umbrel community packaging: https://github.com/getumbrel/umbrel-community-app-store
- Umbrel app store expectations: https://github.com/getumbrel/umbrel-apps
