# Wayfinders current roadmap

Status: forward plan only. No implementation batch is currently authorized.
Implemented behavior belongs in `Wayfinders_Technical_Design.md`; completed
milestones and acceptance evidence belong in `Wayfinders_Roadmap_Archive.md`.

## Standing planning rules

### Saving policy

The technical design owns the current runtime persistence boundary. For future
planning, persistence must not be added incidentally to another feature or
inferred from development-only asset authoring. It may return
only through an explicitly authorized milestone designed for the game that
exists at that time. No persistence milestone is currently planned or
authorized.

### Milestones and authorization

- `GP-x.y` identifies gameplay milestones and acceptance gates.
- `GR-x.y` identifies graphics, asset-pipeline, and production-presentation
  milestones and acceptance gates.
- `WTR-x.y` identifies the proposed water-presentation track.
- A milestone is complete only when its behavior, tests, maintainability,
  performance criteria, and acceptance evidence pass.
- This roadmap proposes sequencing but authorizes no work by itself.
- An explicitly authorized ordered batch may proceed dependency-first without
  renewed permission between its named milestones. Work pauses when the batch
  is complete or continuing needs a new product decision, expanded scope or
  authority, or an unresolved external blocker.
- Before implementation starts, record measurable baseline and regression
  budgets appropriate to the work.

Developer graphics remain valid fallback presentation. Gameplay consumes
semantic terrain and content data; rendered pixels, sprite footprints, and
animation never become gameplay authority.

In planning, **tribe** means the authoritative support state of the home
community. **Community** is the broader design term and may also describe
remote settlements. Code contracts must not use the terms interchangeably.

## Current planning point

The implemented baseline supports the prototype world and the named large-world
profiles. Its current contracts are documented in the technical design and
architecture map; its delivery history is archived.

The next proposed production-asset sequence is the authored-island track below.
It replaces the current operator-facing candidate lifecycle with a focused
island workshop, then makes available islands deterministic world-generation
inputs. The sequence is proposed but not authorized.

The water-system proposal remains a separate candidate track.

## Authored island workshop and world integration

This track applies to non-home islands created with a world. The dedicated home
island package remains outside this sequence. The configured island count stays
authoritative: authored islands replace procedural islands within that count;
they do not add extra islands.

### GR-4.1 — Focused island workshop

Status: proposed, not started, and not authorized.

Replace the general production-candidate workbench with an island-only workflow.
The selected island in the permanent left library is the single active island;
the right workbench must not expose another asset or runtime-profile selector.
The right workbench contains only editable basic properties, the isolated
**View with ship** action, the **Available in game** control, and collision-mask
editing with fit, paint, erase, brush size, undo, redo, reset, and save.

Remove operator-facing candidate, validation, fingerprint, review, approval,
rejection, promotion, runtime-binding, animation, layer-compositing, portable
candidate, and package-preview controls from the island workflow. Import reads
and prepares the PNG, seeds its collision mask, and selects the new island.
Imported islands start unavailable.

Acceptance requires:

- the left selection alone determines the centre preview and right workbench;
- name and other supported island properties can be edited without exposing
  inferred dimensions or server-owned preparation details;
- collision seeding and manual `8`/`32`-pixel editing remain intact;
- one **Save changes** operation persists properties and the complete collision
  mask; and
- the interface communicates only actionable save errors and whether the island
  is available in game, not internal repository-transaction state.

### GR-4.2 — Single availability lifecycle

Status: proposed, not started, and not authorized.

Replace pending, approved, rejected, promoted, and runtime-binding lifecycle
records with one durable `availableInGame` boolean on each authored island.
Checksums or revisions may remain private transaction-safety details but must
not become user workflow states. Enabling availability validates the current
PNG, properties, prepared output, and saved collision mask atomically. A failed
validation leaves the island unavailable and reports the specific correction.

Saving a valid available island updates its game-facing catalog entry without
requiring reapproval or repromotion. Disabling availability removes the island
from future world-generation input without deleting its source, prepared art,
properties, collision mask, or sea-trial access. Availability changes affect
newly created worlds only; they do not mutate a running world.

Acceptance requires rollback-safe serialized writes, unique stable IDs and
names, exact saved-mask round trips, and a read-only deterministic catalog of
available authored islands. Obsolete review, promotion, and runtime-binding
artifacts and APIs are removed rather than retained as hidden parallel paths.

### GR-4.3 — Deterministic authored-island world planning

Status: proposed, not started, and not authorized.

Supply the sorted available-island catalog to renderer-neutral world planning.
For a fixed world seed and catalog revision, planning selects authored islands
deterministically and without replacement. An authored island may appear at
most once in a world. When more authored islands are available than the
configured island count, select a deterministic subset without replacement.
When fewer are available, use every selected authored island at most once and
fill only the shortfall with procedural islands.

Each generated-island manifest entry records whether it is authored or
procedural and, for authored entries, its stable asset ID. Placement bounds are
derived from the authored canvas and collision footprint before placement, so
edge clearance, home clearance, starter-lane clearance, and minimum navigable
channels remain enforced. The saved authored collision mask—not rendered
pixels—becomes authoritative collision for that island. Procedural generation
remains available only as the deterministic shortfall fallback.

Acceptance requires:

- total non-home island count still equals the configured requirement;
- no authored asset ID occurs more than once in a world manifest;
- authored count equals `min(available authored islands, required islands)`;
- procedural count equals `max(0, required islands - available authored islands)`;
- identical seed, settings, and catalog inputs produce identical selection,
  placement, manifests, terrain, and collision; and
- catalog reordering cannot change the result because selection begins from
  stable-ID order.

### GR-4.4 — Authored-island runtime presentation and closure

Status: proposed, not started, and not authorized.

Render each planned authored island from its recorded asset ID at the exact
world placement used by its collision mask. Authored presentation consumes the
existing active-chunk boundary and must not create total-world scans, duplicate
simulation state, or a second resource-lifetime policy. Procedural fallback
islands retain their current developer presentation.

Acceptance requires visual and collision alignment at every supported zoom,
chunk activation and deactivation without leaks, deterministic reload from the
world manifest, and unchanged navigation and exploration authority. Browser
acceptance covers import, edit, sea trial, availability toggle, new-world
creation, unique authored placement, procedural shortfall, and disabling an
island for subsequent worlds. Current documentation is rewritten to the
simplified lifecycle, and completed historical detail moves to the archive.

## Water presentation

### WTR-1 — Layered water system

Status: proposed, not started, and not authorized.

The proposal replaces developer water fills with deterministic, grid-aligned,
chunk-activated water presentation while preserving terrain, collision,
navigation, knowledge, and world generation as the only gameplay authorities.
Its source pack, render design, implementation sequence, budgets, and acceptance
criteria are defined in `Wayfinders_Water_System_Milestone.md`.

Before authorization, confirm the proposed art direction. Implementation must
consume the existing shared active-chunk boundary and must not introduce a
second presentation-lifetime policy or simulation clock.

## Explicitly deferred

- Broad runtime-asset expansion beyond the proposed authored-island track until
  a separate content batch defines and authorizes its packages, placement, and
  gameplay-facing semantics.
- Authoritative tribe economy/output, selectable voyage loadouts, generic wreck
  salvage/recovery, and automatic trade gameplay. Product rationale and open
  questions belong in `Wayfinders_Economy_Design.md`.
- Chained discovery quests, nested site targets, large resource catalogs,
  dynamic pricing, markets, fleet management, and labour allocation.
- Real-time economic refill timers or idle progression.
- NPC collision, combat, escorts, or direct fleet commands.
- Family trees, inheritable traits, politics, illness, age simulation, and
  non-wreck mid-voyage death.
- Physical idol recovery/cargo, idols as money or compulsory upgrades, and a
  forced ending without the current continue/new-game choice.
- A permanent economy panel or arcade score HUD.
- A general-purpose raster, pixel-art, atlas, or animation editor.
- Touch-first sailing until separately designed and approved.
- Gameplay saving, cloud sync, server-backed voyage saves, and multiplayer.

## Authorization boundary

No milestone in this document is authorized for implementation. Starting the
water proposal, gameplay persistence, a new gameplay or production-asset
milestone, broad runtime content rollout, or any other deferred scope requires
explicit user authorization.
