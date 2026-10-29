# Domyro — Architecture and contracts

**Planning baseline 1.0 · 2026-10-29 · no code authorized**

## 1. Adopted architecture (ADR-002)

A TypeScript/Node.js modular monolith for domain logic, an isolated React PWA, PostgreSQL, a typed in-process event bus and a durable event/automation execution store. Integrations use adapters; potentially unsafe executable third-party integrations run outside core in restricted processes/containers. Matter runs in a dedicated OHF Matter.js server. MQTT connects to a standard external broker (initially an existing Mosquitto or user-provided broker). No mandatory Redis, Kafka, Kubernetes or proprietary cloud.

Why: fastest maintainable full-stack development while retaining protocol/process isolation; the main risk is Node CPU/event-loop blocking, which must be monitored and mitigated with worker processes if necessary.

### Stack contracts

| Layer | Chosen approach |
|---|---|
| Backend | TypeScript, actively supported Node.js LTS, Fastify |
| API schema | OpenAPI 3.1 / JSON Schema, runtime validation with Zod or comparable schema library; choose one before implementation |
| Frontend | React, TypeScript, Vite, Tailwind, accessible headless component primitives |
| State client | TanStack Query + centralized WebSocket reconciliation |
| Database | PostgreSQL, versioned schema migrations; SQL-first ORM selected in ADR before scaffolding |
| Communication | REST for commands/resources; authenticated WebSocket for changes |
| Core events | Typed in-process bus + transactional durable outbox for critical events |
| MQTT | MQTT.js, broker endpoint/credentials configurable, TLS supported |
| Matter | Separate OHF Matter.js Server via documented WebSocket client |
| Automations | Own deterministic graph interpreter and execution journal |
| Observability | Structured JSON logs, health/readiness and metrics endpoints |
| Dev workspace | pnpm workspace monorepo; lint/format/typecheck/test gates |
| Packaging | OCI Docker images, Linux systemd package and official Umbrel-compatible app definition |
| Documentation | Versioned Markdown specs + OpenAPI + architecture decision records |

Do not confuse proposed library selections with proven production integration; all must pass compatibility and license review at G0/G1.

## 2. Modules and ownership

- **Identity:** accounts, sessions, password and MFA enrollment, invitation lifecycle, local admin bootstrap.
- **Sites & areas:** site, floor, room, tags; per-site policies, localization and timezone.
- **Integration manager:** integration instance, capabilities, config, secrets, health and reconnect lifecycle.
- **Device registry:** one physical/logical endpoint plus stable provider-scoped hardware ID, model, vendor, firmware, bridge.
- **Entity registry:** one controllable/observable feature per device; stable ID; type, supported features, unit, mappings and user overrides.
- **State engine:** validated observed values, timestamp, source, sequence, quality and availability.
- **Command dispatcher:** authorization, capability validation, idempotency, TTL, queued/pending/sent/confirmed/failed/expired outcomes.
- **Event hub:** normalized state/event envelopes with source, correlation, causation, occurred_at and recorded_at.
- **Automation engine:** trigger definitions, flow DAG validation, conditions, timers, execution journal and conflict rules.
- **Scene service:** versioned target states, bounded dispatch, per-device outcome report.
- **History:** retention, downsampling, metrics and export, partitioned event/measurement tables.
- **Dashboard service:** layout and widget definitions with capability validation and access filtering.
- **Notifications:** internal inbox P0; push/email adapters later.
- **Backup service:** transactional export with manifest, encryption, integrity check and restore testing.
- **Audit:** immutable-in-app security activity and device commands, subject to retention policy.
- **Diagnostics:** integration health, failed actions, missing devices, network status and support bundles.

No module may bypass the permission boundary to dispatch physical commands.

## 3. Domain model

Logical relations:

- installation 1:N sites, users and integration_instances;
- site 1:N floors, areas, devices, automation_definitions, scenes and dashboards;
- integration_instance 1:N devices; device 1:N entities;
- entity 1:1 current_observed_state, 1:N state_history and command_records;
- automation_definition 1:N immutable revisions and run_journals;
- user N:M roles/site membership; policy grants apply to devices/entities/actions;
- event_outbox and audit_entries bind identifiers, correlation and timestamps;
- backup_manifests record protocol versions, schema version and encrypted material inventory.

### Essential tables

installations, sites, floors, areas, users, memberships, roles, permissions, sessions, auth_factors, api_tokens, integration_instances, integration_secrets, devices, entities, entity_state_current, entity_state_history, device_commands, event_outbox, scenes, scene_actions, automation_definitions, automation_revisions, automation_runs, automation_step_runs, dashboards, dashboard_widgets, notifications, audit_events, backups, schema_migrations.

### Identity constraints

- internal ID is immutable UUIDv7 or sortable UUID equivalent;
- provider binding unique on (integration_instance_id, provider_device_id);
- entity binding unique on (device_id, provider_entity_key);
- users may rename, hide, disable or relocate without changing provider identifier;
- deleting a device requires explicit confirmation; history can be retained or purged separately;
- removed/re-added devices can be reconciled with stable provider IDs, not only human-readable names.

### State envelope

Fields: entity_id, observed_value, quality(known|stale|unknown|unavailable), available, observed_at, received_at, integration_instance_id, source_event_id, units, version. Desired/requested state is stored separately as a command and **must not overwrite observed state** until confirmed. Ignore out-of-order source timestamps only where source guarantees ordering; otherwise maintain ingestion ordering and source-specific freshness rules.

### Event envelope

event_id, site_id, event_type, subject_id, source, occurred_at, ingested_at, correlation_id, causation_id, schema_version, payload, visibility and replay_safe flag. Event consumers must be idempotent. Durable outbox is committed in the same DB transaction as state changes; at-least-once internal delivery, never claim global exactly-once.

## 4. Command lifecycle

1. API authenticates caller and site scope.
2. Authorization verifies entity/action and safety restrictions.
3. Request validates schema, entity capability, value range and idempotency key.
4. Command ledger records accepted request with TTL and correlation ID.
5. Driver dispatches command to protocol.
6. Driver optionally obtains protocol acknowledgment.
7. Observed state updates independently; outcome confirms when a matching reliable observation exists, else reports sent/unconfirmed or timeout.
8. UI shows pending then observed/result; errors are never presented as confirmed success.

Safe retries only for declared idempotent actions. Toggle, unlock, dispense, open/close or irreversible operations are not silently retried. Command deduplication is keyed by caller + site + idempotency key and expires under documented rules.

## 5. Automation engine

Store versioned **flow definition as typed graph JSON**, not executable arbitrary JavaScript.

Node families:
- Trigger: entity state, numeric threshold with hysteresis, event, schedule, sunrise/sunset, webhook, manual.
- Condition: typed comparison, AND/OR/NOT group, time window, availability and membership.
- Action: entity command, scene invocation, notification, set scoped variable.
- Control: delay, bounded repeat, branch, wait-until, stop.
- Diagnostics: log marker (redacted).

Parser validates graph schema, capability compatibility, reachability, terminal nodes, forbidden cycles, unbounded waits and privilege requirements. Simple rule UI compiles to this *same graph model*; advanced UI edits it without a separate engine.

Runtime:
- explicit concurrency modes: single, restart, queue(max size), parallel(max runs);
- per-automation rate limits, recursion/loop guards and cooldown;
- persistent timer and schedule records;
- UTC internally, site IANA time zone for civil times, explicit DST policy for skipped/repeated hours;
- power-loss behavior documented per node (resume safe waits; never blindly replay non-idempotent commands);
- execution trace per step with reason, inputs redacted, errors and device result;
- dry-run verifies graph and simulated state, but does not claim hardware behavior.

Automations are version-locked during each run; editing publishes a new revision. Disable must stop future triggers and handle active runs per defined policy.

## 6. Interfaces and API versioning

- API root: /api/v1/; OpenAPI generated from schemas.
- Authentication: session cookie, HttpOnly/Secure/SameSite, CSRF protection on cookie-based mutation; scoped tokens for external clients.
- Resources: /sites, /areas, /devices, /entities, /entities/{id}/state, /commands, /scenes, /automations, /automations/{id}/runs, /integrations, /history, /dashboards, /backups, /admin/health.
- Commands use POST /api/v1/commands, request idempotency-key and return command_id + status, not a fabricated state.
- Pagination: cursor-based for history/events; bounded queries, per-site filtering.
- Times: RFC3339 UTC on the wire, IANA timezone in site profile.
- Resource IDs are opaque, never trust guessed ID as authorization.
- /ws/v1 endpoint: auth handshake, version negotiation, snapshot+delta protocol, sequence numbers, reconnect/resync, heartbeat and backpressure.
- REST/WS external docs include deprecation schedule and exact stability guarantees.
- All APIs default to deny unless explicitly authorized; plugin hooks cannot bypass normal command validation.

WebSocket reconnection: obtain a fresh consistent snapshot if sequence continuity is lost; do not leave silent stale UI. API responses use stable machine-readable error codes and localized display messages.

## 7. Packaging/runtime boundaries

**Docker**: core, web, Postgres, and optionally broker and separate Matter server; persistent volumes, non-root where possible, explicit host-network requirements for discovery; HTTPS termination documented; reproducible pinned images.

**Native Debian/Ubuntu**: signed deb/package candidate or guided installer with systemd units; separate PostgreSQL service; stable service user, config paths, backup and uninstall policy. Supports x86_64 and ARM64 only after hardware tests. \"Native Linux\" is not a disguised Compose installer.

**Umbrel**: dedicated community app-store definition (umbrel-app.yml and docker-compose.yml per active spec) backed by published Domyro images; onboarding in browser; predictable volumes; no dependence on Portainer; respect network limitations of umbrelOS. Matter local networking must be explicitly tested instead of assumed.

Support matrix pins the versions actually validated; Linux distro releases, CPU architectures, broker variants, network topologies and storage hardware are listed in deployment docs.

## 8. Failure isolation and recovery

- DB temporarily unreachable: device commands fail closed (never unrecorded dispatch); controlled buffering only for validated read telemetry, with bounded memory.
- MQTT disconnected: mark affected entities stale/unavailable; reconnect with exponential backoff/jitter; resubscribe and reconcile retained state.
- Matter server down: Matter integration unavailable; core/UI/other protocols continue.
- Plugin crashed: restart with capped backoff and quarantine on repeated failures; no core process crash.
- Time discontinuity: schedules re-evaluated with explicit missed-event policy.
- Process restart: restore registries and schedules, reconcile devices; do not replay unsafe commands.
- Database migration fails: abort startup or revert using a tested backup; no blind down-migration.
- Browser offline: show cached UI shell but **do not pretend device commands were delivered**; no offline command queue by default.

## 9. Planned repository structure

apps/web, apps/server, packages/core, packages/api, packages/database, packages/ui, packages/integration-sdk, packages/automation-engine, packages/shared, integrations/mqtt, integrations/zigbee2mqtt, integrations/matter, deploy/docker, deploy/linux, deploy/umbrel, docs, tests, .github/workflows.

Source directories are planned only; they must not be created before planning sign-off.
