# Domyro — Database and data-lifecycle specification

**Document:** DB-001 · **Status:** detailed proposal, subject to G0 sign-off · **Date:** 2026-10-30

> Documentation only. This document is the intended relational contract, not SQL to execute. The final choice of query builder/migration library and PostgreSQL major version remains an architecture decision.

## 1. Design goals

- PostgreSQL owns the authoritative installation state.
- Local-first: a cloud account, Redis and a second database must not be required.
- Stable identifiers are independent of human-facing display names.
- Strict installation/site isolation in data access.
- Distinguish an observed physical state from the requested action.
- Immutable revisions of automations, scenes and operational decisions.
- Data retention is predictable, documented and user-configurable.
- Recovery and schema migrations are first-class operations.

## 2. Logical relations

```text
installation
 ├─ sites ── floors ── areas
 │    ├─ integration_instances ── devices ── entities
 │    │                                  └─ entity_state_current
 │    │                                  └─ entity_state_history
 │    ├─ scenes ── scene_revisions ── scene_actions
 │    ├─ automations ── automation_revisions ── automation_runs ── automation_step_runs
 │    ├─ dashboards ── dashboard_revisions ── widget_instances
 │    └─ event_outbox / audit_events / notifications
 ├─ users ── site_memberships ── permission grants
 ├─ sessions / auth_factors / api_tokens
 ├─ integration secrets (encrypted payloads + key-version metadata)
 └─ backups / backup_items / schema_migrations
```

### ID and naming rules

- All primary IDs: server-generated UUIDv7 if supported by the chosen dependency, else opaque UUIDv4; not externally editable. Do **not** put device-friendly names inside DB foreign keys.
- Human names are UTF-8, Unicode-normalized, length-bounded and case-insensitive for search; may duplicate across rooms.
- All creation/update and `observed_at` timestamps are UTC `timestamptz`. Site configuration stores its **IANA zone**, such as `Europe/Amsterdam`, separately.
- Ordinary edits use `row_version` optimistic concurrency where update conflicts matter.
- Soft-delete only where recovery and correct history reconciliation justify it. Purge has a separately audited job.

## 3. Proposed tables and critical constraints

| Table | Important columns | Constraints / notes |
|---|---|---|
| installations | id, install_id, created_at, schema_version | One installation per supported standalone deployment. |
| sites | id, installation_id, display_name, timezone, locale | Foreign key installation; timezone must be valid IANA. |
| floors | id, site_id, display_name, sort_order | Optional; a single-floor home does not require floor labels. |
| areas | id, site_id, floor_id?, display_name, sort_order | No device ID changes on area moves. |
| users | id, login, password_hash, disabled_at, created_at | Case-normalized unique login; never store password plaintext. |
| memberships | user_id, site_id, role_id, status | Unique user/site active assignment. |
| roles/grants | role, resource_scope, action_scope, effect | Effective permission evaluation is server-side deny by default. |
| sessions | id, user_id, refresh_hash, expires_at, revoked_at | Hashed session tokens, no bearer token plaintext in DB. |
| integration_instances | id, site_id, integration_type, instance_key, status, config_version | Unique (site_id, integration_type, instance_key). |
| integration_secrets | integration_id, secret_name, encrypted_blob, key_version | AEAD encryption using instance master key; never log. |
| devices | id, integration_id, provider_device_id, manufacturer, model, firmware, area_id?, disabled_at | Unique (integration_id, provider_device_id), **not** friendly_name. |
| entities | id, device_id, provider_entity_key, entity_type, capability_schema, value_schema, enabled, unit | Unique (device_id, provider_entity_key). |
| entity_state_current | entity_id, observed_value, quality, observed_at, ingested_at, state_version, provider_revision? | Exactly one current row/entity; quality enum. |
| entity_state_history | site_id, entity_id, observed_value, quality, observed_at, ingested_at | Partition by observed_at; select by entity/time. |
| device_commands | id, site_id, entity_id, actor_id?, automation_run_id?, idempotency_key?, command, status, accepted_at, sent_at?, completed_at?, expires_at?, failure_code? | Unique dedup key scope; "sent" != "confirmed". |
| event_outbox | id, site_id, aggregate_type, aggregate_id, type, occurred_at, payload, dedup_key?, publish_state | Inserted in same transaction as state mutation. |
| scenes | id, site_id, name, revision_id, enabled | Revision pointer, not mutable active action list. |
| scene_revisions/actions | id, scene_id, revision_no, actions, creator, created_at | Immutable; per-action target and capability validation. |
| automations | id, site_id, name, active_revision_id, enabled, concurrency_policy | Revision ID pinned for each execution. |
| automation_revisions | id, automation_id, rev_no, schema_version, graph_json, created_by, created_at | Immutable graph. |
| automation_runs | id, automation_id, revision_id, trigger_event_id, state, started_at, ended_at?, error_code? | Supports idempotent trigger intake and debug. |
| automation_step_runs | id, run_id, node_id, attempt, state, started_at, finished_at?, sanitized_input, result_code | May contain sensitive device/presence info: retention applies. |
| dashboards/widgets | dashboard_id, owner_id?, site_id, revision, layout_json, widget_config | Widget entity refs validated against access rights. |
| audit_events | id, actor_id?, site_id?, operation, resource, result, timestamp, correlation_id, redacted_meta | Append-only at application level, encrypted backups. |
| backups | id, requested_by, created_at, schema_version, checksum, encrypted, key_version, state | Owner export and restore status; never store passphrase. |

Field sets are starting contracts; final migrations must include appropriate length, check, and foreign-key constraints. Password/session credentials and Matter fabric keys have stricter storage policies than ordinary integration metadata.

## 4. Device/entity normalization

A physical Zigbee device may expose multiple entities. Example: one sensor produces temperature, humidity and battery entities under the same device. A plug may expose switch state and measured power.

Stable mapping:
- Zigbee2MQTT device: prefer `ieee_address` scoped to integration instance; entity key includes explicit endpoint/property key.
- Generic MQTT: an operator-defined immutable binding UUID plus topic mapping; renaming topics requires explicit migration/rebind confirmation.
- Matter: fabric-scoped node ID and endpoint/cluster/attribute or supported command identity; record fabric identity to prevent collision across fabrics.

Define typed capability metadata: `readable`, `writable`, `reportable`, `unit`, `min`, `max`, `step`, `enum`, `supported_commands`, `confirmation_mode`. Keep raw attributes in a namespaced diagnostic object with bounds.

## 5. State history and consistency

- Driver ingestion validates type, physical units, bounds and payload size. Invalid payload goes to bounded diagnostic logs, not current state.
- Update current state and enqueue normalized event atomically.
- Out-of-order source messages: use sequence/revision if guaranteed by driver, otherwise mark freshness and event receive order; do not make up a global total order across protocols.
- Historical measurements remain immutable during an ordinary rename or move; deletes follow explicit retention/purge decisions.
- Sensor samples: deduplicate exact repeated sample/event IDs when supported; don't compress away legitimately repeated values without an explicit data policy.
- Indexed queries: (site_id, entity_id, observed_at DESC), (site_id, occurred_at DESC) and correlation IDs, with retention-partition indexes.
- Downsample at supported granularity and retain aggregates separately; preserve data provenance and units when converting.

## 6. Command and event transaction contract

1. Authorize scope and check capability.
2. Insert a pending device command and outbox record in one transaction.
3. Driver worker dispatches with defined lease/recovery, no replay of non-idempotent actions.
4. Persist protocol acknowledgment separately from physical state confirmation.
5. State observer reports matching physical state where verifiable; otherwise end as `sent_unconfirmed` or `timed_out`.
6. Keep correlation chain for auditing.

Dedup namespace: `site_id + caller_identity + idempotency_key`; idempotency keys expire under documented interval. Enforce unique key only when supplied, not all nulls. Data race tests for two simultaneous clients and reconnects are release blockers.

## 7. Migration and recovery policy

- Numbered and checksum-validated migrations; every production upgrade has a restore point and data volume check.
- Prefer compatible expand/migrate/contract changes across rolling releases. Irreversible migrations require extra owner warning and restore instructions.
- Do not import old HA identifiers as primary keys. Store external identity mapping in a distinct table so imports can be undone.
- Atomic logical backup of DB with encrypted configuration/fabric key export; recovery tests on fresh installs.
- Installation fingerprint changes and restoration on other hardware trigger secure key transfer / re-pair guidance.
- Migrations never issue physical device commands.

## 8. Retention starting defaults

| Data | Starting retention | Configurable |
|---|---:|---|
| Raw numeric values | 30 days | yes |
| Hourly/daily aggregates | 365 days | yes |
| Automation run traces | 30 days | yes |
| General diagnostics | 14 days | yes |
| Security audit history | 90 days | yes |
| Current device/entity registrations | while device exists | deletion by authorized admin |
| Backups | **7 daily / 4 weekly / 12 monthly** (owner decision D-45) | yes |

Times and periods are **design defaults**, not verified production behavior. Warn users about size and privacy consequences of long-term retention. Restore and personal-data deletion policies must be documented together.

## 8A. Owner decisions D-42, D-45 and D-47 affecting data layout

- **D-42 multi-server topology:** each Domyro installation has its own immutable identity and independent authoritative DB. Future linked installations must use explicit mutual pairing, source installation identity, remote permissions, revocation state and sync cursors; never merge databases or entity IDs blindly.
- **D-45 backup snapshots:** default 7 daily + 4 weekly + 12 monthly, configurable per target/policy; backup manifest tracks logical retention category, verification outcome and protected deletion eligibility. Failed target writes must not cause removal of a last healthy backup.
- **D-47 account recovery:** never store recovery codes in plaintext; store one-time hashed codes with recovery audit, revocation and trusted local-console reset capability. Console recovery must not expose existing passkey private keys or encryption secrets.
- **D-46 missed scheduled actions:** include immutable occurrence identity and stored schedule timestamp per run, missed execution state, catch-up bounds/approval status, expiration and audit links. Design supports safe restart replay prevention.

Requirements: [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 9. Database acceptance gates

- Rename Zigbee2MQTT friendly name: zero duplicate device/entity rows, history unchanged.
- 50 concurrent updates to one sensor: one valid last observed state and complete traceable event history.
- Broker reconnect and duplicate events: bounded outbox, dedup when source event IDs stable.
- Power outage between transaction commit and event dispatch: outbox replay resumes without duplicate non-idempotent device action.
- Unauthorized cross-site user: no rows, not even row counts or time series leaked.
- Purge test: raw measurements removed while aggregates preserved per owner policy.
- Corrupted backup: restore refuses to modify live DB.
- Migration failure: startup refuses unsafe state and presents explicit recovery instructions.

## 10. Questions still requiring ADR

- UUIDv7 implementation, migration runner/ORM, JSONB indexes and high-volume partition schedule.
- Default downsample resolution and whether 1.0 exposes timeseries export as CSV only or CSV+JSON.
- Master-key storage/recovery mechanism for native, Docker and Umbrel, including user-supplied backup passphrases.
- Postgres major version and minimum CPU/RAM/disk support matrix.

Cross-references: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md), [API-CONTRACT.md](API-CONTRACT.md).
