# Domyro — Installation platform, managed services and backup targets

**INFRA-001 · Owner product decisions D-14 through D-21 · 2026-10-30**  
**State:** Requirements approved by project owner; exact implementation architecture pending G0. Documentation only, no application code.

## 1. Confirmed owner decisions

| ID | Confirmed requirement | Boundary |
|---|---|---|
| D-14 | Domyro must install and run directly on an **Ubuntu Server installation originating from the Ubuntu Server ISO**, either **bare metal** or in a **virtual machine**. | The same supported native installation package/installer should cover both; document virtualization USB/radio passthrough. |
| D-15 | Container deployments connect to separately available supporting services (e.g. MQTT broker, Zigbee2MQTT, Matter controller) as needed; a supported native Ubuntu install must let the administrator **install, configure, manage, update and maintain required supporting services through Domyro's admin UI**. | Services are installed only by explicit administrator action using a narrow privileged management helper; no hidden ownership of pre-existing services. |
| D-16 | The project must be **Matter-ready despite the owner currently having no Matter hardware**. | Build protocol integrations, simulated/fixture/contract tests and onboarding; hardware claims require real device validation before marking fully supported. |
| D-17 | The stack choice is to optimize **stability, reliability and performance**, with evidence-based technical evaluation. | Proposed TypeScript/Node.js/React/PostgreSQL architecture remains a proposal until explicit G0 decision. |
| D-18 | Native Ubuntu installation should begin with **one command** launching a full, secure installer. | Interactive confirmations and browser onboarding are acceptable; installer itself should handle dependencies, identities, persistence, services and recovery. |
| D-19 | Multiple sites/homes, households and granular permissions per site/room/entity/user must be supported. | UI plus all APIs, WebSocket feeds and commands must enforce server-side isolation. |
| D-20 | Backup destinations must include **local disk**, **SMB/NAS**, **FTP** and **directly attached USB sticks/external drives**. | Add FTPS and SFTP as strongly recommended secure alternatives; plain FTP only after explicit security warning and opt-in; no silent formatting or remote credential leaks. |
| D-21 | **Finish as much detailed design/specification as practical before writing application code.** | G0 implementation gate stays closed; these owner decisions are not permission to start coding. |

The prior D-13 remains unchanged: Domyro application releases may be checked/downloaded automatically according to user policy, but **never installed automatically**. Updates of underlying Ubuntu OS are out of scope.

## 2. Supported native Ubuntu Server architecture

- Source installation: official Ubuntu Server ISO; VM and physical installation are equally valid targets.
- **Both x86-64 (amd64) and ARM64 (arm64) are required native 1.0 architectures** on Ubuntu Server LTS. Exact LTS release numbers and representative ARM64 hardware still require test-matrix approval. Debian support is not automatically part of this requirement.
- Native Domyro server/web and supporting components run as distinct systemd services and restricted users. Native mode cannot secretly require Docker/Podman.
- The installer gives the owner a **separate decision for PostgreSQL, optional local Mosquitto, Zigbee2MQTT and Matter.js Server**: install/manage, connect existing, or defer when optional. No 'install everything' silent shortcut; the core database must be provisioned or connected.
- The installer checks OS support, CPU/RAM/disk, existing ports, local interfaces, privilege, conflicting services and the availability of third-party repositories/packages before changing anything.
- Existing MQTT/Zigbee2MQTT, other Home Assistant setups or Matter controllers must never be overwritten, stopped, reconfigured or migrated automatically.
- Virtual machine docs cover USB Zigbee pass-through, network discovery/mDNS/multicast, IPv6 and Thread border router setup; not every hypervisor/network mode supports these features equally.

## 3. One-command installation, responsibly

Goal: one command copied from the official signed installer release/installation page starts the full installation workflow on a fresh supported Ubuntu Server host.

**Security contract:**
1. Use a trusted vendor-controlled repository/package or a verified, pinned and signed bootstrap artifact. No anonymous unverified `curl | sudo bash` as the default recommended instruction.
2. Show version, requested privileges and which system packages, ports, services and paths the installer will touch.
3. Perform preflight and print a proposed action summary. Require approval before package/service changes; offer non-destructive dry-run.
4. Create service user and directories, configure package/runtime versions, set up or connect the database and create tightly scoped service managers.
5. Provision Domyro, verify signed artifact and database migrations, install systemd unit(s), boot startup, log and backup location.
6. Print the local onboarding address, and keep initial administrator activation bound to trusted local setup.
7. A failed installation preserves pre-existing services and produces actionable diagnostics; safe resume/retry and documented uninstallation are mandatory.

One command means *one entry point*, not one magic step with no privilege checks, errors or decisions.

## 4. Admin UI: managed dependency services

**System → Services** is a first-class administrative screen for native Ubuntu installations. Represent at least:

| Service | Native management | Alternative |
|---|---|---|
| Domyro Core / Web | installed with Domyro; status/logs/manual update | none |
| PostgreSQL | managed compatible service or connect existing | external PostgreSQL |
| Mosquitto MQTT broker | install/configure/manage from UI when authorized | existing LAN/remote broker |
| Zigbee2MQTT | install/manage when a compatible Zigbee coordinator is selected | existing Zigbee2MQTT via MQTT |
| OHF Matter.js Server | install/manage for Matter readiness | compatible separately hosted service |
| Supporting plugins | install only if explicit permission and compatibility satisfied | external standalone integration |

**Per service actions:** discover, install, set up, start, stop, restart, check version, view logs/health, check/download signed update, **manually install after confirmation**, set maintenance status and safely remove (data retention separately confirmed).

Services owned by external tools show “extern beheerd” and must not offer invasive controls unless the user explicitly converts to Domyro management. A native-only privileged agent uses allowlisted systemd/package operations, per-service entitlement checks, command argument validation, no arbitrary shell execution and an audited consent path. Do not expose an unrestricted root shell or Docker socket in the web API.

**Potential conflict requiring explicit policy decision:** Does D-13 manual-only installation also apply to dependency services? Recommendation: yes, all managed component updates require explicit manual installation; unattended checks/downloads may be configured independently. This is a suggested safety rule, NOT inferred owner approval for third-party service lifecycle.

## 5. Container and Umbrel deployments

- Containerized Domyro connects to an existing MQTT broker over a network, or the documented optional broker container is part of the compose stack when the operator explicitly chooses it.
- Zigbee2MQTT stays the exclusive radio coordinator when used. Device passthrough must be configured by host/platform capability.
- Matter uses a compatible standalone Matter.js service and requires supported IPv6/mDNS/Thread connectivity.
- Container/Umbrel screens show externally managed services and supported health/configuration actions; they do not claim to own the underlying host's package manager.
- Umbrel installs and app upgrades remain under its official app manager. No unsupported behind-the-scenes update of Umbrel container images.

## 6. Matter-ready without current hardware

Before 1.0 Matter support should be designed and unit/contract/simulator tested:
- Dedicated Matter.js Controller service setup, persistent controller/fabric data, WS connection and capability normalization.
- Commissioning UI for QR/manual codes, network diagnostics (IPv6, mDNS, Thread border router), graceful failure/cleanup, secure fabric key backup.
- Simulated device nodes to test state/action WebSocket flows and error handling.
- A **real-device test gate** on at least one supported Matter Wi-Fi (or Thread with border router) lamp/plug plus a supported sensor device class before claiming real-world compatibility. Where hardware cannot be obtained, release notes must label functionality experimental/unverified and cannot mark the corresponding hardware gate passed.

A user's lack of Matter hardware is not a request to buy devices or bypass validation.

## 7. Backup targets and protocol security

### Backend types

| Backend | Planned support | Requirements |
|---|---|---|
| Local path | P0 | Allowlisted writable paths, quota/space check and owner-set retention. |
| USB flash drive / external HDD or SSD | P0 | Detect/mount with explicit target selection; UUID-based stable mount where possible, disk presence warnings, no autoformat, safe unmount and clear unplug-state recovery. |
| SMB/CIFS share (NAS) | P0 | SMB3 with encrypted transport where available; credentials encrypted locally, mount/session isolation, permission and reachability test. |
| FTP | P0 by owner requirement | Support plain FTP only with explicit opt-in and prominent warning that credentials/data can be exposed; NEVER default it for sensitive backup content. |
| FTPS | P0 recommended | Require TLS and certificate validation; no silent fallback to plaintext FTP. |
| SFTP over SSH | P0 recommended (evaluate schedule) | Host-key verification and private-key or password security; separate protocol from FTPS. |
| Optional future S3/WebDAV | P1 | Versioning and encrypted off-site snapshots. |

### Shared backup workflow

- Destination test with free space, credentials, encrypted connection capabilities and write/read-back check.
- Encrypted archive by default, versioned manifest, checksum and documented recovery secret management.
- Local staging in protected temp area; stream/copy to destination; verify remote size/hash before marking success.
- User-selectable backups: manual, scheduled, retention (count/time), rotation and storage health alerts; **default 7 daily, 4 weekly and 12 monthly** verified restore points, adjustable per destination. Backup rotation must not delete the last healthy verified set due to a failed NAS/USB/FTP write. **Backups are different from software updates** and can be scheduled without violating D-13.
- Do not put plaintext backup secrets, FTP passwords, SMB passwords, SSH keys, Matter fabrics or LAN shares in public GitHub data.
- On disconnect, USB/SMB/FTP failure must not trigger deletion of healthy backups or pretend the remote copy succeeded.
- Restore wizard checks integrity, decryptability, application/schema version and potentially unsafe re-pair scenarios before modifying live state.
- Provide a restore-from-blank-server runbook for each supported target.

### Recommendation for security

Since Domyro backup archives include sensitive household metadata and controller credentials, encrypt files **before transfer**. Even then, plain FTP reveals credentials and metadata and is unsafe on untrusted networks; FTPS and SFTP are recommended. This preserves the user's requested FTP support without pretending that unencrypted FTP is a good default.

## 8. Reliability and performance choice process

Explicit technology-selection scorecard (measure on a realistic baseline):
- 30% correctness and reliability under restart/outage.
- 20% security and stable maintenance lifecycle.
- 20% latency/throughput/memory on x86_64 and ARM64.
- 15% cross-platform native/Docker/Umbrel deployability.
- 10% ecosystem/device protocol interoperability.
- 5% long-term developer productivity.

Candidates for server implementation should include TypeScript/Node.js, Go, Rust or Python (or justified hybrid). Compare on measurable benchmarks and maintainability, not language popularity. A proposed stack remains provisional until owner sign-off; no major migration after prototype without ADR.

## 9. Multisite and permission constraints

- Installation may include multiple sites (homes/buildings); residents can belong to multiple sites with different roles.
- Site owner can create households, rooms and floors and assign access down to entity/action where needed.
- Session/WS scope and backup/export respect site separation; accounts are not automatically global administrators in every site.
- Future optional **separate Domyro-server pairing/federation** should not require a cloud account for local use; every linked instance can operate standalone and must explicitly grant/revoke connection scopes.

## 10. Acceptance tests

1. Install from one trusted command on new supported Ubuntu Server ISO, bare metal and VM.
2. Installer detects incompatible services, reports actions and safely exits with no destructive change.
3. Admin chooses existing MQTT broker **or** authorized installation of Mosquitto; Domyro can view logs and health.
4. Admin can install/configure/read state of Zigbee2MQTT/Matter server via supported native service manager, with all privileged changes confirmed.
5. A service marked external cannot be stopped or upgraded using Domyro UI without explicit take-over approval.
6. All Domyro upgrades remain **manual install**, even when auto-downloaded.
7. Encrypted local, USB, SMB and FTPS backups restore correctly from a clean host; plain FTP path requires explicit insecure acknowledgment.
8. Matter simulator tests pass without hardware; public compatibility claim depends on real hardware testing.
9. Multi-site guest cannot read entity, presence history or backup details belonging to another site.
10. Browser-admin package/service operations cannot execute arbitrary commands.

## 11. Open follow-up choices

- Exact Ubuntu LTS supported versions and CPU architectures.
- Which managed third-party services may be auto-downloaded but never auto-installed (recommended).
- Should Domyro offer system monitoring of Ubuntu status without ever changing host OS packages? (Recommended limited read-only view.)
- Whether original FTP without TLS is allowed at all (the owner asked for FTP; it is provisionally opt-in with risk warning).
- Which managed backend version constraints/pinning and user-visible service removal/data retention semantics are acceptable.

Cross-reference: [DEPLOYMENT.md](DEPLOYMENT.md), [INTEGRATIONS.md](INTEGRATIONS.md), [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md), [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md), [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md), [G0-READINESS.md](G0-READINESS.md).
