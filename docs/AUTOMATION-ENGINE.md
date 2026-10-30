# Domyro — Automation Engine formal specification

**AUTO-001 · Planning draft 1.0 · 2026-10-30 · No executable code authorized**

## 1. Product requirement

Domyro offers two authoring experiences for ONE underlying type-safe execution engine:

- **Simple mode**: readable trigger → optional conditions → actions, with wizard and templates.
- **Advanced mode**: graphical directed flow with branch, wait, variable, event and guard nodes; fully keyboard-accessible list editor as alternative.

Switching a simple rule to advanced mode must preserve semantics. Converting an arbitrary advanced graph back to simple mode may be impossible; show a precise warning and remain in advanced mode instead of silently discarding nodes.

Execution runs locally with no mandatory network service and without interpreting arbitrary contributor-supplied JavaScript.

## 2. Automation lifecycle

```text
draft → validate → simulate (optional) → publish immutable revision → enable
trigger event → evaluate conditions → schedule steps → issue scoped command
           → complete / fail / cancel / wait / expire
edit → new draft revision → publish new revision (existing run stays pinned)
disable → stop future triggers; running instances handled by chosen policy
```

Lifecycle statuses: `draft`, `valid`, `invalid`, `published`, `enabled`, `disabled`, `archived`. Runs: `queued`, `running`, `waiting`, `succeeded`, `partially_succeeded`, `failed`, `cancelled`, `expired`.

All state transitions and reasons recorded in an execution journal with privacy controls. The browser is never the automation execution host.

## 3. Graph contract

```text
AutomationRevision:
 id
 definition_id
 schema_version
 name
 trigger_nodes[]
 nodes[]: {id, type, config, input/output ports, per-node retry policy}
 edges[]: {from.node, from.port, to.node, to.port}
 defaults: {concurrency, timeout, maximum_steps, resource_limits}
 creator, created_at, release_note
```

**Node categories**

| Class | Mandatory 1.0 nodes | Important constraints |
|---|---|---|
| Trigger | entity change, numeric threshold, device event, schedule, sunrise/sunset, manual, authenticated webhook | Never start from a read-only diagnostic event unless explicitly allowed. |
| Condition | equals/inequality, numeric comparison, between, AND/OR/NOT, presence, time window, entity available | Strong type checks, unit and null semantics. |
| Action | set device state, execute scene, local notification, set scoped variable, call allowed action | Every physical command authorized and recorded. |
| Control | branch, delay, wait until, bounded repeat, stop | No unbounded loops; timers persisted. |
| Diagnostic | log sanitized marker and trace annotation | Secrets and sensitive presence details redacted. |

Permissions and device capabilities validated both at **publish time** and **run time** because permissions/devices can change.

Graph validation checks unique IDs, edge existence, port/type compatibility, impossible ranges, dead-end dangerous actions, connected components, cycles, max fanout, unbounded loops and unsupported integrations. Branching should use explicit true/false/unknown routes when a condition reads unavailable device state.

## 4. Trigger semantics

### Entity state change

Options: from, to, for-duration, edge detection, stable transition, only-availability-change. Distinguish a new event with same value from a genuine state transition.

### Numeric threshold

Compare normalized numeric values and units; optional hysteresis (enter threshold vs exit threshold), stable time window, cooldown. E.g. temp > 25 °C for 5 min, reset only < 24 °C. Incorrect unit and null values must not cause a trigger.

### Time and schedule

Store civil schedule + IANA timezone, next run in UTC. Explicit rules for DST:
- Nonexistent wall time (spring): default **skip**, alternative run at next valid time.
- Repeated wall time (autumn): default **once**, alternative twice (explicit opt-in).
- Missing execution due to service outage: default **do not retroactively replay**; selected safe notifications may catch up within bounded window.
- Monotonic timer for active delays where possible; persist wake_at UTC for restart.

### Sun events

Require verified site latitude/longitude and timezone; user's location is not inferred or automatically uploaded. Handle polar/no-event days explicitly. Local calculation uses tested library.

### Webhooks

Random unguessable secret or signed request, expiration/rate-limit, auth checks and payload schema; never accept unauthenticated WAN triggers by default.

## 5. Execution model

- Each trigger starts a run pinned to an immutable revision.
- Each step must have stable execution ID and row in `automation_step_runs`.
- Use transactional ledger/outbox for side effects; track driver dispatch and observed confirmation separately.
- All work has per-run max step count, max parallelism, duration/timeouts and global fairness quotas.
- Resume after crash only from checkpointed safe nodes.
- Guarantee **at-least-once internal event processing**, not magical exactly-once delivery to real devices.
- Non-idempotent actions (toggle, unlock, siren, dispense) **must not auto-replay** after uncertain completion; return `outcome_unknown` for manual review where needed.
- A set-state action may be retried with stable idempotency key only if supported and safe for the target.

## 6. Concurrency modes

| Mode | Behavior | Example |
|---|---|---|
| single | Ignore subsequent qualifying triggers while one run active | Floodlight timeout |
| restart | Cancel previously running flow, then start latest trigger when safe | Presence light with delay |
| queue | Bound waiting triggers and process FIFO; drop/reject beyond capacity with metrics | Notification sequences |
| parallel | Allow bounded concurrent executions; enforce command conflict policy | Multiple independent sensors |

Default simple-mode automation: `single`, explicit warning if actions could conflict. Global rate limit per site/entity (e.g. no unbounded toggling); actual values set after hardware tests.

### Conflicting physical commands

Conflict resolution proposal: explicit priority (manual override > safety guard > automation, customizable), per-entity dispatch queue, expiry of superseded desired-state commands. Do not automatically infer that all manual commands override automated routines forever; define temporary override duration and UI display. An `unlock` action cannot be silently superseded or retried by convenience logic.

## 7. Safety policy

- Locks, garage doors, alarm controls, heating limits and other high-risk device classes require extra scopes and an explicit automation risk disclosure.
- Failure to read a mandatory condition defaults to **fail closed** unless configured with a reviewed safe fallback.
- Unavailable targets cause per-action failure, not fabricated success.
- Time-based safety and heating must respect device-local fail-safe capabilities where relevant.
- Automations may not run arbitrary shell or system commands in 1.0.
- Integration plugins cannot bypass the command-dispatch permission and audit path.
- Emergency and professional life-safety use is out of scope: no certification claims.

## 8. Variables and expression language

Scoped variables: run, automation definition (persisted with explicit transaction) and site read-only context. Strong types: boolean, decimal+unit, string (bounded), timestamp, duration, enum, list (bounded), object with strict schema.

Use declarative operators only; no eval, arbitrary JS, Python injection or network calls. Expression preview shows expected result on sample values. Treat missing/unavailable values as three-valued logic where appropriate; never coerce unknown to false without making that visible.

## 9. Simulation and debug

- **Dry-run:** synthetic events + snapshot of selected entity states; outputs a hypothetical trace and list of commands that **would** be issued. No physical command ever sent.
- **Trace:** trigger ID, revision ID, evaluated inputs (redacted where needed), branch result, duration, error code, per-action device outcome and time of observed confirmation.
- **Replay for diagnostics:** safe read-only simulation of stored input events; no live action replay.
- **Version history:** compare two revisions, rollback to previous definition by publishing as a new revision (no mutation of historic definitions).
- **Alerting:** high repeated-failure rates, muted due to quota, missing devices or disabled integrations.

## 10. Sample acceptance scenarios

1. Motion on → lamp set_on → delay 120s → lamp set_off; renewed motion uses `restart` to extend delay, no rapid flicker.
2. Temperature over threshold for 5 minutes activates ventilation once; hysteresis prevents chatter.
3. Zigbee device renamed while flow enabled: stable entity ID remains.
4. A sensor becomes unavailable: mandatory numeric condition does not evaluate as zero.
5. Service crashes after action send but before acknowledgment: no duplicate physical toggle on reboot.
6. Zigbee2MQTT repeats a retained message: no duplicate state-change trigger by default.
7. Autumn repeated 02:30 local time executes once by default; spring missing 02:30 skips and is journaled.
8. Forbidden guest invokes automation directly through API: denied.
9. Editing a running automation does not change execution of its pinned revision.
10. Simple-mode rule can be rendered in advanced editor with identical semantics.
11. Cycle without bounded repeat is rejected with visual location of offending edge.
12. Dry-run reports every planned physical effect but makes zero real MQTT/Matter calls.

## 11. Implementation sequencing and proof

1. Type schema + validation + immutable revision storage.
2. In-memory evaluation on simulated events with test fixtures.
3. Durable run journal and timer persistence.
4. Safe capability-aware command integration via Dispatcher.
5. Simple wizard compiling to graph.
6. Advanced node editor + accessible textual equivalent.
7. Replay/simulation traces and performance tuning.
8. Real device acceptance; publish support limits.

Do not implement UI before the graph and command semantics have been reviewed: a beautiful node editor connected to undefined runtime semantics is not a completed automation feature.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [API-CONTRACT.md](API-CONTRACT.md), [TEST-RELEASE.md](TEST-RELEASE.md).
