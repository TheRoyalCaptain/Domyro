# Domyro — Deployment, packaging and operations specification

**DEPLOY-001 · Planning draft 1.0 · 2026-10-30**

> Three installation families are required for the first officially supported stable Domyro release: Docker Compose, **native Linux without Docker**, and Umbrel. **Ubuntu Server ISO installed bare metal or as a VM is the primary native platform.** A verified one-command installer must handle dependencies and onboarding, and the native administrative interface must support installation/management of required auxiliary services. See [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md). No installer scripts or runnable containers are authorized until G0 sign-off.

## 1. Cross-platform service architecture

Common logical services:
- Domyro server (API, state, automation, integration manager).
- Domyro web assets served by a minimal HTTP frontend or Domyro's backend.
- PostgreSQL (required).
- MQTT broker: external URL first, optional bundled Mosquitto where packaging permits.
- Matter.js Server: separate service with persistent fabric storage.
- Plugin workers: isolated opt-in service model in future releases.

The first-run experience must explain broker choice, local IP/mDNS/IPv6 network requirements, time zone and the need to store credentials/fabric keys securely.

## 2. Support matrix (proposed, not yet hardware-validated)

| Target | Preferred installation | Architecture | Scope |
|---|---|---|---|
| **Ubuntu Server LTS** | **Native without Docker**, bare metal and VM | **x86-64 (amd64) AND ARM64 (arm64), both required and tested** | **P0 / binding D-40** |
| Debian stable | Separate future compatibility evaluation, not a confirmed native 1.0 production target | x86-64/ARM64 TBD | Future / not committed |
| Docker Engine + Compose | Multi-service OCI deployment | x86_64 + ARM64 after CI/hardware test | P0 |
| umbrelOS | Community App Store app package and managed container app | Umbrel-supported hardware tested | P0 |
| Windows/macOS | Docker development only | best effort | Not production supported in 1.0 |
| Raspberry Pi | ARM64 only with adequate RAM and SD/SSD warnings | selected distro/board | Tested subset |
| Proxmox VM | Run supported Ubuntu Server LTS guest ISO | x86-64 or ARM64 as actually virtualized | Guest OS supported, hypervisor support tested separately |
| Domyro OS | own appliance image | TBD | post-1.0 |

Minimum proposed resources for production evaluation: 2 vCPU, 4 GiB RAM, 8+ GiB free persistent SSD space, stable local network; actual spec must follow benchmarks. The existing performance baseline uses 4 vCPU/4 GiB and 250 entities. Matter+Thread and heavy history may demand more resources.

## 3. Docker Compose design

### Planned services

- `domyro-server` with backend process and health endpoints.
- `domyro-web` if separated, otherwise web static files served by server.
- `postgres` with version-pinned image, health check and durable volume.
- `mosquitto` optional, not automatically enabled when user has existing broker.
- `matter-server` optional service for Matter integration; network capabilities and persistent fabric storage required.

### Networking

- API/listening interface accessible on local trusted LAN, not published to WAN by default.
- PostgreSQL never publicly exposed; internal network/Unix socket access only.
- MQTT authentication and TLS required when crossing untrusted networks.
- Matter commissioning requires working IPv6, mDNS/multicast, and host/bridge networking that supports discovery on the actual host.
- Avoid recommending `privileged: true`, `network_mode: host` for all containers or blanket access to `/dev` as universal defaults. Apply only explicitly documented, justified per-service exceptions.
- Optional Zigbee2MQTT coordinator is controlled by Zigbee2MQTT, not shared with Domyro.

### Persistence

Volumes for database, server config/master keys, Matter fabric/controller storage and optional broker config/data. Never store secrets in container images or source repository. Record volume paths in backup manifest.

### Update and restore

Image digests pinned in official release compose file; preflight check DB compatibility, free space, Matter/driver version compatibility, verified backup and rollback possibility. No blind `latest` pin on production docs.

## 4. Native Ubuntu Server LTS design (genuine native, bare metal or VM)

Installation:
1. Detect system distribution and architecture and show compatibility.
2. Install signed packages from a trusted distribution channel or verified downloaded artifacts.
3. Set up dedicated unprivileged `domyro` system user, private data directory and hardened systemd services.
4. **Prompt per supporting service** (PostgreSQL, MQTT broker, Zigbee2MQTT, Matter server): install/manage, connect existing, or defer if optional. Required database must be provided one way or another. Never assume root access to an existing service.
5. Configure instance master key and TLS/loopback defaults.
6. Start backend and show browser-based onboarding URL, without exposing bootstrap over untrusted interfaces.

Directory layout proposal:
- `/etc/domyro/` for non-secret config and restricted secret references.
- `/var/lib/domyro/` for durable state and per-adapter material.
- `/var/log/domyro/` or journald for structured operational logs.
- `/usr/share/domyro/` for static web assets and packaged schema.
- `/run/domyro/` for runtime sockets and ephemeral PID/state.

Service structure: `domyro.service` plus a documented `postgresql.service` dependency; separate Matter service when enabled. Validate actual systemd unit hardening against mDNS/network and USB access; use sandboxing without breaking integrations.

Uninstall behavior: default preserve user data and keys; explicit separate purge option with confirmation and backup/export instructions. Never silently reset a coordinator or Matter fabric.

## 5. umbrelOS delivery

Reference approach: an installable app in a dedicated Domyro Community App Store or an accepted package in the official Umbrel App Store. Proposed app store ID `domyro`, package ID `domyro-core` (**names subject to package-ID validation**).

The community-store template uses:
- `umbrel-app-store.yml` for store name and ID,
- package folder `domyro-core/`,
- `umbrel-app.yml` for app metadata,
- `docker-compose.yml` for services.

Current official app-store guidance emphasizes a complete **browser-first** setup after installation, without requiring SSH or log reading for normal onboarding.

Testing requirements:
- Install, update, restart, upgrade, backup and uninstall in supported umbrelOS.
- App is immediately visible, opens a working browser setup path and persists data on host.
- MQTT to existing broker and bridged discovery work across available umbrelOS networking.
- Matter/mDNS/IPv6 discovery is tested on actual host network topology (not assumed).
- USB/radio ownership is explicit; direct USB passthrough is not automatic.
- No dependency on Portainer or manually edited shell files.
- Failed install has readable error and does not damage other Umbrel apps.

The Umbrel official-store app standard can change; pin the actual tested app packaging format and umbrelOS version at build/release time.

## 6. First-run wizard (all platforms)

1. Detect architecture (amd64/arm64), verified Ubuntu Server LTS version, backend and DB readiness, display service health. On native install, prompt per supporting service to provision/manage, connect externally or defer if optional.
2. Language: NL/EN for 1.0 (German after 1.0), timezone, site/room name, local address selection (IP:port, optional mDNS, optional domain/reverse proxy).
3. Single-use local admin creation; reject remote untrusted bootstrap.
4. Consent/control over diagnostics, data retention and backup approach.
5. Choose existing broker or optional managed MQTT, verify connection.
6. Discover Zigbee2MQTT bridge and show exact devices without pairing/resetting anything.
7. Offer Matter controller setup; preflight IPv6/mDNS and storage before commissioning.
8. Create rooms and default dashboard from discovered supported entities.
9. Verify read-only sensor values and a user-confirmed safe switch/light action.
10. Show backup reminder, installation version, local URL and next steps.

Never indicate “ready” when a protocol backend has not been provisioned. Offline browser cache can show views but not successfully send commands while offline.

## 7. Update policy and risk boundaries

- Stable and beta channels; prerelease optional.
- **Owner-approved requirement:** never automatically install a Domyro update or restart the service. Users control automatic release checks/downloads only, with 0h/12h/24h/72h/7d/custom release-age delay; install always requires fresh explicit owner/admin confirmation.
- Native Linux: nonprivileged service/timer checks for new signed GitHub releases and may stage verified packages; the timer cannot call package installation or restart services. The user starts a separate confirmed install operation.
- Docker: a safe pull-only workflow may stage immutable images without recreating containers or altering running versions; no privileged Docker socket mounted merely to provide this feature.
- Umbrel: the Umbrel App Store owns app update installation. Domyro does not bypass Umbrel to install or pre-download app images; custom download delay is only offered if an official supported Umbrel download-only mechanism exists.
- Domyro update settings never manage Linux/umbrelOS system updates, or other apps.
- A code update does not automatically change Zigbee firmware, coordinator data or Matter device firmware.
- DB migrations are versioned and checked before processing real device events.
- Integration version compatibility check before upgrade; incompatible plugin quarantined.
- Owners are told when a release changes network permissions, radio or key storage requirements.
- Official releases require @TheRoyalCaptain authorization and verified build artifacts.

## 8. Backup/restore per packaging target

Backup artifact includes consistent database dump, config, key material only under explicit encryption policy, dashboard and automation revisions, integrated device metadata and Matter controller state where supported. Zigbee2MQTT coordinator backup is separate unless explicitly integrated and tested for selected adapter.

| Scenario | Expected behavior |
|---|---|
| Docker → Docker | Restore persistent state and DB to clean supported host |
| Native Linux → native Linux | Restore package config, DB, service account permissions and secrets |
| Umbrel → Umbrel | App data persists through updates and restores on clean tested umbrelOS |
| Cross-platform | Allowed only after explicit compatibility validation and key/fabric transfer |
| Missing Matter fabric secret | Show re-commission guidance, never claim nodes will reconnect |
| Missing Zigbee coordinator backup | Never automatically take ownership of existing Zigbee mesh |
| Bad restore password/archive | Refuse change and preserve existing instance |

## 9. Readiness and operator diagnostics

- `/health/live`: process alive, no sensitive topology or config exposure.
- `/health/ready`: DB+core ready; individual adapter status separate to avoid all-platform outage when one protocol down.
- Dashboard reports: DB status, disk warnings, integration status, pending commands, automation error rate, last backup, key availability and software version.
- User-initiated, redacted diagnostic bundle with package manifest and explicit selection.
- All scripts idempotent, installation logs sanitize secrets, clear remediation guidance for DNS/mDNS/IPv6/USB errors.

## 10. First supported release test grid

| Scenario | Docker | Native Linux | Umbrel |
|---|:---:|:---:|:---:|
| First run wizard | required | required | required |
| Existing MQTT broker | required | required | required |
| Zigbee2MQTT read/write | required | required | required |
| Matter commissioning | required | required | required |
| Change IP / restart | required | required | required |
| Backup / encrypted restore | required | required | required |
| Upgrade / rollback | required | required | required |
| Offline after setup | required | required | required |
| Reconnect and logs | required | required | required |

No platform gets the `supported` label until its entire relevant row/column is tested on an explicit version/hardware matrix.

## 10A. D-40..D-52 native installation and network acceptance

- Run the same secure one-command installer on **Ubuntu Server LTS amd64 and arm64**, both on supported bare-metal hardware and VM images; publish explicit package/CPU requirements and failures.
- Support existing service connections and **separate choices per supporting service** during onboarding. Skip is accepted only for optional services; never silently install an unwanted MQTT/Zigbee/Matter dependency.
- Expose local **IP:port** as reliable fallback, advertise `domyro.local` via mDNS where host/network supports it, detect hostname conflict and support custom domain/reverse proxy with correct trusted-proxy/WebSocket/TLS configuration.
- **Separate Domyro servers remain independent** in 1.0. Future linking is opt-in with mutual authorization, encrypted transport and revocation, planned after 1.0.
- Native plugin auto-checker reads metadata only, with **separate manual download and manual install** permissions. The policy for Domyro core releases (optional staged downloads, manual install) remains separate.
- Clean restore on supported platforms preserves user-selected **7 daily/4 weekly/12 monthly** retention, no accidental cleanup across disconnected SMB/USB targets.
- Owner-approved operational boundaries: 1.0 supports NL/EN, no camera system or in-house remote relay, basic energy charts and simple dashboard/visual automation editor.

Read full decisions and tests: [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 11. Open deployment decisions (G0)

- Native package channel: signed .deb packages vs verified install script; **exact Ubuntu Server LTS versions/ARM64 hosts** to support. Debian is not a required native 1.0 target.
- Matter host networking strategy per platform; whether it must run as separate user-managed service on native.
- Installer offers **per-service choice**, including optional managed Mosquitto or external broker; decide exact privilege helper and supported broker versions, not whether to offer the choice.
- Memory/CPU baseline by ARM64 device class, filesystem and backup size limits.
- Initial official Umbrel distribution: own community store first, then upstream submission.

Sources:
- https://github.com/getumbrel/umbrel-community-app-store
- https://github.com/getumbrel/umbrel-apps
- https://umbrel.com/support/apps/how-to-install-an-app
- https://github.com/matter-js/matterjs-server

Related: [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md), [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md), [INTEGRATIONS.md](INTEGRATIONS.md), [TEST-RELEASE.md](TEST-RELEASE.md).
