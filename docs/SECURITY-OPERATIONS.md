# Domyro — Security, privacy and operational policies

**Planning baseline 1.0 · 2026-10-29**

## 1. Threat model

Assets: home device control, locks/security equipment, network topology, location/presence, credentials, tokens, Zigbee coordinator secrets, Matter fabric keys, logs, user accounts, history, backups and integrations.

Threat actors: malicious LAN client, stolen browser session, exposed reverse proxy, compromised extension, compromised marketplace maintainer, unsafe plugin, malicious MQTT publisher, stolen backup, compromised CI/dependency and authorized but overprivileged account.

**Trust boundaries:** browser↔API; server↔DB; server↔MQTT broker; server↔Matter service; core↔plugin runtime; installation↔optional remote relay/catalog; admin↔guest. Any new boundary requires an ADR and risk review.

## 2. Identity and roles

- First admin bootstrap is single-use and restricted to trusted local setup; no default passwords.
- Passwords Argon2id with published parameter guidance; TOTP, planned passkeys and robust account recovery. **D-47** requires both single-use hashed recovery codes and a **trusted local physical/VM-console recovery procedure**, never an unauthenticated LAN/Internet recovery backdoor. Strong MFA mandatory for future hosted remote service.
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

Default data-retention proposals (adjustable by owner). **Backup snapshot default is separately fixed by D-45: 7 daily + 4 weekly + 12 monthly**, configurable and independent of these data-history periods:
- high-frequency raw sensor measurements: 30 days;
- downsampled aggregates: 365 days;
- automation execution traces: 30 days;
- system diagnostics: 14 days;
- security audit entries: 90 days;
- optional media/camera recordings: **not enabled in 1.0**.

Use per-class retention policies, DB partition pruning and storage pressure warnings. Avoid promises of perfect deletion in immutable offline backups; document backup expiry.

## 7. Backup, restore and disaster recovery

Owner-required targets: **local disk, directly attached USB/external drives, SMB/CIFS NAS, and FTP**; offer secure FTPS and SFTP. **D-45 backup default: retain 7 daily + 4 weekly + 12 monthly verified backup points** (owner configurable). Multiple destinations are isolated; a missing/failing target does not authorize pruning the only good backup elsewhere. Plain FTP, if enabled, must have an explicit warning and never be default. Encrypted backups must be verified after writing to each destination. External/missing media cannot be formatted or silently deleted. See [PLATFORM-SERVICES-BACKUPS.md](PLATFORM-SERVICES-BACKUPS.md).

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

## 8A. Security boundaries fixed by D-40..D-52

- **Official native 1.0 OS:** Ubuntu Server LTS amd64 and arm64 (bare metal + VM), with the same authenticated bootstrap and privilege separation; unsupported distro/version must not be silently accepted.
- **First run:** service-by-service installation decisions require explicit local admin authorization, not automatic installation over existing PostgreSQL/MQTT/Zigbee installations.
- **mDNS / proxy access:** `domyro.local` uses local multicast where supported; domain/proxy mode explicitly configures allowed hosts, secure cookie and WebSocket Origin handling, trusted upstream IPs and modern TLS. IP:port remains a local recovery path; never silently expose unrestricted remote access.
- **Future multi-server federation** requires mutual pairing, identity verification, per-site/user scopes, revocation, encrypted transport and no required vendor cloud. Not a 1.0 release requirement.
- **D-44 plugin updater:** automatic *version metadata checks* only, no automatic plugin asset downloading, installation or plugin-triggered restart; manual admin download and another explicit install authorization.
- **D-45 backup retention:** 7 daily, 4 weekly, 12 monthly by default, verified and isolated per destination. Pruning cannot erase unknown user files or the final healthy backup because another destination failed.
- **D-46 missed-run recovery:** a per-automation `skip`, bounded `catch_up` or `confirm_before_catch_up` policy, with strict restriction on non-idempotent/unsafe actions and permission changes.
- **D-47 account restoration:** high-entropy recovery codes plus local console option; scope to the rightful instance and audit/revoke existing sessions upon use.
- **D-51:** owner's own VPN/reverse proxy for 1.0; no Domyro-hosted external-access relay until after 1.0 and separate audited security gate. No mandatory external identity/account.
- Camera video and GPS tracking remain later opt-in/permissioned modules; basic 1.0 energy graphs must respect history and entity access scopes.

Contract: [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 9. Safe automation requirements

- Deny unsafe commands when permission context is missing or entity is unavailable unless explicit override flow is authorized.
- Scene partial failures reported, never presented as fully applied.
- Rate-limit actions and loops; record actor and automation origin.
- Dangerous targets require explicit consent and narrowed scopes.
- Critical real-world safety functions must not rely exclusively on this hobbyist/community software.
- Cloud/AI-driven commands never bypass local permissions or step-up controls.

## 9A. Additional owner-approved security and privacy requirements

**D-37:** Support TOTP authenticator MFA, passkeys using platform authenticators/biometrics when available, step-up authentication for unlock, alarm disarm, backups/restores and other sensitive actions, plus viewing and revoking active sessions/devices. Server verifies credentials and authorization. The application must not store or receive raw biometric data. Scope, recovery and minimum viable release timing for passkeys remain design decisions; a compact 1.0 cannot omit effective security safeguards.

**D-38:** Automated backup schedules (daily/weekly/monthly), controlled retention cleanup, **multiple backup targets**, and automatic integrity verification are all required. Backups to USB/NAS/FTP destinations already specified by D-20 must remain encrypted and tracked per destination. A failed backup to one destination may not corrupt/delete a successful copy elsewhere. An integrity check verifies archive/checksum/decryption when configured, but does not replace full clean-restore testing.

**D-32:** GPS, Wi-Fi and Bluetooth presence are potentially sensitive information; store only minimally required locations/identifiers, require per-person consent, support removal and recording periods, and prevent guests from reading other household members' presence. Manual home/away and motion events must not be treated as proof of personal identity or life safety.

**D-28:** Camera streaming/recording requires authenticated authorized access, encryption in transport where supported, camera-specific retention/recording schedules, bounded disk storage and redacted URLs/credentials. Recording and detection are planned post-1.0 unless separately approved.

**D-26:** **Every plugin installation needs explicit administrator confirmation.** Do not infer that any user's choice authorizes automatic plugin installation. Plug-in update metadata checks/downloads remain open technical/product questions; Domyro core's D-13 manual-only application update rule remains unchanged.

**D-29:** Notifications support configurable priorities, retry policy and privacy scopes; a "critical" label is not a guarantee of push/email delivery.

**D-31:** Machine and device logs/resource metrics and diagnostic exports must be strictly permissioned and redact credentials, secrets, presence history and personally identifying camera/location data.

**D-39:** Public GitHub Issues may accept feature suggestions, but must never substitute for private vulnerability reporting or owner-only official merge approval.

**D-36:** Phase advanced features after the compact 1.0 where needed for stability; minimum security/restore protections are not optional. Full approved feature definitions: [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md).

## 10. Security release gates

Before public beta: run threat model workshop, auth tests, access-control integration tests, secret-redaction tests, SAST/DAST/dependency scans, plugin isolation tests and backup-encryption validation.

Before 1.0: verify build provenance, reproduce image builds where feasible, publish SECURITY.md vulnerability reporting, test update/recovery, negative permission tests on REST and WS and document default security headers, CORS, CSRF and trusted proxies.

References: https://owasp.org/www-project-application-security-verification-standard/ ; https://www.gnu.org/licenses/gpl-faq.en.html
