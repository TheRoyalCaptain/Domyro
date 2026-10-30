# Domyro — First real-device pilot and hardware acceptance

**PILOT-001 · Draft 1.0 · 2026-10-30 · planning only**

## 1. Purpose

Demonstrate an independent Domyro device-control stack using real hardware **without removing or resetting an existing Home Assistant, Zigbee2MQTT, Apple Home or Matter installation**.

An early demonstration is successful only if Domyro itself maintains identity, current state, commands, real-time client updates and event trace through independent protocol connections. A screenshot, mocked device UI or Home Assistant proxy controlling the entire workflow does not satisfy milestone M2.

## 2. Candidate existing test environment (to verify in person)

Prior project context suggests:
- Sonoff Zigbee 3.0 Dongle-E managed by Zigbee2MQTT.
- Existing Zigbee2MQTT MQTT broker, topic base and one supported light/plug.
- Existing Zigbee sensor that reports temperature, humidity or battery.
- Home Assistant as an existing separate HAOS VM, kept operating normally.
- IKEA DIRIGERA as a future compatibility candidate, not automatically a coordinator or Matter test device.
- Linux + Docker/Umbrel machines suitable for lab testing, subject to actual CPU/RAM/host-network verification.

**All specific device model/firmware IDs, network addresses, passwords, broker version, dongle firmware and Matter device choices remain UNCONFIRMED**. Never infer them from old configuration or collect secrets into GitHub.

## 3. Pilot boundaries

Allowed **after formal G0 approval and explicit execution approval**:
- Read Zigbee2MQTT bridge capabilities and devices with limited MQTT credentials.
- Register supported device/entity identities in Domyro.
- Subscribe to telemetry and show truthful state and last-seen.
- Prompt owner to choose one safe lamp/plug for a limited on/off test.
- Recover after controlled Domyro server restart and broker reconnect.
- Pair a **separate** new Matter test device using a new Domyro fabric, or explicitly authorized multi-admin commissioning.

Not allowed without fresh owner consent:
- Reset coordinator, delete pairing records, change Zigbee channel/network key, take over radio USB, restart existing Home Assistant or Zigbee2MQTT services, change existing production automations, unpair critical devices, or flash firmware.
- Automatically unlock doors, operate heating/garage machinery, trigger alarm sirens or control other high-risk equipment.
- Publish identifiable home metadata, serials, device addresses, passwords, Matter commissioning codes or network diagrams in the public repository.

## 4. Planned lab topology

```text
Browser / Domyro PWA
    ⇅ REST / WS (local, authenticated)
Domyro Core + PostgreSQL
    ├── MQTT client → existing MQTT broker → existing Zigbee2MQTT → Sonoff Dongle-E
    └── Matter WebSocket client → standalone Matter.js Server → separate Matter test device
Existing Home Assistant remains independent and observes the same device states only if compatible.
```

**Coordination rule:** Zigbee2MQTT is the only Zigbee coordinator owner. The Matter fabric is owned by the Domyro Matter server, not shared through a copied controller identity. Existing Matter devices may join Domyro via multi-admin after user approval when supported.

## 5. M2 Zigbee2MQTT + MQTT acceptance script

### P1. Environment discovery (read-only)

- Show broker endpoint and connection health with credentials redacted.
- Show Zigbee2MQTT bridge version and base topic, adapter information and number of discovered devices.
- Show device stable IEEE identity only in local authenticated admin UI; export to public test fixtures in anonymized form.
- Discover published exposes and create appropriate light/switch/sensor entities with correct units.

**Pass:** no pairing changes, no duplicate entity IDs, no Home Assistant control dependency.

### P2. State truth and control

- Open an entity detail on phone/desktop.
- With owner confirmation, toggle one safe lamp/plug from Domyro.
- Show command accepted/pending and later observed confirmation (or explicit unconfirmed).
- Change same device using its physical control or existing controller; Domyro UI reflects externally observed change.
- Repeat with Zigbee2MQTT unavailable: no fake success.

**Pass:** a real physical change and accurate UI reporting, all logged with correlation ID.

### P3. Sensor and stale behavior

- Display temperature/humidity/battery or other actual exposed sensor properties and units.
- Restart Domyro server, verify entity IDs and history survive.
- Restart only a dedicated test broker where authorized; otherwise simulate connection loss from Domyro side.
- Mark quality `stale/unavailable` on the actual driver-defined timing; don't assume battery sensors publish heartbeat frequently.

**Pass:** stable identity, sane quality status, no false zero samples, no data loss from normal restart.

### P4. First scene / automation

- Owner selects safe entity.
- Rule: on an authorized test trigger, set target to a known state with explicit cooldown.
- Show execution trace and prevent repeated side effects from retained MQTT messages.
- Disable rule and confirm it stops creating new runs.

**Pass:** one expected physical effect and one attributable trace per actual qualifying trigger.

## 6. M3 Matter acceptance script

- Preflight IPv6, LAN mDNS/multicast and server/controller storage.
- Select one low-risk supported Matter Wi-Fi or Thread device; Thread requires suitable border router.
- Pair via commissioning code or authorized multi-admin flow; no reset of a production fabric.
- Register stable node and endpoint identities, including expected capabilities.
- Read current physical state and issue a safe supported action.
- Restart Matter server and verify persistent controller identity, with clear recovery guidance if device unavailable.
- Test failed commissioning/timeout: no ghost device in UI.

**Pass:** independent controller can reattach and control a real device, or failure is fully reported and remains documented as unresolved blocker. No generic claim of complete Matter device coverage.

## 7. Evidence checklist

- [ ] Exact test hardware model, firmware and test topology documented privately.
- [ ] Redacted logs and step timestamps exported.
- [ ] Screenshots/video show real UI action and real hardware response without identifying location.
- [ ] API/WS contract test results linked.
- [ ] Broker reconnect and Domyro restart passes.
- [ ] Data model retains identity after friendly name change.
- [ ] Permissions and non-idempotent action tests pass.
- [ ] Test operator signs off; real home network unchanged except explicitly authorized test actions.

## 8. Ownership of test secrets and fixtures

Keep private inventory and protocol credentials **outside the public repository**. Public test fixtures must substitute anonymous addresses/IDs. Do not commit real Matter fabric secrets, QR pairing codes, broker usernames/passwords, local IPs or MAC addresses.

## 9. Next test inventory to collect after G0

- Which exact Zigbee lamp/plug can safely be switched.
- Which exact battery/mains Zigbee sensor to read.
- Broker identity/version and whether separate test broker should be used.
- Matter Wi-Fi/Thread test device available and whether Thread border router exists.
- Which host is the pilot instance (Docker, native Debian/Ubuntu or Umbrel).
- Whether the user wants test automation to run only within a fixed supervised time window.

Reference: [INTEGRATIONS.md](INTEGRATIONS.md), [DEPLOYMENT.md](DEPLOYMENT.md), [TEST-RELEASE.md](TEST-RELEASE.md).
