# Domyro — Product, UX and accessibility specifications

**Planning baseline 1.0 · approval required before implementation**

## 1. Design system

Two coordinated interfaces over the same API:
- **Resident:** a concise, comfortable environment optimized for everyday control, favorites, scenes and rooms.
- **Advanced/admin:** richer views for networks, history, automation debugging, integration errors, backup and updates.

Users choose dark/light/system theme. Responsive breakpoints: narrow phone, medium tablet and desktop/wall tablet. Allow touch, keyboard, mouse and screen reader; no key feature requires hover. Use WCAG 2.2 AA as the target for core workflows. Follow OS reduced-motion preference. Motion must communicate status and never delay device control.

Visual style: simple typography, restrained depth, consistent spacing, good contrast, responsive panels, elegant non-stretched motion and compact information hierarchy. Supply reusable component variants for pending, unavailable, error, active, read-only and permission-denied states.

## 2. Information architecture

Top navigation: **Overzicht**, **Kamers**, **Apparaten**, **Scènes**, **Automatiseringen**, **Historie/Energie**, **Integraties**, **Instellingen**. Advanced/admin subsection: **Systeem**, **Diagnose**, **Gebruikers**, **Back-ups**, **Beveiliging**, **Logs**.

Every entity card shows name, type, room, control/status, availability, pending marker and detailed drill-down. Device detail shows capability-level properties, battery/link health where reported, model/vendor, integration owner, history and last-seen date.

No fake data in production dashboards: unknown sensor data displays \"geen gegevens\" with a timestamp/diagnostic link; devices without brightness do not show a brightness control.

## 3. Screens and acceptance

**First-run wizard:** show IP:port and attempt safe mDNS name such as `domyro.local`, allow own domain/reverse proxy; NL/EN language > admin auth/recovery codes > site/timezone > **per-service** install/connect/defer choices > device connection > room > dashboard template > default backup policy 7 daily/4 weekly/12 monthly. If Zigbee2MQTT is absent, provide a documented \"configure broker\" step, never imply radio was discovered. Pairing is time-bounded and can be cancelled.

**Overview:** customizable tiles, per-user default, 1-tap common scenes, device offline indicator, responsive grid and keyboard reorder alternative.

**Rooms:** 0..N rooms, floor grouping, per-room count, lighting summary and climate measurement. A device may be reassigned without losing history.

**Devices:** live search/filter by type, integration, room, availability, last seen; bulk room assignment; destructive actions require explicit confirmation.

**Scènes:** named set of target states, optional snapshot capture; preview, run status per target, partial failure reporting.

**Simple automations:** plain-language trigger/conditions/actions, time conditions, validation before save, natural NL/EN labels; previews translate to the common graph model.

**Advanced automations:** **1.0 includes simple rules and a safe basic visual flow editor**, nodes/edges, static validation, clear error and basic trace with accessible list equivalent. Rich expressions, nested reusable subflows, complex debugger and live stepping are future features. No hidden auto-reordering of physical commands.

**Integrations:** card with transport, requirements, permissions, maintenance status, configuration, software source, version and remove/repair action.

**Maintenance:** health, error digest, backup/restore, update notes, startup and integration logs, support export with secret redaction. Settings → Systeem → Software-updates explicitly distinguishes automatic **release checks**, automatic **verified downloads**, their delay (now/12h/24h/72h/7d/custom) and **manual-only installation**. Show queued, downloading, verified/staged and awaiting-manual-install states, with visible channel and compatibility warnings. Never include a toggle for automatic installation or scheduled restarts. Umbrel-managed updates link to the Umbrel App Store and hide unsupported download controls. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).

## 4. Modes and permissions

- owner/admin: manage system and users, sensitive integrations, backup and audit;
- manager: configure assigned site, rooms, scenes and approved automations;
- resident: operate authorized entities/scenes and view assigned dashboards;
- guest: limited time/device grants, no integration/config changes;
- service account: scoped tokens, noninteractive, auditable.

Permission granularity: view entity, command specific capability, manage room, edit automation, install integration, view history, export data, admin actions. It is enforced server-side even when controls are hidden client-side. Denied content must not leak through WebSockets or snapshots.

## 5. Dashboard widget types

P0: light control, switch, sensor value + trend, thermostat, scene button, battery/availability, multi-entity card, chart, text, weather if configured. Widgets reference stable entity IDs and validate capabilities; empty and unsupported widget states are supported.

1.0: supported numeric sensors (including actual energy measurements) may display **simple unit-aware trend graphs**, without promising every utility meter integration. **Post-1.0:** full drag-and-drop editing, custom widgets, wall/tablet mode, interactive 2D floorplans and camera views. Media views, 3D representations and advanced themes are not owner-approved questionnaire selections and must not be treated as committed D-22..D-39 features.

## 5A. Additional owner-approved user experiences D-22..D-39

**D-22 Dashboard:** all four features are required for Domyro's product vision: starter templates; complete accessible drag-and-drop editor; custom widget creation and insertion; dedicated tablet/wall-panel mode. For a compact 1.0, basic responsive layouts and templates are recommended; a full resize/grid editor, user widgets and kiosk profiles follow after core release. A control must reflect observed/pending status and enforce access scopes.

**D-23 Rooms and 2D plans:** grouping rooms by floor, reusable group sections and interactive 2D floorplans. The user did not select a 3D house view. A 2D marker is bound to a stable entity ID; floorplan editing and controls need an accessible text/list path.

**D-24 Scenes:** group commands, timed execution, optional conditions/exceptions, snapshot scene from actual current device states. Scene partial failures are visible and scheduled executions inherit DST/timezone rules.

**D-29 Notifications:** in-app channel foundation; mobile push, email, webhooks, and severity, critical priority and routing rules. External delivery must be opt-in and explain platform limitations. Critical notification labels are not delivery guarantees.

**D-30 + D-50 Languages:** full 1.0 **Dutch and English only**; **German after 1.0**. Prepare locale keys so later `de-DE` addition is backwards-compatible. This overrides the earlier undecided timing.

**D-31 Diagnostics:** live CPU, RAM, disk and network information; searchable device/driver logs; redacted diagnostic exports; proactive fault and storage alerts. Privilege and host-vs-container boundaries must be apparent.

**D-32 Presence:** manual home/away and motion sensors early; opt-in GPS/mobile, Bluetooth and Wi-Fi/network presence later, with confidence/expiration, data minimization and clear consent.

**D-37 Accounts:** TOTP MFA, passkeys with platform biometrics where supported, sensitive-action step-up and active-session/device revocation. Passwords/biometric templates never appear in logs.

**D-35 Differentiators:** polished fast dashboards, stronger automations and greater local independence are the project's *three chosen* product priorities. Do not add an unselected fourth product differentiator.

These are **approved long-term feature requirements**, but D-36 requires a compact and highly reliable 1.0. Suggested release phases and undecided options are in [PRODUCT-DECISIONS-22-39.md](PRODUCT-DECISIONS-22-39.md).

## 5B. Fixed D-40..D-52 release-specific UX

- **Accessibility / local access:** offer IP:port, supported `domyro.local` mDNS name, own domain/reverse proxy. Explain mDNS multicast limitations, conflict fallback and proxy TLS/Host/Origin safety.
- **Installer:** per supporting service choose local managed install, existing service connection, or defer when optional; show how this affects first-run readiness.
- **1.0 dashboard:** ready-made templates plus simple add/remove/reorder/rename/room settings, saved across sessions. Rich drag/drop/resizing, user-created widgets and dedicated tablet/wall-mode are **later**.
- **1.0 automation:** simple rules and basic safe visual nodes; show per-automation missed-run setting **skip / bounded catch-up / ask confirmation** with audit/status of missed runs. Advanced reusable subflows and detailed live debugger later.
- **Plugin update UI:** automatic **metadata checking only**, manual **Download update** and then separate confirmed **Install update**. Never use core-release settings to silently stage plugin binaries.
- **Account recovery:** one-time recovery code enrollment/status and documented local secure physical/VM-console recovery, without web reset backdoor.
- **Backups:** show defaults 7 daily / 4 weekly / 12 monthly; per-destination status and safe retention.
- **1.0 languages:** NL/EN; German later. **1.0 energy:** simple actual sensor history charts. **No camera UI feature claim in 1.0.** Optional Domyro-operated remote access also later.
- **Multi-server:** multiple sites inside one 1.0 installation; UI may show remote-server linking as planned but cannot pretend it works until post-1.0 federation ships.

Canonical detailed decision contract: [PRODUCT-DECISIONS-40-52.md](PRODUCT-DECISIONS-40-52.md).

## 6. Performance/usability targets

- Responsive 320 CSS px through large desktops and tablets.
- 44×44 CSS px target where practical for primary touch actions; no accidental touching adjacent critical controls.
- Data updates independently of page navigation; visible stale status after connection loss.
- Skeletons only during real loading, no decorative infinite spinners.
- Support full keyboard paths for pairing, dashboards and automations; alternate list editor for graph actions.
- Localization covers onboarding, errors, permissions, notifications and integrations in **Dutch and English for 1.0**. **German (de-DE) is required after 1.0**, as decided in D-50; no German launch-milestone ambiguity remains.
- Offline PWA shell may load cached UI; live control is disabled until connectivity returns.

## 7. Core acceptance journeys

1. A guest sees a room but cannot invoke an unauthorized light action, including direct API requests.
2. An admin moves a sensor between rooms and its historical data is preserved.
3. A network outage changes a bulb card from live to stale and does not show a pending command as confirmed.
4. A resident creates a morning scene and can see each command outcome.
5. An admin edits a graph, observes validation warnings, simulates it, publishes a new revision and inspects a trace.
6. Reduced-motion user can perform the exact same tasks without animations.

## 8. Product analytics and privacy

No third-party tracking pixels, ad SDKs or forced usage analytics. Opt-in anonymous diagnostic telemetry may be considered only with an itemized privacy notice, explicit opt-in, deletion and opt-out. Telemetry is not required to use Domyro.
