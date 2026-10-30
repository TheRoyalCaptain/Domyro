# Domyro — Security, privacy and operational policies

**Planning baseline 1.0 · 2026-10-29**

## 1. Threat model

Assets: home device control, locks/security equipment, network topology, location/presence, credentials, tokens, Zigbee coordinator secrets, Matter fabric keys, logs, user accounts, history, backups and integrations.

Threat actors: malicious LAN client, stolen browser session, exposed reverse proxy, compromised extension, compromised marketplace maintainer, unsafe plugin, malicious MQTT publisher, stolen backup, compromised CI/dependency and authorized but overprivileged account.

**Trust boundaries:** browser↔API; server↔DB; server↔MQTT broker; server↔Matter service; core↔plugin runtime; installation↔optional remote relay/catalog; admin↔guest. Any new boundary requires an ADR and risk review.

## 2. Identity and roles

- First admin bootstrap is single-use and restricted to trusted local setup; no default passwords.
- Passwords Argon2id with published parameter guidance; optional passkeys and TOTP, with strong MFA mandatory for future hosted remote service.
- Secure HttpOnly/SameSite cookies, token rotation, logout/revoke, idle/absolute session expiration and login abuse controls.
- Permission checks on every REST/WS action, event feed, entity attribute and history result.
- Roles owner/admin, manager, resident, guest and service token; site, area, device and action scopes.
- Sensitive actions such as unlock, alarm disarm, install plugin, change trusted remote settings and restore backup demand step-up authorization or reauthentication as appropriate.
- Administrative audit entries track actor, action, result, target and timestamp; redact secret values.

## 3. Cryptography and secrets

- TLS for non-loopback/untrusted connections; explicit localhost dev exceptions.
- At-rest secret encryption with unique instance key generated on install; key rotation and restore behavior documented.
- Encrypted backup contains secrets only after explicit owner consent and supported key transfer/restore procedure.
- No credentials in logs, crash dumps, metrics labels, support exports, URLs or browser local storage.
- Matter fabric credentials treated as critical cryptographic state.
- Dependency vulnerability scanning, signed artifacts, immutable image digests and SBOM at public releases.

## 4. Remote access plan (post-1.0 feature gate)

Local control works without any Domyro-hosted service. Initial supported remote documentation explains owner-managed VPN / HTTPS reverse proxy with modern TLS and recommended MFA. Public port forwarding is not an onboarding requirement.

The optional Domyro Remote proposal:
1. Owner opts in on the local controller and authorizes device/account pairing.
2. Local connector initiates outbound encrypted communication to a relay with authenticated clients.
3. Relay transports encrypted application payloads; design aims for genuine end-to-end protection of command content between authenticated client and local controller, not a plain relay that decrypts everything.
4. Authentication and authorization remain enforced by the **local** Domyro Core; relay cannot confer device permissions.
5. No relay access when opt-out or local disconnect; no dependence on relay for local automations.
6. Establish key provisioning, rotation, recovery, session revocation, NAT traversal, metadata minimization, incident response and third-party security review before implementing or advertising E2EE.
7. Honest fallback if E2EE goals cannot be proven: do not market transport encryption alone as end-to-end security.

**Explicit:** there is no remote-access implementation or cloud infrastructure in the planning repository.

## 5. Plugin permissions and supply chain

- Plugins declare exact network host patterns, device types, secret requirements, files and local discovery needs.
- No arbitrary code runs in Domyro's privileged core process.
- Third-party plugin containers run non-root, with bounded CPU/memory, minimal capabilities and separately permitted network access; capabilities vary by host OS.
- Disable/upgrade/quarantine workflows for vulnerable or abandoned plugins.
- Verify publisher provenance, source checksums, signatures and reproducible packaging when feasible.
- Side-loading supported, but it grants significant trust; user sees risks and must explicitly authorize.
- Plugin permission expansions require new approval.
- Independent plugins and combined derivatives need license review; GPL/AGPL obligations depend on integration and distribution, not solely on folder layout.

## 6. Data privacy

Default: local data storage, no cloud telemetry, no ads, no embedded third-party analytics. Explicit consent for diagnostics upload and any cloud feature. Privacy settings control retention, exports and purge.

Default retention proposals (adjustable by owner):
- high-frequency raw sensor measurements: 30 days;
- downsampled aggregates: 365 days;
- automation execution traces: 30 days;
- system diagnostics: 14 days;
- security audit entries: 90 days;
- optional media/camera recordings: **not enabled in 1.0**.

Use per-class retention policies, DB partition pruning and storage pressure warnings. Avoid promises of perfect deletion in immutable offline backups; document backup expiry.

## 7. Backup, restore and disaster recovery

Owner-required targets: **local disk, directly attached USB/external drives, SMB/CIFS NAS, and FTP**; offer secure FTPS and SFTP. Plain FTP, if enabled, must have an explicit warning and never be default. Encrypted backups must be verified after writing to each destination. External/missing media cannot be formatted or silently deleted. See [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md).

Native Ubuntu's privileged dependency-service manager must use tightly scoped allowlisted operations, signed artifacts, authenticated explicit admin confirmation and audit logs; it must not expose arbitrary system shell access through Domyro.

Backup scope: DB consistent snapshot, installation config, integration settings, encrypted secrets, automation revisions, dashboard definitions, protocol-specific matter controller credentials and recovery metadata. Zigbee2MQTT coordinator backup is a separate optional operation and may not be supported by every adapter; do not silently imply it is included.

Format: versioned manifest with schema/app versions, platform, encryption method, checksums and portable archive. Default backups encrypted using owner-held passphrase or well-documented recoverable mechanism. Restore must validate archive, hashes, versions, resources and permissions before replacing live state.

Test scenarios: clean installation restore, backup corruption, wrong passphrase, incompatible schema, missing plugin, missing radio, lost Matter keys, same hardware vs new host. Offer safe dry-run restore validation and documented stop-service sequence. A rollback always checks DB compatibility first.

Policy: daily local backup configurable, rolling 7/30-day retention, owner-managed off-host export; no hidden mandatory upload. Suggested RPO <=24h under daily configured backups; RTO goal <=60min for documented clean restore on reference platform, explicitly non-guaranteed.

## 8. Updates and runtime operations

- Semantic versions, signed release assets/image digests, verified dependency and installer sources.
- Release channels: stable and beta (later nightly); beta requires opt-in.
- **No automatic Domyro installation or restart**, including for security releases. Auto-check and auto-download are distinct user controls; download delay choices include immediate, 12h, 24h, 72h, 7d and a custom delay. Installing is a new privileged user action, never implied by a downloaded file.
- Native systemd periodic job may only check signed metadata and download/verify artifacts as unprivileged process; cannot launch package installs or restarts. OS updates remain outside Domyro's control.
- Preflight checks: free disk, DB version, protocol server compatibility, backup age, plugin API versions, migration strategy.
- Health gate after restart; safe rollback using backup if data migration incompatible.
- Native Linux package and Umbrel app upgrades follow platform support rules; no silent permission escalations. Umbrel's App Store remains authoritative for upgrades, without unsafe bypass for a custom Domyro downloader; see [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).
- Versioned logs and support packages with secrets redacted.
- Administrative screen shows integration status, uptime, last backup, last successful update, disk and DB health.

## 9. Safe automation requirements

- Deny unsafe commands when permission context is missing or entity is unavailable unless explicit override flow is authorized.
- Scene partial failures reported, never presented as fully applied.
- Rate-limit actions and loops; record actor and automation origin.
- Dangerous targets require explicit consent and narrowed scopes.
- Critical real-world safety functions must not rely exclusively on this hobbyist/community software.
- Cloud/AI-driven commands never bypass local permissions or step-up controls.

## 10. Security release gates

Before public beta: run threat model workshop, auth tests, access-control integration tests, secret-redaction tests, SAST/DAST/dependency scans, plugin isolation tests and backup-encryption validation.

Before 1.0: verify build provenance, reproduce image builds where feasible, publish SECURITY.md vulnerability reporting, test update/recovery, negative permission tests on REST and WS and document default security headers, CORS, CSRF and trusted proxies.

References: https://owasp.org/www-project-application-security-verification-standard/ ; https://www.gnu.org/licenses/gpl-faq.en.html
