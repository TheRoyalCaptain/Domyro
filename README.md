# Domyro

**Your home. Your rules.**

Domyro is a planned open-source, local-first smart-home platform with a self-hosted core, modern resident interface and advanced management tools.

> **Status: PLAN-ONLY.** This repository currently contains architecture and product planning documents, **not an implementation**. No application code is authorized until the project plan has been reviewed and approved.

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

**Current project gate: G0 not yet approved.** License and official maintainership are confirmed; stack details, pilot hardware, dependency review and GitHub branch protection remain to be signed off.

### Licensing and contributions

The official license is [GNU AGPL version 3 only](LICENSE) (SPDX: `AGPL-3.0-only`). Others may inspect, fork, modify and redistribute under its terms. **Only @TheRoyalCaptain** has authority to accept contributions and publish official Domyro versions. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODEOWNERS](.github/CODEOWNERS). GitHub's web settings must still activate required code-owner review: CODEOWNERS by itself is not branch protection.

## Rules during planning

Only changes to planning, governance and licensing documents are allowed. Do not initialize an application, provision services, publish containers or implement source code. Do not migrate, reset or claim ownership of the user's active smart-home devices.

Reference material is recorded in the relevant documents. Trademark and name clearance, dependency license review and a first real hardware inventory remain explicit pre-release checkpoints.
