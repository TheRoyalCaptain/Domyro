# Domyro M2 preparation: read-only Zigbee2MQTT over real MQTT

**Status:** development integration proof. The MQTT subscriber works against an **ephemeral MQTT broker in CI**, not a real Zigbee device. **Not a full device adapter or a supported installation.**

**D-53:** owner-server installation is still strictly blocked. Nothing in these files connects to, installs, configures or changes the owner's broker, Home Assistant or Zigbee coordinator.

## Implemented

- `src/integrations/mqtt-preview-config.mjs`: **explicit opt-in only**, requiring `DOMYRO_MQTT_READONLY=1`, a **loopback-only** `mqtt://127.0.0.1:<port>` or `mqtt://localhost:<port>`, and a validated base topic (default `zigbee2mqtt`). Credentials, query parameters, non-loopback IPs and WAN hosts are rejected by this development adapter. Future production network/TLS credentials require a separate audited implementation.
- `src/integrations/zigbee2mqtt-mqtt.mjs`: an actual MQTT.js v5 client using MQTT protocol version 3.1.1. Subscribes to the configured `base/#` topic, handles disconnect/reconnect, resubscribes, and **never publishes** any MQTT message, including pairing or command requests.
- `src/integrations/zigbee2mqtt-observer.mjs`: consumes Zigbee2MQTT bridge state, device inventory and supported state topics. Maps devices by the **stable IEEE address**, not mutable friendly names; ignores unsupported/unknown devices, invalid/oversized messages, `/set`, `/get` and administrative request topics. Handles friend-name changes without duplicating devices. Tracks broker/bridge offline separately and distinguishes observed live values (`confirmed`), broker-retained values (`stale`), and disconnected (`unavailable`). Never interprets a publish as a device-control confirmation.
- `scripts/mqtt-inspect.mjs`: **manual, short-lived** development-only command for a deliberately configured local isolated MQTT broker; prints sanitized device identities and which observation keys have been seen. It does not write to the broker or expose a browser-facing device API.
- Tests in `tests/zigbee2mqtt-observer.test.mjs`, `tests/zigbee2mqtt-mqtt.test.mjs` and `tests/zigbee-repository.test.mjs` verify topic hygiene, invalid data, stable identity after rename, offline behavior, **an actual wire-level MQTT connection to an isolated Aedes broker**, and separately durable site-scoped database behavior. The test ensures the observer sends **zero messages** to the broker.

## Isolated test command ONLY (not for the owner's server)

Inside a disposable developer VM with a test broker already running on the same machine:

```bash
DOMYRO_MQTT_READONLY=1 \
DOMYRO_MQTT_URL=mqtt://127.0.0.1:1883 \
DOMYRO_Z2M_BASE_TOPIC=zigbee2mqtt \
npm run mqtt:inspect -- --observe-seconds=3
```

The command **does not install or start** Mosquitto or Zigbee2MQTT, does not enable MQTT pairing or control, and cannot use a remote broker. It only subscribes briefly to the local test broker.

**Do not run this against the owner's operational broker or existing Zigbee2MQTT mesh yet.** Later non-destructive tests using real hardware require separate authorization and device-permission review.

## Still missing before actual hardware use or 1.0

- **New, partially completed:** database migration `003_zigbee_registry.sql` plus `zigbee-repository.mjs` now give the **internal** observer a stable, **explicitly site-scoped PostgreSQL device/observation registry**, with owner/admin authorization to register an integration, no implicit device deletions, rename-safe IEEE identity and chronological observation updates. PostgreSQL integration tests verify cross-site isolation. **Not yet wired to live MQTT stream or exposed through a permissioned user UI**; the observer is still an ephemeral in-memory transport until an approved integration is deliberately associated with a site. Secure encrypted broker configuration and complete restart recovery remain missing.
- Secure connection to an existing LAN broker with optional username/password, TLS verification and certificate pinning as appropriate. No production connection credentials or secrets storage is implemented.
- Detailed `exposes` capability parsing, all availability semantics, unsupported device diagnostics, proper reconnection/replay and time-zone/last-seen quality behavior.
- Authorized site-scoped command dispatch, a real **write-capable** adapter, command deduplication and independent observed-state confirmation. Device actuation remains **disabled**.
- A Zigbee2MQTT version/device compatibility matrix, real Sonoff Dongle-E, switch/plug and battery-sensor tests, rename/disconnect/restart/re-pair recovery.
- Matter.js service/commissioning, an operational account-secure dashboard, complete Ubuntu one-command installer, verified database backup/restore and safe update/rollback workflow.

This is a real read-only protocol transport verified in software, not proof of a safe live smart-home controller.

References: [INTEGRATIONS.md](INTEGRATIONS.md), [INSTALL-UPGRADE-GATE.md](INSTALL-UPGRADE-GATE.md), [ROADMAP-BACKLOG.md](ROADMAP-BACKLOG.md), [Zigbee2MQTT MQTT topics](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html).
