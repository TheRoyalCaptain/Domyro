# Domyro — REST and realtime API contract

**API-001 · Planning draft 1.0 · 2026-10-30 · No code authorized**

## 1. API design principles

Domyro has an independent local API. All network and protocol specifics are normalized behind server-side capability-aware resources.

- Root `/api/v1`; JSON responses and requests; OpenAPI 3.1 generated from runtime-validated schemas.
- Authenticated WebSocket at `/ws/v1`; no separate direct browser-to-MQTT or browser-to-Matter connection.
- Server validates permissions for every resource, field and action. Client-side hidden UI controls never substitute for authorization.
- All IDs opaque. Machine timestamps RFC3339 UTC; site timezone named in IANA format.
- Explicit `null`, `unknown`, `unavailable` and missing fields have distinct semantics.
- Stable error codes, localization keys, trace IDs, status and optional retry metadata.
- Site-scoped access in every query; never infer the site from an untrusted resource ID.
- Sensitive writes, integrations, login and commands are rate-limited. Public WAN exposure is not the default.

## 2. Endpoint inventory

| Method | Endpoint | Purpose | Minimum access |
|---|---|---|---|
| GET | /api/v1/health/live | Non-sensitive liveness | local probe / hardened |
| GET | /api/v1/health/ready | Safe readiness, minimal output | local probe / hardened |
| GET | /api/v1/system/info | App/schema/api version, enabled capabilities | authenticated |
| POST | /api/v1/setup/bootstrap | One-time local admin setup token exchange | trusted local during initialization |
| POST | /api/v1/auth/login | Authenticate and start session | login rate limited |
| POST | /api/v1/auth/logout | Revoke active session | authenticated |
| GET | /api/v1/auth/me | Caller, sites, role and permission summary | authenticated |
| GET | /api/v1/sites | Visible sites | signed-in member |
| GET/POST | /api/v1/sites/{siteId}/areas | List/create rooms | resident read / manager write |
| GET | /api/v1/sites/{siteId}/devices | Paginated search/filter of devices | resident |
| GET | /api/v1/sites/{siteId}/devices/{deviceId} | Device metadata and owned entities | resident |
| GET | /api/v1/sites/{siteId}/entities | Query entity state/capabilities | resident |
| GET | /api/v1/sites/{siteId}/entities/{entityId}/state | Observed, quality and availability | resident |
| GET | /api/v1/sites/{siteId}/history | Bounded time series, page/cursor | authorized reader |
| POST | /api/v1/sites/{siteId}/commands | Validate and send desired action | permitted controller |
| GET | /api/v1/sites/{siteId}/commands/{commandId} | Command outcome and reason | caller or admin |
| GET/POST | /api/v1/sites/{siteId}/scenes | Browse/create scene | resident read / manager write |
| POST | /api/v1/sites/{siteId}/scenes/{sceneId}/execute | Dispatch scene and record partial results | permitted controller |
| GET/POST | /api/v1/sites/{siteId}/automations | Browse/create rule/flow definitions | resident read / manager write |
| POST | /api/v1/sites/{siteId}/automations/{id}/validate | Static capability/schema check | manager |
| POST | /api/v1/sites/{siteId}/automations/{id}/publish | Publish immutable revision | manager |
| GET | /api/v1/sites/{siteId}/automations/{id}/runs | Run trace list with cursor | privileged manager |
| GET/POST | /api/v1/sites/{siteId}/integrations | Browse/configure instances | admin |
| GET | /api/v1/sites/{siteId}/integrations/{id}/health | Connection diagnostics | admin |
| GET/POST | /api/v1/sites/{siteId}/dashboards | Configured dashboards | per-dashboard permission |
| GET | /api/v1/sites/{siteId}/notifications | User-visible notification inbox | authorized viewer |
| GET | /api/v1/admin/backup | Backup jobs and status | owner/admin |
| POST | /api/v1/admin/backup | Create local encrypted backup job | owner/admin with step-up |
| POST | /api/v1/admin/restore/validate | Non-destructive validation of upload | owner/admin with step-up |
| POST | /api/v1/admin/restore | Restore via controlled maintenance mode | owner/admin with step-up |

This is a contract proposal. Unimplemented endpoints may not be advertised as supported in early 0.x releases. API documentation must include request and response schemas and supported feature flags.

## 3. Command request and result

Example request shape (illustrative documentation only):

```json
{
  "entity_id": "018f0000-0000-7000-8000-000000000001",
  "action": "set_on",
  "arguments": { "on": true },
  "client_request_id": "user-generated-random-key"
}
```

API should also accept an `Idempotency-Key` header. Choose one canonical transport for dedup in the final OpenAPI contract rather than maintaining two independent idempotency sources.

Proposed response:

```json
{
  "command_id": "018f0000-0000-7000-8000-000000000999",
  "status": "accepted",
  "observed_state_changed": false,
  "correlation_id": "opaque-trace-id"
}
```

**202 Accepted** means command is queued/accepted for dispatch, **not** physically completed. Query command status or subscribe to events for `sent`, `confirmed`, `sent_unconfirmed`, `failed` or `expired`. A device driver that only reports a publish success must not claim physical confirmation.

Command error cases:
- 400 invalid JSON/field types;
- 401 unauthenticated;
- 403 forbidden action or resource;
- 404 unknown or concealed resource;
- 409 conflict, disabled entity or concurrency policy;
- 410 explicit expired operation reference where appropriate;
- 422 capability/argument out of supported range;
- 429 rate limit;
- 503 unavailable integration/broker or maintenance mode.

Never include credentials, raw sensitive provider payloads or internally resolved integration secrets in an error.

## 4. Error envelope

```json
{
  "error": {
    "code": "ENTITY_UNAVAILABLE",
    "message": "The device is not currently available.",
    "translation_key": "errors.entity_unavailable",
    "retryable": true,
    "details": {},
    "correlation_id": "opaque-trace-id"
  }
}
```

Use one stable unique code per error class. Message is informational and may change; clients must branch on code, not language text. Unexpected internal errors return generic external detail and log sanitized internal traces.

## 5. Pagination and filtering

- All list endpoints accept `limit` with documented safe max (proposal: 100) and opaque `cursor`.
- Filtering by site, area, entity type, integration, availability and search term is bounded.
- History requires `from`, `to` and one or more authorized entity IDs; max time span and result count enforced.
- Response includes `items`, `next_cursor` or null, and optionally `server_time`.
- High-volume history should use stable ordering with timestamp+unique ID, not offset pagination.
- Requested CSV export runs as an audited job; no unlimited direct-response exports.

## 6. WebSocket handshake and subscriptions

1. Client authenticates using short-lived session-associated token or same-site session with cross-origin/CSRF-safe handshake checks.
2. Client sends protocol version and requested site subscriptions.
3. Server authorizes each subscription, sends `snapshot` plus monotonic subscription cursor / watermark.
4. Server streams `entity.state_changed`, `device.availability`, `command.updated`, `automation.run_updated`, `notification.created` and relevant registry updates.
5. Client acknowledges cursor / reconnects with last seen cursor where supported; server either replays bounded deltas or commands fresh snapshot.
6. Revocation of permissions/session closes or narrows subscriptions immediately.
7. Heartbeat, backpressure and max subscription limits prevent slow clients exhausting server memory.

Representative envelope:

```json
{
  "event_id": "opaque-event-id",
  "type": "entity.state_changed",
  "site_id": "opaque-site-id",
  "subject_id": "opaque-entity-id",
  "occurred_at": "2026-10-30T00:00:00Z",
  "sequence": "opaque-subscription-cursor",
  "correlation_id": "opaque-trace-id",
  "payload": {
    "observed_value": true,
    "quality": "known",
    "available": true
  }
}
```

`sequence` is a stream cursor, not guaranteed across unrelated sites or protocol sources. Server may send access-filtered payloads by client. Client always revalidates pending command status after a reconnect.

## 7. Caching and concurrency

- Entity observed state HTTP cache must not falsely mask realtime updates. Supply ETag/version where suitable.
- Configuration edits use `If-Match` / row version to prevent last-writer-wins data loss.
- `POST` commands are not retried blindly by browser; retry only with stable idempotency key and allowed semantics.
- Scene execution returns individual target results (success/failure/unconfirmed); partial outcome is not displayed as total success.

## 8. Authentication and dangerous actions

Password+session with possible MFA; OAuth/SSO federation can be added later without changing entity IDs. Local bootstrap must not be reachable from a remote untrusted network during setup. CSRF defense for cookie-authenticated mutations, secure SameSite cookies, origin validation for WS, trusted-proxy controls and strict transport policy.

Lock operations, disarming alarm, installing unsigned integrations, restoring backups, modifying remote-access keys and deleting users require extra scopes, reauthentication or confirmation. The entire action remains audited.

## 9. Compatibility and developer policy

- `/api/v1` is externally documented; breaking semantics require major version or explicit compatibility migration.
- Schema evolution: additive optional fields allowed; avoid silently changing numeric units or supported enum behavior.
- SDK/plugin API is versioned separately from external REST API.
- API reference generated from checked-in schema after approval; contract tests for all high-risk endpoints.

## 9A. API boundaries fixed by D-40..D-52 (proposed contract)

The current API remains independently accessible from IP:port, working LAN mDNS name and configured reverse-proxy/custom-domain routes. Reverse proxies require explicit trusted source config plus secure WebSocket Origin/Host validation; no new public Internet endpoint is enabled implicitly.

- **Service installation (D-41):** native Ubuntu-only privileged management actions `list_supported`, `inspect`, `install_managed`, `connect_existing`, and `defer_optional`. All writes require authenticated admin step-up and an allowlisted operation, not arbitrary executable command input. If a service is mandatory (such as a working database), API validation blocks an unusable configuration.
- **Plugins (D-44):** query metadata-only update availability from catalog; initiate a separate user-authorized asset download; initiate a separate user-authorized install with another permission/compatibility confirmation. Status must never describe a metadata check as an installed update.
- **Backups (D-45):** backup-policy read/update returns count targets `daily:7, weekly:4, monthly:12`, destination IDs, verification state, retention action preview and per-destination result. Prevent cross-destination deletion on failed jobs.
- **Automations (D-46):** each automation revision stores `missed_run_policy` (`skip | catch_up | confirm_before_catch_up`) and limits; a pending catch-up approval API must enforce expiry, current permission checks and non-idempotent action safety. Events show recovered/skipped/expired status with occurrence IDs.
- **Recovery (D-47):** recovery codes may be consumed only through a guarded credential-reset workflow; console recovery is a privileged **local host operation**, not an unauthenticated REST or WebSocket endpoint. No default network master token or universal password.
- **Multi-site and linked servers (D-42):** all 1.0 endpoints remain site-scoped to one installation. A future federation API uses mutually authenticated installation IDs, explicit sharing scope and revocation; do not expose non-working cross-install linking endpoints as stable 1.0.
- **Dashboards / flows / energy (D-48/49/52):** the 1.0 API must support template-based layout editing, restricted typed automation graph revisions, and real numeric energy history. Camera endpoints and first-party hosted remote-relay API are **not 1.0 requirements**.
- **Localization (D-50):** 1.0 public text localizations NL and EN; `de-DE` extension after 1.0 without changing error codes or schema fields.

Any feature not implemented in 1.0 must be absent or clearly version/capability-gated in OpenAPI and runtime feature discovery.

Full owner requirements: [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 10. Acceptance scenarios

- Guest cannot read forbidden entity via direct GET or WS subscription.
- Admin command returns accepted, UI pending, then confirmed or timed out based on observable hardware.
- Two simultaneous dashboard edits produce explicit conflict, not silent overwrite.
- Lost websocket delta causes snapshot reconciliation.
- Expired session cannot keep receiving sensitive home event data.
- Request and error validation returns stable codes in Dutch and English UX.
- 250-entity state event burst does not lose events silently; backpressure makes limits explicit.

References: [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [AUTOMATION-ENGINE.md](AUTOMATION-ENGINE.md).
