# Domyro — Decisions, assumptions and sign-off

**Planning baseline v1.0 · 29 October 2026**  
**Implementation status: prohibited until G0 approved**

## A. Owner-approved product decisions

D-01 Public serious independent alternative.  
D-02 Open source with copyleft on modified derivatives.  
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

## B. Proposed technical ADRs for project owner sign-off

| ADR | Decision | Rationale | Alternative / tradeoff |
|---|---|---|---|
| A-01 | AGPL-3.0-or-later for original Domyro core/web code, final after legal audit | Network-copyleft fits public self-hosted web project | GPLv3 does not normally add AGPL network source obligation; independent plugins require their own review |
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

## C. Remaining G0 approvals

These are intentionally explicit; they are *not* reasons to start implementation while unsettled:

1. Confirm AGPL-3.0-or-later and final distribution policy; obtain dependency license-compatibility review. AGPL source obligations for modified network deployments are not a legal guarantee that every independent third-party plugin must be AGPL.
2. Confirm TypeScript/Node.js modular monolith + PostgreSQL as final stack.
3. Confirm exact first hardware models: which Zigbee sensor and mains-powered device, which Matter device and which broker.
4. Confirm product support boundaries for native Linux: Debian/Ubuntu versions, x86_64/ARM64 releases, supported umbrelOS version.
5. Set release/maintainer model: project owner, collaborators, PR reviews, public issue handling, code of conduct.
6. Approve threat model and the release gate that remote service/marketplace will follow core stability.
7. Confirm initial hardware acceptance criteria and the rule that existing HA/Zigbee mesh remains untouched without explicit consent.
8. Confirm trademark/name investigation before public brand launch.

**Suggested default:** accept ADRs A-01..A-11 provisionally, run the licensing and hardware checks in M0, then record formal G0 approval.

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
- Zigbee2MQTT API: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- OHF Matter.js Server: https://github.com/matter-js/matterjs-server
- Matter networking: https://www.home-assistant.io/integrations/matter
- Home Assistant WS API: https://developers.home-assistant.io/docs/api/websocket/
- Umbrel community packaging: https://github.com/getumbrel/umbrel-community-app-store
- Umbrel app store expectations: https://github.com/getumbrel/umbrel-apps
