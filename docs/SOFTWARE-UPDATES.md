# Domyro — Software release discovery, download and installation policy

**UPD-001 · Owner-approved product policy · 2026-10-30**  
**Status:** requirements fixed; implementation details subject to G0 architecture sign-off  
**Scope:** Domyro application releases only; NOT updates to Linux/umbrelOS, firmware, Zigbee coordinator, PostgreSQL distribution packages or unrelated applications.

## 1. Non-negotiable rule

**Domyro must NEVER automatically install a Domyro application update or restart its services as a result of automatic update discovery/download.** Installation requires an explicit, fresh decision by an authorized local owner/admin for every new release. This applies even if the release is a security fix or an opted-in beta. A download is NOT consent to install.

The user can control **checking for new releases** and **downloading release files** independently. By default, installation is manual. Postponement (12h/24h/7d) applies to when Domyro may **download** a release, never to a timer that installs it.

The product should always distinguish:
- `update_available` — a newer verified version was discovered.
- `scheduled_for_download` — waiting until user-defined release age.
- `downloading`, `downloaded` — a verified artifact is staged, **not installed**.
- `awaiting_install_approval` — user must click Install/Update and confirm.
- `installing` — only after explicit action, not a background policy.
- `installed` — resulting running version verified via health checks.
- `failed`, `unsupported`, `blocked` — with actionable reasons.

## 2. User-configurable preferences

| Setting | Values | Default |
|---|---|---|
| Check for releases | Manually / automatically | Automatic **checks only**; no downloading by default |
| Download new releases | Manual / automatic | Manual |
| Automatic download delay | As soon as eligible, 12 hours, 24 hours, 3 days, 7 days, custom duration | 24h when automatic download is enabled |
| Update channel | Stable / Beta | Stable |
| Eligible updates | Latest supported patch/minor within compatibility policy; incompatible major versions shown but never auto-downloaded | Compatible only |
| Network | Allow any network / limit bandwidth / optional approved window | Unrestricted only when explicitly enabled |
| Notifications | App notification and optional configured push/email | In-app notification |
| Installation | **Always manual with explicit confirmation** | Manual, cannot be changed |
| Restart | Only in an explicitly approved installation workflow | Never because of a download |

Custom delay must be positive, bounded and documented. Suggested range 0–30 days in 1-hour increments; values may be expanded after user research. Changing delay/channel recalculates eligibility without restarting or modifying installed binaries.

If automatic checks are disabled, Domyro must not issue periodic GitHub release requests; manual check remains available. Download settings cannot secretly enable extra telemetry or remote access.

A security advisory can warn prominently that an urgent update exists and suggest acting sooner; **it cannot bypass the no-auto-install rule** or reduce a user-set download delay without consent.

## 3. Scheduling semantics

- Use trusted signed release metadata including immutable version, release ID, original publication timestamp `published_at`, channel, target platforms/architectures, immutable asset digests, signature and compatibility constraints.
- Compute `eligible_at = published_at + chosen download_delay` in UTC.
- If the instance is offline when eligibility occurs, retry downloading on the next successful scheduled check; never backdate or automatically install.
- Normal default polling: every 6 hours when enabled, with jitter, conditional requests / rate limit awareness; actual cadence is configurable in future.
- Exclude drafts, withdrawn, malicious, untrusted and unsupported versions. Stable never receives prereleases.
- For `latest`, choose newest eligible supported stable release, not blindly the most recently pushed tag.
- Download retry with bounded exponential backoff; avoid multiple concurrent downloads.
- User may click **Download now** irrespective of selected automatic delay; still never installs.
- When no files can be downloaded safely or platform controls updates itself, show status and the platform’s manual update instructions instead of implying staging succeeded.

## 4. Security and storage

- All releases originate from official @TheRoyalCaptain authorized GitHub Releases and/or a separately signed immutable manifest. A GitHub tag alone is not a trustworthy update artifact.
- Verify authenticity (signature/key trust) AND integrity (SHA-256 or stronger digest), exact platform/architecture, allowed version transitions, and expected distribution channel before marking downloaded.
- Use a nonprivileged download process to a protected staging directory; no execution, no package scripts, no service restart while staging.
- Sanitize file names and reject path traversal, redirects to untrusted hosts, oversized artifacts and insufficient storage.
- Display expected size, download progress, verification status, changelog, compatibility warnings and publisher identity.
- Per-install storage quota, cancellation, cleanup of stale downloads and a user-triggered purge; never silently remove backups to make space.
- Persist update choices locally; include them in encrypted backup where appropriate.
- User-initiated install requires authenticated, privileged authorization and a separate confirmation that mentions downtime, required backup and DB migration risks.
- After install, run health checks and offer recovery/rollback. Never claim rollback possible when migrations or Matter key changes are incompatible.

## 5. Platform-specific behavior

### Native Debian / Ubuntu (mandatory P0)

- Implement a local release-check/download agent with nonprivileged `systemd` service + timer, or equivalent least-privilege scheduled process.
- A dedicated restricted staging directory holds signed packages/downloads. The timer performs ONLY metadata fetch and optional download+signature verification.
- It never invokes `apt upgrade`, `dpkg -i`, executes an installation script, touches `systemctl restart` or changes system packages on its own.
- The authenticated admin can request a **manual install** from Domyro UI (or a documented CLI) with fresh confirmation and narrowly scoped privileged helper. All actions audited.
- Native Linux OS update settings (apt unattended-upgrades etc.) remain outside Domyro; Domyro does not change or disable them.
- Installing Domyro dependencies and schema migration only happens as part of approved explicit installation.

### Docker Compose (mandatory P0)

- An enabled checker may fetch metadata and stage immutable signed OCI image artifacts into Docker's local image store **only if a reviewed pull-only operation and appropriate host permissions are safe**.
- Automatic downloading/pulling must never execute `docker compose up`, recreate containers, change image pins, restart services, prune volumes or run migrations.
- Because exposing a Docker socket gives extensive host privileges, never mount a broad Docker socket in a standard Domyro container to achieve automated pulls. Use an external narrow update helper or provide manual pull guidance.
- When automatic image staging cannot be implemented safely, show available versions and a manual Download/Update workflow rather than weakening security.
- Only an explicit owner action can trigger the controlled Compose deployment upgrade.

### Umbrel / umbrelOS (mandatory P0)

- Umbrel remains the authority for **installing and upgrading** Umbrel-managed app containers. Domyro must not circumvent the App Store or independently replace the Umbrel-managed image.
- A new GitHub Release is **not assumed** to be immediately published as an Umbrel App Store update; official release pipeline must update the app manifest/image references and version in compatible app-store metadata.
- Show current version and update availability where the platform exposes it, and direct the owner to the Umbrel App Store's manual update action. Domyro cannot promise independent artifact downloads or custom download-delay settings if Umbrel does not expose an officially supported download-only mechanism.
- If a future Umbrel API provides trusted download-only staging, Domyro may implement the same user-controlled delay, with a capability-guarded UI; no auto-install.
- Do not modify umbrelOS, other applications, the host update policy or underlying firmware.

## 6. UI requirements

Settings → System → Software-updates:

1. Running version, target channel, last successful check, latest eligible release, download status.
2. Toggles for automatic **checks** and automatic **downloads**, separately.
3. Download-delay selector: now, 12h, 24h, 72h, 7 days, custom.
4. `Check now`, `Download now`, `Cancel download`, `Delete downloaded files` where platform supported.
5. `Install update`: always an explicit button with details, backup/compatibility preflight and confirmation. Never a scheduled installation switch.
6. Release notes, publisher/signature verification, available disk and estimated downloaded size.
7. Per-platform support and constraints shown honestly, especially Umbrel-managed updates.

Changing check/download preferences is an admin operation; initiating an install additionally requires explicit authorization, an audited confirmation and appropriate owner rights.

## 7. Example scenarios and required tests

- Automatic download set to 12h: at 11h59 no download, at/after 12h only download; installed version stays the same.
- Download set to 24h and power lost for 48h: once online, download may proceed; **no restart/install**.
- Delay set to 7d, manual Download now at day 1: stage only, install remains separate.
- Automatic checks off: no periodic GitHub traffic, and manual check works.
- Stable selected: no beta candidate offered for automatic download.
- Security update classified critical: notification, never bypass install confirmation.
- Forged/unsigned release asset: verification fails, update not offered for installation.
- Storage low, digest mismatch, network outage: fail safely, preserve running version.
- Native Linux unattended timer: no package manager invocation or service restart even after successful download.
- Docker download: no container recreation, pin change or Docker socket leak.
- Umbrel: Domyro does not alter application image outside Umbrel; correct App Store manual update path.
- Owner changes delay to manual while download pending: cancellation/retention choice is explicit; no automatic installation.
- Explicit manual install: backup preflight, privilege validation, release notes and a visible confirmation before any interruption.

## 8. Release engineering dependencies

The GitHub release pipeline publishes immutable signed assets/manifests and a version feed; only @TheRoyalCaptain authorizes official releases. Native package and optional Docker download-only adapter must verify publisher and digest; Umbrel packaging follows the current compatible app-store publication process.

## 8A. Distinction from plugin installation (D-26)

The owner additionally requires **manual confirmation of every plugin installation**. This is a separate product decision from Domyro core software update checking/downloading (D-13). Do not assume the core's optional automatic downloader grants permission to download or install plugin updates. Policies for plugin-update checking/downloads remain **unanswered**, while plugin installations are explicitly manual. See [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md).

## 9. Decisions fixed vs. still to validate

**Fixed by product owner:** no automatically executed installation/restart, control over check/download, delayed downloads and manual install authority.

**Open technical details:** supported scheduling resolution, native signed .deb/update-helper design, secure Docker download-only implementation, safe Umbrel metadata/API integration, specific release signature scheme and stable/beta release channels.

Cross-references: [DEPLOYMENT.md](DEPLOYMENT.md), [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md), [PRODUCT-UX.md](PRODUCT-UX.md), [ROADMAP-BACKLOG.md](ROADMAP-BACKLOG.md), [G0-READINESS.md](G0-READINESS.md).
