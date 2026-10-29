# Domyro

**Your home. Your rules.**

Domyro is a planned open-source, local-first smart-home platform with a self-hosted core, modern resident interface and advanced management tools.

> **Status: PLAN-ONLY.** This repository currently contains architecture and product planning documents, **not an implementation**. No application code is authorized until the project plan has been reviewed and approved.

## Product commitments

- Independent automation and device platform: not a Home Assistant frontend.
- Fully functional local control without mandatory cloud subscription.
- Public, copyleft open source, with AGPLv3 proposed for Domyro-owned code, pending dependency and legal review.
- Installation targets from first supported release: Docker Compose, native Linux (Debian/Ubuntu), and Umbrel.
- Initial protocol priorities: MQTT, Zigbee2MQTT and Matter.
- Progressive web app first, later native mobile apps.
- Simple rules and a sophisticated visual automation editor.
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

## Rules during planning

Only changes to planning documents are allowed. Do not initialize an application, provision services, publish containers or implement source code. Do not migrate, reset or claim ownership of the user's active smart-home devices.

Reference material is recorded in the relevant documents. Trademark and name clearance, dependency license review and a first real hardware inventory remain explicit pre-release checkpoints.
