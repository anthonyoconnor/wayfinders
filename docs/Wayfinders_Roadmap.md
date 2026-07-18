# Wayfinders current roadmap

Status: forward plan. Gameplay is complete through `GP-5.2`; the Great Hall
track is complete through `GR-5.3`; cloud atmosphere is complete through
`CLD-1`; and water presentation is complete through `WTR-2.6`.
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
- `AUD-x` identifies game-audio milestones and their acceptance gates.
- `WTR-x.y` identifies water-presentation milestones and acceptance gates.
- `CLD-x.y` identifies cloud-atmosphere milestones and acceptance gates.
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

The asset-workspace shell, focused island workshop, single island-availability
lifecycle, deterministic authored-island world planning, chunk-bounded authored
runtime presentation, independent revealed-map cloud atmosphere, and production
water system are implemented. No further production-presentation milestone is
currently proposed.

The Voyage Sense thread and its supply commitments are implemented through
`GP-5.2`. The proposed `GP-6` continuous-world conversion is the next gameplay
candidate track. Remaining audio acceptance follow-up requires no new runtime
scope; the production water system is complete through `WTR-2.6`. Great Hall
concept and planning work is complete. The product owner accepted the
`GR-5.2` view-only approval workspace and recorded **Go** on 2026-07-16. The
shared presentation contract, renderer, fixture, game adapter, and bounded era
integration in `GR-5.3` are implemented.

## Great Hall presentation

### GR-5 — Graphical Great Hall chronicle

Status: complete through `GR-5.3`. No further milestone is planned.

Replace the text-led Great Hall with the selected **Ancestor Wall** direction:
reviewed navigator portraits, a stable achievement-symbol language, fixed
twelve-generation era pages, one selected navigator's four voyage bands, and
material states for active, completed, lost, and later-confirmed histories. All
current exact text remains available on focus or activation and to assistive
technology.

The implementation sequence is:

1. `GR-5.1` — implemented information architecture, interaction prototype,
   fixtures, and measured model baseline through twenty generations;
2. `GR-5.2` — implemented twenty predefined portraits, fixed Hall and symbol
   art, and a first-class, direct-linkable Great Hall viewing workspace,
   accepted by the product owner;
3. `GR-5.3` — one versioned JSON-compatible presentation contract, a shared
   graphical renderer for the asset viewer and game, the chronicle adapter, and
   bounded era paging, all now implemented.

```mermaid
flowchart LR
    B["Current implemented baseline"] --> GH51["GR-5.1 Hall information architecture"]
    GH51 --> GH52["GR-5.2 fixed art and approval preview"]
    GH52 --> GO{"Product owner Go?"}
    GO -->|Revise| GH52
    GO -->|Go| GH53["GR-5.3 shared model and renderer"]
```

The detailed current-information inventory, retained concepts, selected visual
grammar, scaling model, contracts, budgets, and acceptance gates are defined in
`Wayfinders_Great_Hall_Presentation_Milestone.md`. The closed current-data
symbol set is defined in `Wayfinders_Great_Hall_Infographic_Lexicon.md`.
Concept PNGs remain reference-only under `concept_art/great-hall` and never
load at runtime. The reviewed copies consumed by the approval workspace live at
stable paths under `public/assets/gr5/great-hall`.

## Voyage Sense

### GP-5 — Voyage Sense presentation

Status: complete through `GP-5.2`. No further Voyage Sense milestone is planned.

The implemented Voyage Sense thread contract is owned by the technical design;
its scope and acceptance evidence are archived.

#### GP-5.2 — Voyage Sense supply commitments

`GP-5.2` extends the thread's risk language into the graphical cargo rack. Its
implemented behavior is owned by the technical design and its acceptance
evidence is archived. The rack intentionally contains no visible words or
numbers; exact quantities remain available to assistive technology.

## Continuous global world

### GP-6 — Continuous global world

Status: proposed, not started, and not authorized.

Replace the generated game's hard world boundary with a finite, two-axis
wrapping topology. West/east and north/south become ordinary neighbours, so the
ship can circumnavigate continuously through every seam and corner. This is a
top-down toroidal world that feels globe-like; it is not a spherical projection
and does not add poles, latitude distortion, or an infinite world.

The implementation sequence is:

1. `GP-6.1` — establish the explicit gameplay/asset topology contexts,
   canonical and lifted coordinate contract, wrapped query primitives,
   deterministic manifest identity, and `P0`/`P1`/`P2` baselines;
2. `GP-6.2` — make physical movement, coarse/fine collision, graph edges,
   supported connectivity, forward range, return paths, and travel segments
   cross seams without a synthetic boundary or long canonical jump;
3. `GP-6.3` — remove the generator's privileged edge band, support
   seam-crossing authored and procedural footprints, and make analysis,
   generated water facts, connectivity, coastlines, and spatial indexes
   periodic and deduplicated;
4. `GP-6.4` — move sight, knowledge, provisions, feature placement and
   interactions, expeditions, docking, wrecks, and completion onto the shared
   periodic topology with exactly-once mutations and events;
5. `GP-6.5` — use a continuous lifted camera and periodic image entries through
   the one bounded `ActiveChunkSet` for production water, terrain, authored art,
   overlays, Voyage Sense, clouds, markers, ship/wake, diagnostics, and input;
   and
6. `GP-6.6` — close deterministic circumnavigation journeys, named-profile
   performance and resource budgets, full verification, browser acceptance,
   current-state documentation, and archived evidence.

```mermaid
flowchart LR
    B["Current bounded gameplay world"] --> G61["GP-6.1 topology contract"]
    G61 --> G62["GP-6.2 movement and navigation"]
    G62 --> G63["GP-6.3 generation and spatial world"]
    G63 --> G64["GP-6.4 gameplay integration"]
    G64 --> G65["GP-6.5 continuous presentation"]
    G65 --> G66["GP-6.6 acceptance and closeout"]
```

The detailed topology decisions, subsystem tasks, test assignment, performance
budgets, risks, and acceptance gates are defined in
`Wayfinders_Continuous_World_Milestone.md`. Generated gameplay worlds wrap on
both axes; isolated asset sea trials and authored collision-validation grids
remain explicitly bounded. The six gates are one coordinated conversion, not a
user-facing finite/toroidal game-mode choice. The implemented `WTR-2` layout and
renderer are migrated inside `GP-6`; they are not replaced by another water
track. `GP-6.2` proves traversal against explicit worlds; production generation
does not adopt that graph until `GP-6.3` replaces its finite-edge acceptance.
The gates through `GP-6.5` are checkpoints on one integration branch and do not
land as separately supported runtime configurations.

## Audio presentation

### AUD — Game sound and music layer

Status: implemented through `AUD-5` on 2026-07-17; rebuilt-ambience product-owner
audition plus the remaining keyboard/media, audible-loop, cue, crossfade, and
ducking browser acceptance remains to be recorded.

The implemented foundation loads one validated stored-audio catalog, exposes a
play-only Audio asset workspace, and gives game mode an explicit enable flow,
in-memory mixer controls, bounded voice ownership, diagnostics, silent fallback,
and complete scene cleanup. Current ownership and behavior are documented in
`ARCHITECTURE_MAP.md`, `Wayfinders_Technical_Design.md`, and
`Wayfinders_Asset_Pipeline.md`; volatile verification state is recorded in
`IMPLEMENTATION_STATUS.md`.

`AUD-1` closes after live browser acceptance verifies keyboard focus and exact
values for enable, mute, master, and all four category controls; stored-file
decode and audition in the Audio workspace; locked startup; and console-clean
scene teardown and restart without leaked playback.

`AUD-2` adds one persistent ocean bed and one speed-controlled wake loop. It
closes after live browser acceptance verifies silence at rest, smooth motion
gain, direction reversal without restart, focus reconciliation, and ten
seam-free repeats of both reference loops.

`AUD-3` adds deterministic microtask-batched gameplay and UI cues over the
existing typed event stream. Pure policy and event-adapter contracts cover the
source table, priority, cooldown, voice cap, replacement, idol-survey, return,
wreck, high-rate silence, and developer-action suppression. It closes after
live muted/unmuted browser acceptance confirms cues remain supplementary to the
existing visual and semantic feedback.

`AUD-4` adds renderer-neutral home-harbor/open-water selection, two stable music
voices, bounded `1.5`-second crossfades, and priority lifecycle ducking for
return, wreck, succession, and completion. State/controller contracts cover the
full lifecycle matrix, stable frames, rapid reversals, focus reconciliation,
completion priority, modal release, two-voice capacity, and teardown. It closes
after live browser acceptance confirms audible transitions and ten seamless
repetitions of both stored reference loops.

`AUD-5` placed the final sounds and music at their existing runtime paths and
retained a deterministic complete-set renderer for future regeneration. The
remaining event-to-cue policy, browser constraints, budgets, and acceptance
gates are defined in `Wayfinders_Audio_System_Milestone.md`. No further audio
milestone is proposed; the current acceptance follow-up does not authorize new
runtime scope.

## Water presentation

### WTR-1 — Layered water system

Status: completed as the visual prototype that established the direction now
implemented by WTR-2. Historical scope and acceptance evidence are archived in
`Wayfinders_Roadmap_Archive.md`.

### WTR-2 — Production water integration

Status: implemented on 2026-07-17. The durable runtime contracts and behavior
are owned by the technical design and architecture map; completion evidence is
archived in `Wayfinders_Roadmap_Archive.md`.

## Authorization boundary

WTR-1.0 through WTR-1.5 and WTR-2.0 through WTR-2.6 are complete. No later water
milestone is authorized. `GP-6` and any later gameplay or production-asset
milestone require explicit user authorization. Do not implement gameplay
saving; it may return only through an explicitly authorized milestone designed
for the game that exists at that time.
