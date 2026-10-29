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

**First-run wizard:** LAN address > locale > admin invitation/credential setup > site/time zone > devices connection > room creation > first dashboard > backup reminder. If Zigbee2MQTT is absent, provide a documented \"configure broker\" step, never imply radio was discovered. Pairing is time-bounded and can be cancelled.

**Overview:** customizable tiles, per-user default, 1-tap common scenes, device offline indicator, responsive grid and keyboard reorder alternative.

**Rooms:** 0..N rooms, floor grouping, per-room count, lighting summary and climate measurement. A device may be reassigned without losing history.

**Devices:** live search/filter by type, integration, room, availability, last seen; bulk room assignment; destructive actions require explicit confirmation.

**Scènes:** named set of target states, optional snapshot capture; preview, run status per target, partial failure reporting.

**Simple automations:** plain-language trigger/conditions/actions, time conditions, validation before save, natural NL/EN labels; previews translate to the common graph model.

**Advanced automations:** nodes and directed edges, pan/zoom, minimap optional, accessible list-equivalent editor, static validation, per-node trace, dry-run and version diff. No hidden auto-reordering of physical commands.

**Integrations:** card with transport, requirements, permissions, maintenance status, configuration, software source, version and remove/repair action.

**Maintenance:** health, error digest, backup/restore, update notes, startup and integration logs, support export with secret redaction.

## 4. Modes and permissions

- owner/admin: manage system and users, sensitive integrations, backup and audit;
- manager: configure assigned site, rooms, scenes and approved automations;
- resident: operate authorized entities/scenes and view assigned dashboards;
- guest: limited time/device grants, no integration/config changes;
- service account: scoped tokens, noninteractive, auditable.

Permission granularity: view entity, command specific capability, manage room, edit automation, install integration, view history, export data, admin actions. It is enforced server-side even when controls are hidden client-side. Denied content must not leak through WebSockets or snapshots.

## 5. Dashboard widget types

P0: light control, switch, sensor value + trend, thermostat, scene button, battery/availability, multi-entity card, chart, text, weather if configured. Widgets reference stable entity IDs and validate capabilities; empty and unsupported widget states are supported.

Post-1.0: camera live view, media playback, interactive floorplans, energy flow visualization, 3D house view, extensible third-party widgets and advanced theme builder.

## 6. Performance/usability targets

- Responsive 320 CSS px through large desktops and tablets.
- 44×44 CSS px target where practical for primary touch actions; no accidental touching adjacent critical controls.
- Data updates independently of page navigation; visible stale status after connection loss.
- Skeletons only during real loading, no decorative infinite spinners.
- Support full keyboard paths for pairing, dashboards and automations; alternate list editor for graph actions.
- Localization covers onboarding, errors, permissions, notifications and integrations (Dutch and English in 1.0).
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
