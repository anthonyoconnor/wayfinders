# Wayfinders development-velocity plan

Status: active development policy. Saving was removed on 2026-07-13 to reduce
feature-delivery overhead; the remaining outcomes are directional.

## Goal

Keep feature delivery fast while the game is changing rapidly. New work should
be able to reshape gameplay without repeatedly updating unrelated infrastructure,
and today's architecture should not prevent stronger production systems from
being introduced when their value is clear.

## Guiding principles

- Optimize for change during early development, not premature compatibility.
- Keep gameplay authority separate from presentation and derived calculations.
- Prefer clear ownership and composable boundaries over larger central
  coordinators.
- Add infrastructure when a demonstrated need justifies its continuing cost.
- Preserve deterministic behavior, stable logical identity and headless testing
  where they already support gameplay development.

## Priority outcomes

### 1. Remove saving from active development

**Status:** implemented.

**Desired result:** Current feature work has no save-schema, browser-storage,
reload-compatibility, migration or checkpoint obligations. Starting or
refreshing the game creates a fresh session, and no dormant persistence layer
needs to be kept synchronized with changing gameplay.

**Reason:** The authoritative state model is still expanding. Maintaining a
save format now multiplies work across every stateful feature while providing
little player or development value.

**Direction:** Remove the active saving capability and its acceptance burden.
Preserve future saveability by keeping authoritative state outside presentation,
using stable logical identifiers, and ensuring generated or derived data can be
rebuilt. Existing history remains available in version control; the current save
format should not constrain a future design.

**Reintroduction gate:** Saving may return only when the user explicitly
authorizes a named milestone whose scope includes saving. Lost progress or a
technical readiness assessment may justify proposing that milestone, but does
not authorize implementation. When authorized, design a new version-one format
from the game that exists then, followed by validation, storage, player-facing
flows and automated restoration coverage. Do not revive the removed schema or
storage implementation by default.

### 2. Reduce central feature-integration pressure

**Desired result:** Most feature work stays within its owning gameplay area.
Cross-cutting lifecycle moments have explicit inputs and outcomes, and central
orchestration remains small enough that independent work can converge without a
single recurring merge queue.

**Reason:** When creation, observation, success, failure, events and read models
are all integrated manually in one place, feature cost and regression risk grow
faster than the feature itself.

**Direction:** Favor stable composition seams and feature-owned state and rules.
Keep ordering and atomicity visible, but avoid requiring unrelated central code
to understand every feature-specific detail.

### 3. Establish a stable presentation boundary

**Desired result:** Gameplay exposes intentional read models and commands to
presentation. Player UI, developer tools, diagnostics and rendering can evolve
independently, and adding a visible feature does not require expanding one scene
or adapter in many unrelated sections.

**Reason:** A broad presentation owner becomes a merge gate, hides dependencies
and makes browser behavior difficult to test without running the whole game.

**Direction:** Keep presentation modular and derived from authoritative state.
Shared UI and rendering conventions should be reusable by the game, future asset
tools and automated browser scenarios without becoming gameplay authority.

### 4. Make state-change effects explicit

**Desired result:** Every authoritative mutation reliably communicates which
derived views and calculations are stale. Features cannot appear correct in
memory while silently failing to refresh presentation or other dependent state.

**Reason:** Manually coordinated revision counters and invalidation rules create
an implicit protocol that each new feature must discover and remember.

**Direction:** Treat change effects as part of the mutation contract. Retain
granular, performance-conscious invalidation, but make its ownership and meaning
clear enough to verify automatically.

### 5. Shorten and strengthen feedback loops

**Desired result:** Developers can run a fast, focused, type-safe test path while
working and a reproducible full gate before integration. Important browser flows
can be exercised automatically rather than relying on repeated manual setup.

**Reason:** Slow full-world tests, test code outside static checking and manual
browser acceptance delay feedback and make cross-cutting milestones more
expensive to verify.

**Direction:** Separate focused domain feedback from broader simulation,
browser and performance coverage. Reuse deterministic seeds and scenario
drivers so complex states are reproducible without saved browser sessions.

### 6. Make configuration declarative and instance-safe

**Desired result:** A configurable value has one authoritative description, and
runtime instances can use their intended configuration without hidden dependence
on shared mutable state. Developer tuning and future asset/viewer tools consume
the same meaning and constraints.

**Reason:** Repeating configuration metadata and invalidation behavior in several
places makes small tuning additions disproportionately expensive and complicates
isolated tests or tools.

**Direction:** Treat configuration metadata, validation and runtime consumption
as one coherent capability. Preserve live tuning where it provides real
development value.

### 7. Reduce documentation synchronization cost

**Desired result:** Current status, future intent, durable technical principles
and acceptance evidence each have one clear home. A feature does not require the
same facts to be rewritten across several documents.

**Reason:** Thorough documentation prevents rediscovery, but duplicated status
and evidence turn every implementation step into additional coordination work
and invite drift.

**Direction:** Keep the roadmap focused on future outcomes, technical documents
focused on durable constraints, and one concise source responsible for current
state. Documentation effort should remain proportional to the decision being
recorded.

## Decision gates

| Trigger | Desired readiness |
| --- | --- |
| A feature introduces another cross-domain success or failure outcome | Its lifecycle contribution has clear ownership, inputs, outputs and atomicity. |
| Player-facing UI or production graphics begin expanding quickly | Presentation boundaries and automated browser feedback can support parallel growth. |
| Configuration is needed by multiple runtime instances or tools | Its meaning and validation are shared without relying on hidden global state. |
| Lost progress begins harming real playtests | Authoritative state is understood well enough to begin a fresh saving design. |
| Saving is reintroduced | Gameplay snapshot design, validation, storage and player UX are treated as separate concerns and accepted in that order. |

## Success indicators

- New features usually change their own domain and a small, predictable set of
  integration boundaries.
- Unrelated features can be developed and reviewed without contending for the
  same central implementation areas.
- State changes cannot omit required refresh or recalculation behavior silently.
- Focused tests provide quick feedback, while browser and full-simulation checks
  remain reproducible.
- Saving creates no development overhead until its reintroduction gate is met.
- Documentation clarifies decisions without becoming a repeated feature tax.
