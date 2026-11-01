# Domyro — Device, protocol and integration strategy

**Planning baseline 1.0 · 2026-10-29**

## 1. Protocol priorities

**P0 / 1.0:** generic MQTT, Zigbee2MQTT and OHF Matter.js Server based Matter Controller; a documented tested matrix of device classes, not all devices.

**P1 / 1.x:** Home Assistant read-only/limited temporary bridge for migration, Philips Hue local API, IKEA DIRIGERA, Shelly, ESPHome and broader MQTT discovery. Priority order after 1.0 may move if migration testing requires specific supported devices.

**P2:** Z-Wave JS, UniFi status, BLE, ONVIF/RTSP, Modbus, direct Zigbee, selected local media and solar/energy adapters. **P3:** KNX, vendor-dependent clouds, broader device-specific SDKs.

Matter/Thread is not identical to Zigbee; Thread devices need an existing Thread border router with functioning IPv6 routing.

## 2. Generic MQTT adapter

- Reuse an existing broker or **offer native Ubuntu admin UI installation/configuration/management of an optional local Mosquitto broker** with explicit permissions. In containers connect to existing broker/service or opt-in hosted sidecar as platform allows. See [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md).
- MQTT 3.1.1 and MQTT 5 subject to tested capability matrix, TLS+client authentication, broker reconnect and retained message handling.
- Configurable topics and typed value mappings: state, command, availability, attributes; JSON/boolean/numeric/text parsing and normalization.
- Validate topic patterns, wildcards, values, payload sizes, allowed action values and ranges.
- Safe publish semantics: idempotency only for state-setting operations, do not blindly replay a generic \"toggle\".
- Deterministic availability for heartbeat/last-seen; import/export YAML/JSON mappings after their schema is specified.
- No default anonymous broker exposed to LAN/WAN.

Proof: switch simulated using local broker AND real smart device; value read, action, response, broker restart, retained state and permission denial tested.

## 2A. M2 early implementation (2026-11-01)

The repository now contains an **explicit opt-in read-only localhost MQTT.js subscriber**, a limited Zigbee2MQTT bridge/device/state observer keyed by stable IEEE address, a disposable real MQTT broker protocol test, and a separate site-scoped PostgreSQL registry (migration v3) tested against an isolated PostgreSQL database. The transport **never publishes** messages, does not control Zigbee hardware or pair devices, and does not auto-create browser-visible devices. Real credentials/TLS, trusted site assignment UX, live DB persistence wiring, device compatibility and physical acceptance tests remain unimplemented. This is not approval to access the owner's operational broker. See [MQTT-READONLY-FOUNDATION.md](MQTT-READONLY-FOUNDATION.md).

## 3. Zigbee2MQTT adapter

Zigbee2MQTT retains sole ownership of its coordinator and Zigbee mesh. Domyro subscribes to broker topics and controls devices via the published Zigbee2MQTT MQTT API.

- Consume bridge/info, bridge/devices, bridge/groups, bridge/event and friendly-name state topics.
- Prefer IEEE address as stable binding; friendly_name is user-editable and MUST NOT be the sole identity key.
- Map device exposes/access properties into Domyro entity capabilities: sensor, on/off, brightness, color, color temperature, battery, climate and occupancy where supported.
- Preserve vendor-specific attributes as typed diagnostics without inventing capabilities.
- Zigbee2MQTT availability is opt-in and semantics differ for battery vs powered devices; show quality and last-seen independently.
- Publish to friendly-name/set where command capability allows it; verify state from incoming messages.
- Pairing UI triggers short permit_join request and explicitly closes on cancel/timeout.
- Handle renames, device joins/leaves, groups, health and temporary coordinator disconnects.
- Never run simultaneous network ownership with direct Zigbee on one coordinator.

**Hardware pilot:** Sonoff Zigbee Dongle-E, a mains-powered lamp or plug, battery temperature sensor and button. Use existing mesh non-destructively until explicitly approved; no forced resets or migrations.

Reference: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html

## 4. Matter adapter

Use the Open Home Foundation Matter.js Server as an isolated service, communicating over its versioned WebSocket interface with @matter-server/ws-client. Protocol-server state is not the Domyro device registry; map its node/endpoint/cluster IDs to Domyro devices and entities.

- Support a standalone Matter fabric owned by Domyro; no accidental sharing of another controller's credentials.
- Commission via supported numeric/QR manual code flow, with proper lifecycle/error handling.
- Use multi-admin sharing for devices already in Apple/Google/Home Assistant fabrics when permitted by the device.
- Support tested Wi-Fi and Thread-over-border-router devices. Validate mDNS, IPv6, multicast, firewall and network interface selection.
- P0 device classes: on/off light or plug, dimmable light, temperature sensor, occupancy sensor and thermostat only after successful E2E hardware validation.
- Clusters not implemented show \"not supported\" rather than silently do nothing.
- Broker/container service startup, recovery and controller storage are treated as independent lifecycle tasks.
- Sensitive fabric keys are backed up encrypted; documented restore is required before 1.0.
- Never expose the Matter service WebSocket to the public internet.

Reference: https://github.com/matter-js/matterjs-server ; https://www.home-assistant.io/integrations/matter

## 5. Device capability normalization

Entity families initially: light, switch, sensor, binary_sensor, number, select, button, climate, cover, lock, fan, media_player, camera and alarm_control. Inclusion in schema does **not** imply 1.0 driver coverage.

Every capability has a typed contract: read/write, native range/unit, normalized range, enum values, source key, protocol owner, last update, availability, optional transition time and confirmation strategy.

Drivers must declare: supported protocol/server versions, device mappings, permissions, async discovery, command/write support, telemetry streams, retry safety, health test, configuration schema, migrations and settings validation.

Each mapping has fixture data and unit tests; never rely purely on display labels.

## 6. Home Assistant bridge and migration

- Optional and disabled by default; credentials stored encrypted and scoped.
- Initial bridge: read entities/states from authenticated WebSocket API, import compatible area/device metadata where available, possibly a non-destructive read-only mirror.
- Do not issue simultaneous commands through Domyro bridge and native adapter without explicit ownership selection.
- Prevent feedback loops using source tags/correlation IDs and mirrored-state read-only policy.
- Migration candidates evaluated per entity; mappings are previewed and confirmed; unresolved platforms remain on HA until supported.
- Avoid claiming full conversion of Lovelace dashboards, arbitrary YAML automations, proprietary integrations or historic measurements.
- User-controlled revoke/disconnect/cleanup; no automatic decommissioning of HA installation.

Reference: https://developers.home-assistant.io/docs/api/websocket/

## 7. Integration SDK and distribution

**SDK API (planned):**
- manifest: integration_id, version, api_range, developer, license, source, checksum, supported platform, lifecycle permissions, network destinations;
- actions: discover, configure, start, stop, health, list_devices, observe, execute, reconfigure, unload;
- declarations: device/entity capabilities, config schema, secret fields, requested permissions, user-visible explanations;
- events: typed envelopes and structured errors; no direct DB access.

**Distribution:** trusted built-in drivers / curated signed catalog / sideloaded third-party artifact. Catalog publication requires provenance, malware scan, license review, compatibility check, basic permission review, at least one functional test. Ratings or popularity alone are never security indicators.

**Isolation:** executable plugins outside core in restricted processes or containers with non-root identity, read-only filesystem where possible, resource quotas, explicitly allowed device/network access and no Docker socket. Platform-specific isolation guarantees differ; high-risk permissions require owner approval. Sideloading displays a prominent disclosure of potential full-home impact. Untrusted plugins are never treated as genuinely harmless because of a checkbox.

**Updates (owner D-44):** automatically check plugin release metadata for new versions (user can disable checks); both **download and install are manual administrator actions**, and installation includes D-26 explicit consent/version/permission preview. Version lock, compatibility negotiation, rollback plan, signed catalog release and reapproval for expanded permissions. A failed third-party plugin must not block startup or unrelated integrations.

## 7A. Owner decisions on third-party installation and protocol direction

**D-26:** Every plugin installation requires a new, explicit authorized administrator confirmation, regardless of source. The UI displays publisher/origin, version, relevant permissions, potential network/device access and trust checks. Enabling a catalog does NOT authorize unattended plugin installs. **D-44 has now resolved the update policy:** automatic checks of trusted metadata are allowed, but downloading and installing plugin releases are separate manually confirmed actions. No background plugin binaries may be staged by update checking.

**D-34:** Keep external Zigbee2MQTT support permanently available while developing a **native Zigbee coordinator** in a later phase. Show all protocols together in one Domyro UI and allow the owner to choose internal vs external protocol services once proven stable. Never concurrently claim the same radio, change mesh ownership without consent or assume every Zigbee device can migrate without repair. This is a long-term interoperability commitment, not a requirement to create a direct Zigbee stack in compact 1.0.

**D-28 / D-27:** Document ONVIF/RTSP camera adapters and energy/solar/battery/EV adapter contracts as approved extensions. Camera streams, local recording and EV actuation require separate permissions, media storage and safety policy. Specific device/charger support must be confirmed in a compatibility matrix.

**D-33:** Fully local voice is a later integration target. Voice processing and local-device permissions cannot depend on a mandatory hosted AI provider.

See [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md) and [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 8. Compatibility matrix minimum

Track per device: manufacturer, model, firmware, protocol, transport adapter, feature list, tested date, commissioning method, result (supported/partial/unsupported), caveats, test environment, regression fixture. CI exercises recorded fixture data; real-device hardware verification complements it.

## 9. Required interoperability tests

1. Broker offline/restart and stale-state recovery.
2. Zigbee device rename: device UUID and history unchanged.
3. Retained state on subscription: correct baseline without false physical command.
4. Battery sensor with delayed check-ins: not wrongly treated as powered device.
5. Unsupported Zigbee exposes: safe read-only information.
6. Matter pairing, multi-admin and commission rollback.
7. Matter IPv6/mDNS fault: actionable diagnosis.
8. Matter service restart: all unrelated devices still work.
9. No duplicate physical command when events are replayed.
10. Integration plugin crash and upgrade with permission change.
