# Domyro — Decisions, assumptions and sign-off

**Planning baseline v1.0 · 29 October 2026**  
**Implementation status: prohibited until G0 approved**

## A. Owner-approved product decisions

D-01 Public serious independent alternative.  
D-02 **Final and owner-approved:** GNU AGPLv3 **only** (`AGPL-3.0-only`), with community forks permitted and exclusive owner approval for official upstream changes/releases.  
D-03 Docker, native Linux, Umbrel from the first supported release.  
D-04 Polished resident UX with advanced administrator mode.  
D-05 Zigbee, MQTT and Matter support are first-priority.  
D-06 Simple rules and advanced flow editor use the same automation system.  
D-07 PWA first, native iOS/Android later.  
D-08 Optional easy remote access planned (no mandatory cloud).  
D-09 Community side-loading plus curated integration catalog.  
D-10 Transitional HA bridge then migration tooling.  
D-11 AI/speech after basic reliability.  
D-12 First success is actual functioning devices.  
D-13 **Final and owner-approved:** Domyro updates are never installed automatically. Users may allow automatic checking and downloading after their own 0h/12h/24h/72h/7d/custom delay; installation always requires an explicit manual decision. Updates to the underlying Linux/umbrelOS operating system are not controlled by Domyro. See [SOFTWARE-UPDATES.md](SOFTWARE-UPDATES.md).

## B. Proposed technical ADRs for project owner sign-off

| ADR | Decision | Rationale | Alternative / tradeoff |
|---|---|---|---|
| A-01 | **Accepted:** AGPL-3.0-only for original Domyro core/web code; standard license in `LICENSE` | Network-copyleft plus free forks; @TheRoyalCaptain exclusively approves official upstream | Third-party dependency compatibility and independent plugin licensing still require review |
| A-02 | TypeScript/Node.js modular monolith | Shared types, rapid execution, manageable ops | Python core richer ecosystem, Rust better deterministic performance but slower initial development |
| A-03 | PostgreSQL only for supported production | ACID relational registry, history, migrations and reliable transaction outbox | SQLite reduces setup but complicates multi-process writes and growth; embedded alternative future |
| A-04 | REST v1 + authenticated WebSocket snapshots/deltas | Predictable API and realtime updates | GraphQL more complexity without clear benefit |
| A-05 | Zigbee via Zigbee2MQTT first, not direct radio ownership | Fast support with existing mesh and MQTT | Depend on external Zigbee service |
| A-06 | Matter via standalone OHF Matter.js Server | Avoid implementing complex protocol stack | Runtime/network complexity, secure fabric storage |
| A-07 | One typed automation graph; two editors | Prevent two incompatible rule engines | More upfront graph/schema work |
| A-08 | Third-party executable plugins outside core | Risk compartmentalization and crash isolation | Higher packaging/runtime overhead; no absolute sandbox guarantee |
| A-09 | Optional, future remote relay using audited encryption architecture | Local-first and simple opt-in access | Requires dedicated infrastructure and advanced key security |
| A-10 | Three genuinely supported installers, including native systemd Linux | Matches user priorities | Longer initial development and support matrix |
| A-11 | No source code before documented acceptance G0 | Prevent architecture drift and premature commitment | Slower first coding day, less later rework |
| A-12 | **Accepted product policy:** automatic update checking/downloading can be user-enabled; **installation is always manual** | Prevent unapproved restarts and service upgrades | Umbrel platform-managed updates may not provide native artifact staging; capability limitations must be visible |

## C. Remaining G0 approvals

These are intentionally explicit; they are *not* reasons to start implementation while unsettled:

1. **License selected and recorded:** `AGPL-3.0-only`; finish dependency license compatibility and third-party notice audit before public binaries. AGPL obligations do not automatically mean independently developed plugins must use AGPL.
2. Confirm TypeScript/Node.js modular monolith + PostgreSQL as final stack.
3. Confirm exact first hardware models: which Zigbee sensor and mains-powered device, which Matter device and which broker.
4. Confirm product support boundaries for native Linux: Debian/Ubuntu versions, x86_64/ARM64 releases, supported umbrelOS version.
5. **Maintainer control decided:** `@TheRoyalCaptain` alone authorizes official merges and releases. **Still to complete:** enable enforceable GitHub ruleset/branch protection in website settings, test CODEOWNERS, determine issue handling and code of conduct. See `docs/GITHUB-GOVERNANCE.md`.
6. Approve threat model and the release gate that remote service/marketplace will follow core stability.
7. Confirm initial hardware acceptance criteria and the rule that existing HA/Zigbee mesh remains untouched without explicit consent.
8. Confirm trademark/name investigation before public brand launch.

**Decision status:** A-01 (AGPL-3.0-only) is accepted. Governance rule for sole official maintainer approval is accepted. A-02..A-11 and remaining hardware/legal/deployment gates are still proposed pending formal G0 project-wide sign-off. External forks and contributions remain allowed under the AGPL, and GitHub CODEOWNERS must be backed by active branch rules.

## D. Decision record template

- ADR ID and date:
- Status: proposed / accepted / superseded:
- Problem:
- Options and evidence:
- Choice and constraints:
- Consequences/tradeoffs:
- Security, compatibility and licensing effect:
- Reversal/migration path:
- Approver:
- Source links:

## E. G0 acceptance statement

\"\"I approve the Domyro planning baseline, including selected architecture, the licensing strategy after review, priority and deployment scope, risk exclusions, test gates and task list. Implementation and GitHub issue creation may begin only after this sign-off is recorded.\"\"

Approval is NOT yet recorded merely by publishing these planning files.

## F. External reference links

- GNU AGPL and GPL FAQ: https://www.gnu.org/licenses/gpl-faq.en.html
- Official GitHub governance policy: `docs/GITHUB-GOVERNANCE.md`
- Source license: `LICENSE`
- Zigbee2MQTT API: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- OHF Matter.js Server: https://github.com/matter-js/matterjs-server
- Matter networking: https://www.home-assistant.io/integrations/matter
- Home Assistant WS API: https://developers.home-assistant.io/docs/api/websocket/
- Umbrel community packaging: https://github.com/getumbrel/umbrel-community-app-store
- Umbrel app store expectations: https://github.com/getumbrel/umbrel-apps
