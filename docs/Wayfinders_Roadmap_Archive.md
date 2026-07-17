# Wayfinders completed roadmap archive

Status: historical. This document preserves the scope, gates and acceptance
evidence for completed `GP-0.1` through `GP-5.1`, `GR-1.1` through `GR-3.8`,
and `AM-0` through `AM-6` work. It does not define or authorize future work. See
`Wayfinders_Roadmap.md` for the small, current forward plan.

## Reading this archive

Statuses, contract versions, test counts, and technical paths below describe
their acceptance gate at that time. They are evidence, not current operating
instructions. In particular, retired save-related gates create no present
compatibility or implementation obligation. Use the technical design for
current behavior and the current roadmap for planning and authorization.

## Roadmap model

The completed tracks used these historical labels:

- **Baseline** — the implemented and protected starting point;
- **GP-x.y** — gameplay major milestones and their minor acceptance gates;
- **GR-x.y** — graphics, asset-pipeline and production-presentation gates.

The architecture record below additionally uses `AM-x` labels for its completed
scale and development-feedback milestones.

## Historical gameplay baseline

At the close of the gameplay track, the build provided:

- deterministic home waters, islands, navigation and terrain authority;
- continuous sailing, fog, current sight and Unknown, Personal and Supported
  water knowledge;
- provisions, forward/return guidance and exact-dock expedition commitment;
- a faint curved Voyage Sense thread for the ordered return route and its
  provision-margin risk state;
- Supported-route inheritance, deterministic island dossiers and their
  provisional sighting/survey to returned lead/dossier records;
- one directly sightable seed-derived historic wreck, coastal ruin and tidal
  cave using one extensible lead/report lifecycle;
- wreck rollback, persistent wrecks and exactly-once generation advancement
  per resolved wreck;
- versioned navigator identities, four-voyage tenures and exactly-once
  succession after either a completed tenure or a fatal wreck;
- exact-dock-committed achievement records for each safe voyage and a shared
  Great Hall chronicle whose focused handover mode presents them at succession;
- fresh-session startup with no browser persistence or checkpoint obligations;
- functional developer graphics, developer controls, diagnostics and the
  performance foundation.

Generation is backed by a versioned navigator lineage with distinct active,
completed and lost records. Exact-dock active-expedition returns complete one
of a navigator's four voyages, while fatal wrecks and completed-tenure
transitions share one idempotent succession authority.
Island dossier and survey-site findings are descriptive records and do not
create active resources or a tribe economy. Cross-session save/load is not part
of the active baseline.

## Cross-cutting gameplay gates

### GP-0 — Gameplay integration foundation

#### GP-0.1 — Exact-version save validation

Status: retired from the active baseline. The following acceptance evidence is
historical only and is superseded by the Saving policy above.

Acceptance evidence (updated 2026-07-13): autosave and checkpoint records pass
through one fail-closed parser for the exact current save schema, world
generator, content versions and serialized sub-format versions. Any readable
record that is malformed, older or newer is deleted instead of migrated or
preserved. A rejected autosave starts fresh; a rejected checkpoint becomes
unavailable without replacing the running world. Current docked-return,
active-expedition, pending-wreck and unacknowledged generation-handover states
still round-trip through the two atomic IndexedDB records. The full pipeline
passes 215 tests across 23 files plus typecheck and production build;
validation runs only at load boundaries
and adds no movement-loop work.

Before new authoritative gameplay state is integrated:

- decide whether storage remains one active lineage plus a checkpoint or must
  support multiple named saved games before fixing registry shape;
- establish how each owning gameplay minor adds its authoritative state and
  bumps every affected schema, content or serialized-format version;
- keep derived paths, traffic transforms and renderer state out of saves;
- treat every version field as an exact equality guard, never a migration
  selector; and
- require current-version autosave and manual-checkpoint round trips in every
  later GP minor.

Acceptance gate:

- exact current-version saves restore deterministically;
- every mismatched or malformed autosave/checkpoint is deleted and cannot
  disable or overwrite fresh play;
- feature-specific settlement idempotency is proven at its owning minor;
- existing wreck-hold and exact ship/camera restoration behavior survives;
- no later GP minor can be accepted without explicit version invalidation and
  current-version persistence coverage.

These former persistence requirements no longer apply to active milestones.
No gameplay milestone should add save fragments, schema versions or round-trip
coverage unless saving is explicitly included in its authorized scope.

#### GP-0.2 — Versioned integration boundaries

Status: accepted.

Acceptance evidence (2026-07-12): contract version one fixes the fishing-shoal
ID/content namespace, clue and quality vocabulary, hidden-versus-revealed
renderer read models, Survey/Leave commands and results, authoritative record
fragments and persistence ownership. The boundary introduces no navigator,
cargo, tribe, achievement or general-route contract. The full pipeline passes
153 tests across 17 files plus typecheck and production build; the contract
module adds no runtime loop work.

Establish only the boundaries needed by GP-1; authorization of later minors in
the same batch does not widen this gate:

- ownership of stable ID namespaces, content versions and invalidation rules;
- authoritative-versus-derived state rules;
- versioned interfaces and read models for independently owned modules;
- survey command and interaction result types;
- single-owner integration boundaries for simulation, persistence and scene
  wiring.

Cargo, tribe, navigator, achievement, general route, idol and graphics
contracts remain deferred to their owning GP/GR minor. Batch authorization of
those later minors does not pull their contract design into GP-0.2.

Acceptance gate: GP-1's opportunity identity, survey command/result types,
persistence ownership, renderer read models and narrowly required integration
boundaries are explicit, versioned and sufficient for separate pure-module
work. This is an engineering gate, not player-facing feature completion.

## Gameplay track

### GP-1 — Fishing grounds and survey work

Goal: add the first deliberate exploration job and prove the complete clue,
choice, return and inherited-result loop using developer graphics.

#### GP-1.1 — Deterministic fishing shoals

Status: accepted.

Acceptance evidence (2026-07-12): fishing content version one derives four
sparse, immutable shoal definitions from the saved seed and generation config,
with stable namespaced IDs, locations, service anchors, clues and hidden
quality outcomes. The catalog is generated off-loop and does not mutate
terrain, collision, island/resource identity or the accepted discovery
catalog. Current-sight observation is idempotent; fog-filtered read models hide
quality and never create terrain knowledge. Schema V2 added content-version
identity and sorted active-expedition sighting records; earlier schema or
content versions became incompatible. Autosave/checkpoint load paths accept
only exact current versions and delete rejected records. Developer markers are
revision-driven, pooled and viewport-culled. The full pipeline passes 159 tests
across 18 files plus typecheck and production build; normal movement checks
only the four definitions and performs no world-area scan or default visible-set
copy.

- Add sparse, seed-derived shoal IDs, locations, qualities and environmental
  clues in a namespace that cannot move islands or alter terrain.
- Add latent and sighted states without granting an economic benefit.
- Keep accepted island discoveries unchanged while the new opportunity model
  is proven.

Acceptance gate: the same world/content version produces the same shoals and
quality outcomes; clues do not reveal fogged terrain; sightings and survey
results cannot reroll after reload; existing terrain, island and discovery
identities do not change.

#### GP-1.2 — Survey action and limited capacity

Status: accepted.

Acceptance evidence (2026-07-12): the headless fishing owner exposes one
non-stacking survey case, derived exhaustively from the current allocation's
authoritative provisional state. Initial play and completed dock/respawn
allocations have one case; a survey atomically changes one sighted record to
surveyed and leaves zero, while Leave and every rejected command are
mutation-free. Wreck holds are non-interactive and reload preserves spent
capacity. Schema V3 admits at most one surveyed provisional record; every
other schema version is incompatible with that build. A temporary clue-and-case
ribbon supplies real Survey/Leave buttons, `F`/`Escape` keyboard controls and
contextual pointer or touch activation; Leave stays dismissed until the player exits, and the
1.2-second survey cue is presentation-only. Browser acceptance exercised both
buttons and the keyboard survey path with no console warnings/errors. The full
pipeline passes 162 tests across 18 files plus typecheck and production build;
proximity work remains bounded to four definitions and adds no world scan or
permanent sailing HUD.

- Add a proximity **Survey / Leave** decision.
- Begin with one fixed survey case for each new expedition allocation;
  GP-3.1 later supersedes that case with the standard provision allocation.
- Exact-home-dock replenishment or post-wreck respawn intentionally creates the
  next one-case allocation; unused cases do not accumulate between voyages.
- Sailing past a clue is free; surveying consumes a case and a short in-world
  action.
- Use developer graphics and no permanent sailing HUD.

Acceptance gate: the player can knowingly spend or preserve the case; no case
means no survey; dock, wreck and reload paths perform the one intentional
replenishment without duplicate or unearned cases; keyboard, pointer and any
approved contextual touch input work.

This accepted milestone records the original GP-1 behavior. GP-3.1 explicitly
supersedes its fixed survey case and Survey / Leave interaction with
provision-funded, supply-limited surveying; it does not rewrite GP-1's
historical acceptance evidence.

#### GP-1.3 — Provisional, returned and lost surveys

Status: accepted.

Acceptance evidence (2026-07-12): authoritative returned records are separate
from active-expedition provisional records, with exactly one legal overlap: a
returned lead plus its provisional surveyed upgrade. Exact-dock return commits
sightings as inherited inactive leads and surveys as terminal returned surveys;
wreck rollback removes only provisional state, so an earlier lead survives an
unsuccessful upgrade voyage. Returned surveys are the sole later-activation
eligible state and remain idempotent across revisit, repeat input, dock, wreck,
autosave and checkpoint round trips. Schema V4 adds sorted returned records;
other schema versions are rejected and removed. Faint provisional/lead marks
and the automatic dock report remain revision-driven, pooled, viewport-culled
and coalesced with the existing return cue. The full pipeline passes 166 tests across 18 files plus
typecheck and production build. Browser validation covers lead return, a later
Supported-water survey upgrade, exact-dock commit, terminal revisit and manual
checkpoint reload with the expected authoritative state throughout.

- Complete the branching lifecycle:
  - latent → sighted/provisional → returned lead when reported safely without
    surveying; a returned lead is inherited but inactive;
  - latent → sighted/provisional → surveyed/provisional → returned survey when
    the investigation is safely reported;
  - returned lead → surveyed/provisional upgrade → returned survey when it is
    investigated on a later expedition and safely reported. Until exact-dock
    return, the committed returned lead remains the rollback state, so a
    wreck discards only the provisional upgrade and leaves the returned lead
    intact.
- Treat a returned survey as terminal and idempotent for GP-1. Later sightings,
  survey input, docking and wreck resolution leave its record and deterministic
  outcome unchanged; they do not consume another case, create provisional state
  or duplicate its return commit or report.
- Add distinct faint provisional and returned-lead marks plus a concise
  automatic dock report.
- Commit only at the exact home dock; remove a failed expedition's provisional
  state without deleting the deterministic opportunity or any prior returned
  state.

Acceptance gate: clue, provisional sighting, returned lead, provisional survey
and returned survey are distinct; a later survey of a returned lead commits
only on exact-home-dock return and a wreck restores the same returned lead; a
returned survey is terminal and idempotent across revisits, repeat input,
dock/wreck handling and repeated autosave/manual-checkpoint round trips from a
record containing that state, with no additional case consumption, reroll, or
duplicate record, report or commit; only a returned survey is eligible for
later activation; existing provision, route-growth, wreck and generation rules
remain unchanged.

#### GP-1.4 — Returned-ground cue and connectivity proof

Status: accepted.

Acceptance evidence (2026-07-12): the exact saved-world `homeReturnTile` and
seed-derived opportunity `serviceAnchor` are the connectivity endpoints. A
cached flood uses passable Supported cells only, cardinal movement and a fixed
north/east/south/west tie-break; both endpoints must themselves qualify. The
world exposes a dedicated Supported-topology revision, so Personal knowledge,
visibility and ordinary frames do not rebuild the search. Only a connected
returned survey enters the derived activation-eligible set. It receives a
double-diamond beacon, glow ring, four cardinal rays and explicit home-linked
label; a disconnected returned survey keeps its ordinary returned mark, and
leads/provisional surveys cannot structurally request the cue. Connectivity and
paths are derived after load and never enter schema V4. The full pipeline passes
173 tests across 19 files plus typecheck and production build. Fresh-browser
validation loaded the GP-1.3 returned survey, rebuilt one connection, showed the
beacon, preserved it across manual checkpoint reload and produced no console
warnings or errors.

- Define an opportunity service anchor and a deterministic home-connected
  Supported-water eligibility check.
- Show one unmistakable developer-art cue for an eligible returned survey.
  This remains a derived, non-economic proof. Sparse fishing and trade traffic
  remains presentation-only work for a separately planned future graphics
  milestone; an authoritative tribe economy, output model or automatic trade
  system requires a separately approved future gameplay major.

Acceptance gate: returned leads and provisional surveys never show the cue;
returned surveys show it only with a valid Supported connection; connectivity
uses stable endpoints and tie-breaking; the cue is not serialized and does not
affect navigation.

Major acceptance: players understand that they noticed, chose to survey,
returned and caused a visible inherited change.

### GP-2 — Explorer lives, generations and lineage history

Goal: turn the existing generation counter into a sequence of distinct
explorers, prevent one explorer from serving forever and preserve meaningful
credit across the lineage.

#### GP-2.1 — Navigator and succession model

Status: accepted.

Acceptance evidence (2026-07-13): a dedicated lineage authority owns stable
versioned navigator IDs, lifecycle history and deterministic succession keys.
Wreck rollback terminalizes the outgoing navigator before the unchanged
four-second presentation, while completion creates exactly one successor.
Schema V5 first required a coherent lineage and pending-wreck fragment;
subsequent exact-version contracts supersede it rather than migrate it. A
mid-hold save/reload finishes the same key once
without duplicating or skipping a generation. The simulation snapshot and
browser diagnostics expose navigator
identity without moving authority into presentation. All inherited Supported
water, returned content and persistent wrecks retain their prior behavior. The
full pipeline passes 182 tests across 20 files plus typecheck and production
build.

- Give each navigator a stable ID and lifecycle state.
- Centralize succession reasons such as wreck and completed tenure.
- Preserve the four-second wreck sequence and inherited world state.

Acceptance gate: every succession creates exactly one navigator/generation;
reload during a current-version transition cannot skip or duplicate it;
non-current lineage contracts are rejected and removed.

#### GP-2.2 — Four-voyage navigator tenure

Status: accepted.

Acceptance evidence (2026-07-13): each navigator may complete at most four
numbered voyages. Only an active expedition's successful exact-home-dock
return completes a voyage; inactive docking, replenishment, idle time,
distance, travel time and reload do not. Returns one through three commit their
results and replenish normally. The fourth return commits normally and then
completes the navigator's tenure, immediately creating exactly one successor
without a retirement choice or fifth voyage. A wreck during any voyage is
fatal: it records the navigator as lost, preserves the four-second wreck
presentation and creates exactly one successor after the pending transition.
Every succession presents the required handover mode of the Great Hall: a
completed tenure shows the exact-dock-committed achievements from all four safe
voyages, while an early loss shows the committed earlier voyages followed by
the numbered voyage on which the navigator was lost at sea. The focused
handover entry includes route-
support counts, discovery names, fishing leads and surveys, and returned wreck
identities; it never credits provisional results from a fatal voyage. The
GP-2.3 chronicle reuses that same focused navigator entry in the permanent home
archive and adds derived lineage aggregates. A later navigator can sight an
unidentified runtime wreck, spend the existing one-per-voyage survey case to
identify it provisionally, and commit that identity/fate report only by
returning to the exact home dock. Retirement actions and their dock ribbon are
absent. The full verification pipeline and browser acceptance cover the voyage
status, both succession summaries, fatal-wreck transition, wreck-survey commit
and rollback, and a clean warning/error console. The full pipeline passes 215
tests across 23 files plus typecheck and production build.

- Complete one numbered voyage only on an active expedition's successful
  exact-home-dock return, after its island leads, dossiers, surveys and
  knowledge commit.
- After returns one through three, replenish and begin the next voyage with
  the same navigator; after return four, complete the tenure and create exactly
  one successor through the shared succession authority.
- Let a wreck during any voyage kill the navigator early, preserve the
  existing four-second wreck sequence and create exactly one successor when
  that persisted transition completes.
- At each fourth-return or fatal-wreck succession, show the required handover
  mode of the shared Great Hall for the outgoing navigator. For every safely
  returned voyage, list the
  Supported-route and enclosed-water counts, returned island leads and dossier
  findings, fishing leads and surveys, and returned navigator-wreck identities
  committed on that exact-dock return. Show an explicit no-new-findings message when all those
  categories are empty. Follow the committed rows with **Lost at sea** at the
  fatal voyage when applicable, and never credit that voyage's provisional
  results. Persist the unacknowledged handover and per-voyage records, reopen
  them unchanged after reload and suppress authoritative sailing until the
  player begins the successor's generation.
- Keep a later generation's sighting of a runtime player wreck unidentified
  until the player deliberately surveys it. Surveying spends the existing
  one-per-voyage survey case and makes the wreck's navigator identity and fate
  provisional to that expedition. Exact-dock return commits the report; a
  wreck before return discards it so the persistent wreck can be surveyed
  again. This adds no salvage, cargo, chart restoration or economy reward.
- Treat every return-to-next-voyage and wreck-to-successor boundary as elapsed
  world time. Safe-return transitions are immediate; wrecks retain only their
  existing four-second presentation hold, with no additional timed or
  wall-clock wait and no economy accumulation. The acknowledgement gate still
  suppresses sailing. The required committed-achievement summary makes the
  generation handover legible; later presentation may show derived world
  changes there or give the shared handover mode a richer mourning/ceremony
  presentation. Any future authoritative settlement system requires separate
  approval and is not implied by this boundary.
- Keep the limit legible through the existing navigator status and return cues
  as **Voyage n of 4**; add no retirement decision interface.

Acceptance gate: the fourth exact-dock return commits before generation
advances exactly once; the same navigator can never begin a fifth voyage; a
wreck at any voyage count ends that navigator without crediting the failed
expedition; reload cannot consume, skip or duplicate a voyage or succession;
inactive docking consumes no voyage; and inherited world state survives both
completion and loss. Status/checkpoint restoration shows the correct next
voyage and no retirement control remains. The required Great Hall handover
mode reconciles exactly with the outgoing navigator's safe-return count,
committed voyage records and fatal voyage, suppresses sailing while open and
never displays provisional achievements. A
runtime wreck is reported at most once to its correct lost navigator; sight,
survey, repeat input, exact-dock return, survey-expedition loss and reload are
  idempotent, and a failed report never restores the lost expedition's Personal
  chart or provisional findings.

#### GP-2.3 — Great Hall voyage chronicle

Status: accepted.

Acceptance evidence (2026-07-13): one versioned, ephemeral chronicle read model
derives active, completed and lost navigator entries directly from the
authoritative lineage and returned island-dossier, fishing and runtime-wreck
records. Stable navigator/voyage/achievement keys, per-navigator totals and
lineage totals are derived rather than persisted. The required GP-2.2
succession gate and the optional archive render the same navigator entry: the
handover mode focuses the outgoing navigator and can only continue through
**Begin generation n**, while home mode is dismissible and browses every
generation, including the active navigator's committed returns. **Go ashore ·
Great Hall** is available only at the exact home dock; returns one through
three update the chronicle and retain their concise dock cue without forcing it
open. A lost navigator remains **Wreck not yet located** until a later
exact-dock-returned identity report links that fate confirmation back to the
lost entry while preserving credit on the reporting voyage. No new save state,
schema migration or aggregate ledger was added. The full pipeline passes 220
tests across 24 files plus typecheck and production build.

- Present GP-2.2's four numbered, committed voyage records as a permanent,
  browsable Great Hall history and extend their stable achievement categories
  with later returned landfalls, connections and idols at their owning gates.
- Show all four returned voyages for a completed tenure. For a navigator lost
  early, show their completed voyages plus a respectful terminal lost-voyage
  record; never credit provisional achievements from that fatal expedition.
- Maintain lineage-wide aggregates. Optional browsing is available only from
  the exact home dock; important returns update the archive without forcing it
  open, and succession opens it automatically. It is never a sailing score HUD.
- Reuse GP-2.2's committed transition records in the permanent chronicle. The
  bounded handover is the required succession mode of that shared Great Hall;
  generation browsing and aggregates remain exclusive to its optional home
  mode.
- Show a lost navigator as **Lost at sea** before their wreck is located. When
  GP-2.2's provisional wreck-identity survey is returned, attach the confirmed
  wreck and fate report to the correct navigator. Generic wreck salvage,
  bounded chart recovery and economy effects are explicitly deferred.

The chronicle presentation begins after GP-2.2 supplies stable voyage ordinals,
terminal states and committed summaries, but each later category is integrated
at its owning gate: returned surveys after GP-1.3, returned island dossiers
after GP-3.2, returned survey-site results after GP-3.3 and returned idol-location
findings after GP-4.1. Stable achievement keys must include navigator and voyage
identity and prevent duplicate credit.

Acceptance gate: only exact-dock-committed achievements receive credit; four
numbered positions reconcile with each navigator's completed-voyage count and
terminal state; no reload or checkpoint replay duplicates credit; navigator and
lineage totals reconcile; provisional information never appears as permanent
history.

### GP-3 — Provision-funded surveying and discoverable places

Goal: make expedition supplies support repeated, meaningful investigation and
expand surveying from the first fishing and navigator-wreck cases to islands
and an extensible set of world sites. GP-3 adds no tribe economy, output model,
voyage loadouts, automatic trade or generic wreck-salvage system.

#### GP-3.1 — Provision-funded surveying

Status: accepted.

This milestone supersedes GP-1's accepted fixed, non-stacking survey case while
leaving that historical acceptance record intact.

- Guarantee the same standard provision allocation at the beginning of every
  journey. GP-3 adds no selectable loadout, tribe reserve or recovery tier.
- Remove authoritative survey-case state and remove the **Leave** command,
  button and keyboard action. Seeing a clue and sailing past it remain free.
- Keep the contextual survey prompt non-modal. It offers only **Survey**, stays
  out of the sailing HUD and automatically dismisses when the ship leaves the
  target's interaction range; returning to range may show it again.
- Give each survey target a deterministic provision cost. Before confirmation,
  show both that cost and its projected impact on the known return route using
  the same provision budget and return-path authority as sailing.
- Apply the provision spend and provisional survey result as one authoritative
  transaction. A rejection, stale command, duplicate command or failed
  validation changes neither supplies nor target state.
- Allow multiple surveys on one journey while provisions remain. Surveying is
  supply-limited rather than capped by a separate case counter.

Acceptance gate: every journey begins with the standard supplies exactly once;
sighting, prompt dismissal and sailing away cost nothing; a successful survey
spends the displayed provisions exactly once and immediately refreshes
forward/return guidance; insufficient supplies reject without mutation;
repeat input and current-version reload cannot spend or award twice; fishing-
ground and navigator-wreck surveys retain exact-dock commitment and wreck
rollback; the non-modal prompt never suppresses sailing and sail-away dismissal
requires no Leave action.

Acceptance evidence: the fixed survey allocation and Leave path are absent;
fishing-ground and navigator-wreck surveys share a configurable two-bundle
cost, expose remaining supply and projected return margin, and commit the spend
with provisional state atomically. Multiple targets can be surveyed during one
journey, fractional travel spend is included in affordability, and steering
remains live while the prompt is visible. At this historical GP-3.1 acceptance
gate, exact-version schema 10 rejected old saves; accepted GP-3.2 subsequently
bumped the current schema to V11. The GP-3.1 typecheck, 227-test suite and
production build passed.

#### GP-3.2 — Island landfalls and single-dossier surveys

Status: accepted.

Depends on GP-3.1's provision-funded survey transaction and the accepted stable
island identity, sight and exact-dock expedition boundaries.

Acceptance evidence (2026-07-13): island-dossier content V1 derives exactly one
stable definition, deterministic name and descriptive result from each non-home
island ID. Every exact-island footprint has a sorted set of passable,
dock-reachable coastal approaches within 1.5 tile widths; the canonical
approach is a developer/presentation convenience rather than the only valid
interaction point. Current sight records a free provisional lead without
exposing the hidden result. The shared provision-funded **Survey** transaction
upgrades either that sighting or a returned lead exactly once. Exact-dock return
commits a lead or dossier with expedition/generation provenance, while wreck
rollback removes only the active expedition's provisional work. Surveyed state
suppresses fog on every tile carrying that exact island ID and on no surrounding
water or other island, without mutating knowledge, topology, travel cost or
route credit. The legacy `DiscoverySystem` and its island discovery records are
removed. Exact save schema V11 validates island-dossier content V1 and lineage
contract V5; the Great Hall V2 read model gives distinct, idempotent island-lead
and island-dossier achievements and lineage totals. Developer placeholder
markers, a Survey-only coastal prompt and next-island-dossier inspection support
the complete loop. The GP-3.2 typecheck, 244-test suite across 26 files and
production build pass.

- Make first sight of a non-home island free. It records a provisional island
  lead without spending provisions or revealing the island's full dossier.
- Derive a coastal approach ring from the exact generated island footprint.
  A dock-reachable passable water tile is a valid approach when the Euclidean
  distance between its center and the center of at least one tile carrying that
  exact island ID is at most 1.5 tile widths. The interaction is not tied to
  one arbitrary marker or to land movement.
- Give each exact island ID one deterministic dossier and at most one dossier
  survey state. Surveying from any valid approach tile uses GP-3.1's cost and
  transaction; repeated approach tiles cannot create duplicate dossiers.
- Fold the former one-per-island generated discovery into that dossier's
  descriptive result. Retire its `HistoricWreck` and `FishingGround` outcomes
  as separate island-discovery target types: GP-3.3 sites and
  GP-1 shoals are the only authoritative historic-wreck and fishing targets.
- Preserve the returned-lead branch. Exact-dock return of a sighted but
  unsurveyed island commits an inherited lead. Surveying a provisional sighting
  or a returned lead creates a provisional dossier; exact-dock return commits
  it, while a wreck removes that expedition's provisional sighting/dossier and
  restores any previously returned lead.
- Derive full reveal of tiles carrying that exact island ID from the
  provisional or returned dossier. This fog presentation does not write
  `KnowledgeState`, reveal other islands or water, change travel cost, create a
  Supported route or mutate generated terrain.
- Add no separate historic-wreck, ruin, cave or other site leads in GP-3.2; the
  island itself is the single survey target and dossier owner, and its dossier
  neither spawns nor unlocks a nested point target.

Acceptance gate: sighting and naming an island is free; every eligible approach
tile is derived from the exact footprint and is passable and dock-reachable;
one island ID can produce only one deterministic dossier regardless of approach
tile, revisit or reload; lead, provisional dossier and returned dossier remain
distinct; wreck rollback loses only the current expedition's work; exact-dock
return commits once; full exact-island-ID reveal appears and rolls back from
dossier state without changing knowledge counts, route costs, connectivity,
terrain or another island's fog; legacy island discovery categories cannot
duplicate a GP-1 shoal or GP-3.3 site.

#### GP-3.3 — Extensible survey sites

Status: accepted.

Depends on GP-3.1's survey transaction and GP-3.2's accepted separation between
island dossiers, fog presentation and generated terrain.

Acceptance evidence (2026-07-13): survey-site content V1 derives exactly one
historic wreck, one coastal ruin and one tidal cave from the seed, each with a
stable typed ID, independently sightable clue tile, passable dock-reachable
service anchor, deterministic hidden result and developer placeholder
presentation. All three descriptors use the same free `sighted`, shared two-
bundle `surveyed`, returned `lead` / `report` and wreck-rollback lifecycle.
Island dossiers neither spawn nor unlock sites; historic sites remain distinct
from runtime navigator wrecks. A synthetic fourth descriptor passes the shared
catalog/lifecycle contract without a new command, reducer or persistence
fragment. Exact-dock site credit uses lineage V6 voyage records V3 and Great
Hall V3 lead/report achievements and totals. Save schema V12 accepts only exact
survey-site content V1 and persists minimal provenance records; definitions and
hidden results regenerate. Developer controls move directly to each initial
type's service anchor. Typecheck, 262 tests across 28 files and the production
build pass. Browser acceptance confirms the three matching service-anchor
interactions, live unsuppressed input with the drawer open, Survey-only prompt,
developer placeholder art and a clean warning/error console.

- Add one versioned, seed-derived survey-site catalog whose only content types
  shipped in GP-3.3 are **historic wreck**, **coastal ruin** and **tidal cave**.
  Historic sites remain distinct from runtime wrecks left by lost navigators.
- Give all three types the same free sighting, non-modal prompt,
  returned-lead branch, provision-funded survey, provisional result, exact-dock
  return and wreck-rollback mechanics. A data-driven type descriptor supplies
  placement, clue, result vocabulary and presentation IDs rather than changing
  the lifecycle.
- Let types differ only where content should differ: stable placement rules,
  environmental clues, deterministic survey results and developer/production
  art. Adding a later non-idol site type must not require another interaction or
  persistence model.
- Keep every site independently seed-derived and directly sightable. Island
  dossiers do not spawn, unlock or point to these sites; chained leads and
  nested site-within-island discoveries are deferred expansion work.
- Treat each result as descriptive returned knowledge and Great Hall credit.
  GP-3.3 results do not refill provisions, reveal water routes, create safe
  waypoints or generate follow-on leads.
- Keep site definitions separate from terrain and island generation authority;
  sites may attach to stable island/coastal anchors but cannot edit collision,
  island IDs, `KnowledgeState` or travel costs.
- Add no idols, idol clues, relic cargo, archive progress or completion state.
  Those remain exclusively GP-4 work.

Acceptance gate: the same seed/content version produces the same site IDs,
types, placements, clues and hidden results; all initial types pass one shared
lifecycle and survey-cost contract; unsurveyed state never reveals hidden
results or clears area fog, while a successful survey reveals its result only
to the active expedition until exact-dock return; return and wreck rollback are
idempotent across reload; runtime navigator wreck identity remains unambiguous;
a synthetic fourth non-idol descriptor can pass the shared contract tests
without a new command, reducer or save fragment, but it does not ship as
GP-3.3 content; no idol state exists.

### GP-4 — Lost idol locations and lineage completion

Goal: make the lineage's finite long-term objective the discovery and safe
return of knowledge describing every idol location lost when the world split
into islands. Idols are never recovered or transported as physical objects.

#### GP-4.1 — Lost idol locations and game completion

Status: implemented and accepted.

Depends on GP-3.3's accepted deterministic survey locations and GP-2.3's stable
navigator, voyage and Great Hall credit.

- Add a finite, separately versioned idol-location catalog. Each world configures
  a positive idol count; the default world uses exactly three. Deterministically
  select that many unique eligible survey locations without replacement, with
  at most one idol per location. Reject a world configuration whose count
  exceeds its eligible locations rather than silently reducing it.
- Make every current seed-derived survey location eligible except fishing
  shoals: one-dossier non-home islands plus historic-wreck, coastal-ruin and
  tidal-cave sites. Runtime navigator wrecks are dynamic fate-report locations,
  not seeded idol hosts. Future survey families must declare whether they are
  eligible.
- Keep the idol mapping hidden until its host is surveyed. Add no advance idol
  marker, remote clue chain or idol-specific command. The existing
  provision-funded **Survey** action yields its normal result plus a special
  provisional idol-location finding when the host contains one.
- Reuse the host survey's expedition ownership. A wreck discards the provisional
  idol finding so it can be discovered again; exact-dock return commits it once.
  No physical idol, recovery action, cargo, loss site, currency, power or upgrade
  exists.
- Record each returned idol-location finding as a distinguished achievement in
  the existing Great Hall for the exact navigator and voyage that brought the
  knowledge home. Show returned-location progress against the configured total
  without revealing any undiscovered host. Do not add a Gem Hall, Relics wing or
  normal-sailing score HUD.
- After exact-dock settlement returns the final location, commit the finding and
  Great Hall credit first, then present the final Great Hall with the completed
  lineage history and two choices:
  - **Continue Exploring** returns to the same completed world at home. Completion
    can never trigger again, ordinary voyage/succession/discovery play continues
    indefinitely, and the Great Hall remains normally accessible for later
    viewing.
  - **Start New Game** discards the current in-session world and starts a fresh
    lineage with a newly generated seed that cannot equal the prior world's
    seed.
- If the final return is also a navigator's fourth voyage, show the final Great
  Hall first. Continuing then resumes the required succession handover before
  further sailing. Starting a new game discards that pending transition with the
  rest of the completed world.

Acceptance gate: the default seed contains exactly three unique idol hosts; the
same seed, idol count and content version produce the same order-independent
idol-to-host mapping; every host is an eligible existing survey location and no
fishing shoal or runtime navigator wreck can host one; hidden read models expose
the total but no undiscovered location; normal survey cost, provisional state,
wreck rollback and exact-dock commitment remain exactly-once and idempotent; the
Great Hall credits the correct navigator/voyage without duplicates; only the
final returned location opens the final Great Hall; **Continue Exploring** can
never replay completion and preserves normal Great Hall access; **Start New
Game** resets all world/lineage state with a different seed; catalog generation
changes no terrain, island identity or existing survey placement and adds no
full-world fixed-update work. Saving and production art remain out of scope.

Implementation evidence: idol-location contract/content V1 selects immutable
unique hosts from canonical eligible inputs and validates the configured count;
the simulation derives provisional, returned and lost idol knowledge from host
survey state; Great Hall read model V4 derives exact navigator/voyage credit and
safe returned/total progress; completion has explicit `awaiting-choice` and
non-retriggering `continued` states; scene presentation gives the final Hall
priority over ordinary return and succession cues. Catalog, integration, Hall,
completion-choice, seed-reset and final-voyage-order tests are part of the clean
typecheck/test/build gate recorded in `IMPLEMENTATION_STATUS.md`.

### GP-5 — Voyage Sense presentation

#### GP-5.1 — Voyage Sense thread

Status: implemented and accepted on 2026-07-16.

Replace the filled and patterned grid presentation of return viability with one
faint, soft-edged thread following the ordered minimum-provision route from the
ship to the first reachable Supported water. Preserve return pathfinding,
eligibility, provision costs, and risk thresholds as simulation authority.

- The presentation adapter consumes `ReturnPathResult.pathIndices`; the padded
  corridor remains diagnostic data and is never used as thread geometry.
- Cardinal route turns become restrained quadratic curves whose entry and exit
  consume no more than half an adjacent route edge. The curve therefore remains
  inside the traversable route-tile envelope rather than appearing to cut
  through blocked terrain.
- Sparse line and curve segments are indexed by chunk once per changed route.
  Active chunk textures draw only their indexed segments with a narrow core and
  wider low-opacity edge; stable frames do not reconstruct the path or allocate
  textures.
- One state colours the complete thread green for comfortable supply, yellow
  for a narrowing margin, orange for critical supply, and red when the known
  route costs more than the available supply. Already-safe and unreachable
  states draw no thread.
- Thread width, curve radius, and opacity are validated live presentation
  tuning values. The Voyage Sense legend uses the same four-line colour
  language rather than filled grid swatches.

Acceptance evidence: focused geometry and rendering contracts cover curved
turns, chunk seams, empty routes, ordered-path rather than corridor consumption,
all four risk colours, resource telemetry, route replacement, and stale
clearing. Existing return-route tests continue to cover deterministic shortest
paths, threshold reclassification, already-safe and disconnected worlds, and
regeneration. Architecture validation, source and test typechecks, the quick
lane, focused contracts, integration tests, and the production bundle pass.
Browser review at normal gameplay zoom confirmed the faint green turning route,
the same route recoloured red at zero supply, the four-state legend, and no
browser warnings or errors. The repository-wide aggregate remains independently
blocked by stale production-asset catalog expectations recorded in
`IMPLEMENTATION_STATUS.md`; GP-5.1 does not change asset inputs or artifacts.

#### GP-5.2 — Voyage Sense supply commitments

Status: implemented and accepted on 2026-07-16.

The compact cargo rack now presents the exact authoritative supply partition
without visible words or numbers. A renderer-neutral model divides physical
bundles into natural uncommitted material, depleted fractional travel spend,
the shortest-known-return commitment in the Voyage Sense risk colour, and a
sea-glass cyan survey commitment only while an authoritative prompt is present.
Partial costs occupy partial bundle widths and insufficient commitments never
create fictitious icons. Survey presentation reserves its quoted cost first and
colours the remaining return allocation from the projected post-survey margin.
Its breathing outline becomes static under reduced-motion preference. Exact
quantities, safe/unknown return state, and shortfalls remain in the visually
hidden live status.

Acceptance evidence: renderer-neutral contracts cover fractional spend and
return partitions, projected survey partitioning, insufficient return and
survey supply, safe and unknown routes, and invalid physical inputs. Existing
survey contracts continue to prove authoritative quoted costs and affordability.
Architecture validation, source and test typechecks, the quick lane, and the
focused presentation contract pass. Browser review at normal gameplay zoom
confirmed the graphics-only twelve-bundle rack, fractional green return tint,
two-bundle survey glow, immediate hidden-status updates, and no browser warning
or error output. The unrelated aggregate asset-validation blocker remains
recorded in `IMPLEMENTATION_STATUS.md`.

## Graphics track

### GR-0 — Developer graphics contract

Status: active baseline contract, not a production-art milestone.

- Every GP minor receives functional placeholder presentation.
- Developer assets remain the fallback after the production pipeline exists.
- Gameplay remains readable under fog, Personal grey and risk overlays.
- Missing production assets never block gameplay testing.

Acceptance gate on every GP minor: each new authoritative state is
distinguishable at normal zoom, overlays remain readable and presentation does
not define collision, identity or rules.

### GR-1 — Authored-asset runtime pilot

Start gate: satisfied because GP-3.3 is accepted. The ordered `GR-1.1` through
`GR-1.4` batch is complete and accepted.

Goal: prove the smallest useful path from externally generated source art to
grid-aligned runtime assets. Asset generation and preparation happen before the
game loads them. The runtime procedurally places complete authored assets; it
does not generate an island by selecting and joining interchangeable terrain
squares.

The ordered pilot covers exactly one authored home island, the player boat and
one fishing-shoal representation. The example images under
`concept_art/example assets` are reference material only and must not be loaded
or adapted directly as runtime assets.

#### GR-1.1 — Authored asset and grid-metadata contract

Status: implemented and accepted.

Define the minimal semantic IDs and metadata needed by the pilot:

- source and derived-runtime identity for the home island, player boat and one
  shoal;
- grid dimensions, placement origin, render offsets, scale and depth;
- an authored home-island cell map describing terrain, collision, shallows,
  harbour, dock and return/service anchors;
- boat origin, visual bounds and heading/animation behavior; and
- shoal footprint, passability and service anchor.

A whole island may be cut into runtime slices for texture limits, grid
alignment, fog or culling, but those slices remain parts of one authored
composition. The runtime may not rearrange them into a new island. Rendered
pixels are never sampled for gameplay; validated metadata supplies the logical
shape and anchors.

Acceptance gate: contract fixtures reject missing cells, overlapping or
out-of-range slices, invalid anchors, inconsistent dimensions and a blocked
dock approach; the complete authored home layout maps exactly onto the
navigation grid; boat and shoal contracts have unambiguous origins and bounds;
and no contract requires a viewer, editor, asset-lifecycle registry or general
non-home-island refactor.

Implementation evidence: authored asset contract V1 fixes semantic IDs for the
home island, player boat and pilot fishing shoal; validates complete cell maps,
terrain-derived collision, exact dock/return/service anchors, fixed render
slices, normalized origins, all-heading boat metadata and passable read-model-
gated shoals; and rejects invalid layouts before runtime integration. The clean
typecheck, 245-test and production-build gate passes.

#### GR-1.2 — Minimal package loading

Status: implemented and accepted.

Add the smallest runtime boundary that loads the three accepted packages and
their metadata when the game starts. A typed catalog maps semantic IDs to
runtime files and validated metadata. It supports a whole texture or ordered
slices from the same authored composition and keeps filenames out of gameplay
and renderer call sites.

This minor does not add candidate/approved/deprecated lifecycle states,
deterministic visual variants, atlas automation, hot swapping or a generalized
resolver. Existing developer graphics remain the explicit fallback when a
package cannot load or validate.

Acceptance gate: all three packages preload before their renderers are created;
valid packages resolve by semantic ID; missing images and invalid metadata fail
legibly and preserve usable developer presentation; regeneration does not
duplicate textures or display objects; and loading stays within the approved
pilot memory and startup-time budgets.

Implementation evidence: a typed three-package catalog queues metadata and four
runtime textures in scene preload; contract validation and image-reference
checks build a semantic-ID runtime before renderers are created; a failed
package stays unavailable and reports a developer-log diagnostic while the
other packages remain usable. The prepared source and runtime images live
outside the example-assets reference folder. The clean typecheck, 250-test and
production-build gate passes.

#### GR-1.3 — Home island, boat and shoal proof

Status: implemented and accepted.

Generate new grid-ready art for the current game rather than using the example
assets directly. Integrate:

- one complete authored home-island composition, stamped at the procedural
  world's home placement from its validated terrain and anchor metadata;
- one player-boat asset using the current continuous position and heading; and
- one fishing-shoal asset at one deterministically selected existing shoal,
  while all other shoals retain developer presentation.

The home island's shape comes from its authored package, not the existing
radius/noise painter or runtime tile assembly. World placement, island identity,
ship movement, shoal placement and discovery state remain procedural and
authoritative. Fog, knowledge, risk, route and interaction presentation remain
separate runtime layers.

Acceptance gate: the authored home layout produces a reachable dock and the
expected land/shallow/collision map at the home anchor; the boat remains aligned
through turning, sailing, docking, teleport and wreck/reset presentation; the
chosen shoal remains passable, appears only when its existing read model permits
and preserves its full survey/return/wreck lifecycle; all three assets remain
readable at normal zoom under fog and overlays; unchanged gameplay outside the
home layout passes regression tests; and the approved startup, memory, draw-call
and frame-time budgets pass.

Implementation evidence: the validated fixed home layout now replaces the
seeded radius/noise home painter and stamps terrain, collision, home identity
and anchors at the procedural world center without entering the non-home island
catalog. The complete authored island image replaces home developer art over a
seamless ocean backdrop; the generated boat follows the existing continuous
position and heading; and only `fishing-shoal:v1:0000` receives the authored
passable shoal cue through its existing fog-filtered read model. Missing
packages still use developer presentation. The clean typecheck, 253-test,
production-build and local-browser visual gate passes.

#### GR-1.4 — Directional boat and wake animation

Status: implemented and accepted.

Turn the GR-1.3 player-boat proof into a finished animated vessel. Use the
simplest animation approach that remains convincing at the game's normal zoom:
directional frames or a rotation-safe sprite for every heading, restrained hull
or sail motion, and a speed-responsive wake animation while moving. Animation
is presentation-only and continues to follow the interpolated simulation pose.

The boat must look intentional rather than mirrored or upside down at every
heading. Its origin, visual footprint, heading convention and animation timing
belong to the authored package metadata. Wake frames or particles remain a
separate layer behind the boat, stop promptly when stationary and do not affect
movement, collision, fog or voyage state.

Acceptance gate: representative cardinal, diagonal and wraparound headings have
the correct bow direction and stable origin; turns do not pop, mirror or drift
off the simulation position; motion animation is restrained and legible; wake
direction, intensity and cadence respond to speed and disappear at rest; the
boat remains correct during forward/reverse movement, docking, teleport,
wreck/reset and camera zoom; and the approved memory, draw-call and frame-time
budgets pass.

Implementation evidence: the rotation-safe east-authored boat follows the
interpolated pose continuously through cardinal, diagonal and wraparound
headings. A metadata-driven scale pulse adds restrained motion without shifting
the ship origin. The separate wake image sits below the vessel, rotates and
offsets along signed travel direction, scales and pulses with absolute speed,
reverses correctly, and hides below its configured minimum speed or whenever
the boat is hidden for wreck presentation. Teleport and dock/reset poses clear
speed, so the wake stops immediately. The clean typecheck, 264-test and
production-build gate passes.

### GR-2 — Asset viewing, collision and local authoring

The ordered `GR-2.1` through `GR-2.5` batch is implemented and accepted. The
user verified the final saved home-island mask in gameplay; the separately
planned `GR-2.6` expansion was therefore skipped for now.

#### GR-2.1 — Runtime asset viewer

Status: implemented and accepted.

Implementation evidence: a separate `?mode=assets` route uses Phaser and the
same package metadata/presentation path as the game. Its concept-inspired left
browser and unified inspector cover the three runtime packages plus 20 lazy
source references without requiring a voyage.

#### GR-2.2 — Candidate intake and creation workbench

Status: implemented and accepted.

Implementation evidence: versioned visual and collision candidate contracts,
portable export/import and authoritative repository intake reject unknown IDs,
bad images, incompatible metadata, stale revisions and unsafe replacement. The
closed pilot runtime IDs retain their existing gameplay authority.

#### GR-2.3 — Conditional build automation

Status: implemented and accepted.

Implementation evidence: deterministic catalog generation, image inspection,
bounded thumbnails, reports and stale-output checks run before compilation in
the normal asset gate. No atlas or general asset service was introduced.

#### GR-2.4 — Hybrid navigation and collision-mask contract

Status: implemented and accepted.

Implementation evidence: sparse `8`-pixel overrides refine `32`-pixel
navigation cells; exact swept-hull collision and clearance-derived navigation
edges share semantic package metadata. Passable shoals use an explicit empty
shape, while all current runtime collision categories have inspectable shared
profiles.

#### GR-2.5 — Asset-viewer collision-mask editor

Status: implemented and accepted.

Implementation evidence: the selected-asset inspector supports `8`-pixel detail
and `32`-pixel whole-cell brushes, paint/erase/fill, selection, undo/redo,
zoom/pan and per-asset drafts. **Save to library** performs a revision- and
fingerprint-protected loopback transaction that updates package collision
metadata without replacing art. The accepted home-island mask was subsequently
loaded and verified in gameplay.

### GR-3 — Production-asset prototype

The `GR-3.1` through `GR-3.8` sequence established a deterministic local
source-to-promotion workflow and isolated collision trial without expanding
runtime world-placement authority.

#### GR-3.1 — Production recipe manifest

Status: implemented and accepted.

Implementation evidence: a strict version-one recipe manifest describes the
pilot runtime bindings and selected island sources with stable identities,
provenance, preparation settings, collision intent, and bounded layer data.

#### GR-3.2 — Deterministic preparation

Status: implemented and accepted.

Implementation evidence: isolated preparation jobs produce bounded runtime
images, thumbnails, collision drafts, fingerprints, reports, and cache records.
Identical inputs are cacheable and failures do not prevent independent jobs.

#### GR-3.3 — Review workbench

Status: implemented and accepted.

Implementation evidence: the asset library compares source and prepared layers,
collision, provenance, and exact fingerprints. Review decisions bind to the
fingerprint, and pilot bindings can be previewed in their existing game slots
without replacing accepted gameplay metadata.

#### GR-3.4 — Promotion and readiness gate

Status: implemented and accepted.

Implementation evidence: exact-review promotion publishes only approved,
current outputs, preserves declared collision authority, and records complete
source-to-runtime lineage. The repository gate rejects stale reviews, generated
artifacts, hashes, and orphaned promoted files.

#### GR-3.5 — Guided UI source intake and recipe creation

Status: implemented and accepted on 2026-07-16.

Implementation evidence: every usable reference exposes **Import and prepare**,
while **Add PNG** accepts one new local image. The compact form keeps inferred
family defaults visible and validates unique names and stable IDs automatically
alongside layer role, collision semantics, and an optional pilot test binding.
It reads the selected PNG's
native canvas immediately, keeps original dimensions by default, and offers
transparent padding to the next `32`-pixel boundary with a warning when solid
collision requires it. A same-origin development-server job reports
validation, repository-write and preparation phases, survives a browser refresh
through its job identity, and supports cancellation and retry.

The repository-wide intake lock and nested atomic transactions create the
source, validated recipe, prepared layers, thumbnail, collision semantics and
production index as one recoverable operation. Existing recipe, source and
candidate identities are never silently replaced. Contract and repository-I/O
coverage verifies field errors, durable manifest reload, duplicate rejection,
pre-mutation cancellation, and full cleanup after synthetic failure. An
interactive browser pass verified both reference and local-PNG entry points,
live field-error recovery, and a clean browser console without adding a
production candidate.

#### GR-3.6 — Best-effort collision seed on import

Status: implemented and accepted.

The gate required every current island reference, once prepared, to receive a
deterministic, grid-aligned, non-empty first draft without broadly blocking
transparent exterior water. Detectable fine projections and concave shoreline
detail had to use the `8`-pixel subgrid inside the `32`-pixel navigation grid.
Passable families had to remain explicitly empty, and no seed could become
runtime authority automatically.

Implementation evidence: prepared island alpha is partitioned into connected
fine-grid regions. Low-coverage isolated noise is ignored while retained
regions preserve their shoreline shape. The candidate record keeps the stable
seed-method identifier, editable sparse mask, and warnings for blank,
disconnected, edge-touching, or unusually broad results. Determinism,
concavity/projection retention, exterior transparency, warning stability,
passable semantics, and candidate-catalog round trips have focused contract
coverage.

#### GR-3.7 — Pending candidate authoring and UI completion

Status: implemented and accepted.

The gate required the pending record to be the structured place to finish a
candidate. Supported recipe settings and complete collision state had to
survive save and refresh exactly; changing source, recipe, or mask had to issue
a new fingerprint and invalidate review; invalid or stale data could not be
approved or promoted; and the complete validation, review, and promotion loop
had to work without commands or hand-authored JSON.

Implementation evidence: the workbench exposes name, family, dimensions,
ordered layer visibility/opacity, collision semantics, test binding, and the
existing paint/erase, `8`/`32`-pixel brush, fill, selection, undo/redo, and hull-
probe tools. **Save candidate** sends one exact-fingerprint structured request
through the serialized authoring service, atomically commits recipe and mask
inputs, prepares the affected output, verifies collision equivalence, and
returns the new fingerprint to pending review. Validation, approval, rejection,
and exact-current promotion are first-class UI actions. Contract, API, and
repository-I/O coverage includes solid/passable round trips, stale requests,
review invalidation, failed-prepare rollback, and exact approved-fingerprint
promotion.

#### GR-3.8 — Isolated single-island sea trial

Status: implemented and accepted.

The gate required a deterministic trial containing only open water, the player
boat, and one selected island candidate. It had to render the candidate's actual
prepared layers and centred origin, block the boat by the exact saved collision
mask, allow pending candidates, expose fingerprint/dimensions/origin/collision
revision and debug overlays, and return directly to the same durable library
record.

Implementation evidence: the candidate-only trial validates the requested
fingerprint and exact `32`/`8` canvas, creates an isolated open-ocean
`WorldGrid`, applies only the saved sparse candidate masks, and derives four
hull-safe reset positions. Its scene uses the normal vessel presentation and
movement authority but never constructs `GameSimulation`. Trial contract and
route coverage verifies deterministic placement, stale-fingerprint rejection,
pending review support, exact mask transfer, safe resets, bounded content, and
direct-return selection. Trial state is disposable and has no persistence,
review, promotion, or runtime-catalog mutation path.

#### GR-4.0 — Isolated asset-workspace tabs

Status: implemented and accepted on 2026-07-16.

The asset library now has persistent **Islands**, **Ships**, and **Fishing
shoals** tabs backed by a small typed registry. Each workspace owns exactly one
catalog partition and collision-profile partition, a namespaced selection key,
and a separately retained Phaser scene. The shared shell owns only accessible
tab navigation, stable URL and browser-history behavior, and the permanent
three-column mount layout. Scene shutdown aborts workspace DOM listeners and
Phaser bindings before the next workspace starts.

Contract coverage verifies stable registry order, complete and exclusive asset
and collision ownership, direct-link resolution, wrapping keyboard navigation,
namespaced state, and the stop/start lifecycle seam. Interactive browser
acceptance verified tab clicks and arrow navigation, Back/Forward restoration,
workspace-specific library and collision controls, a single canvas across
switches, independent left/right scrolling, and no console warnings or errors.

#### GR-4.1 — Focused island workshop

Status: implemented and accepted on 2026-07-16.

The Islands tab now mounts a dedicated minimal workbench selected exclusively
from the permanent left library. It exposes name, availability status, **View
with ship**, fit, paint, erase, `8`/`32`-pixel brushes, undo, redo, reset, and one
**Save changes** action. Runtime-profile, candidate lifecycle, validation,
fingerprint, review, promotion, runtime-binding, animation, layer-composition,
portable-package, and package-preview controls are absent from the island DOM.
Focused intake fixes island-only defaults while retaining immediate PNG canvas
reading, keep-original sizing, transparent grid padding, duplicate identity
checks, deterministic shoreline seeding, and automatic selection after import.

The single save adapter commits an imported island's editable name and complete
live collision mask through the existing rollback-safe candidate authoring
transaction. The built-in home island remains always available and uses the
same focused surface with direct collision persistence. Ships and Fishing
shoals retain their existing general tools. Focused contracts cover markup,
collision-tool scope, intake focus, and the combined save request. Interactive
browser acceptance verified the focused controls and import fields, cross-tab
isolation, one canvas after switching, independent right-panel scrolling, and a
clean warning/error console.

#### GR-4.2 — Single availability lifecycle

Status: implemented and accepted on 2026-07-16.

Island recipes now normalize one durable `availableInGame` boolean. Import
creates an unavailable island; the focused save transaction atomically commits
name, exact semantic mask, prepared output, and availability. Enabling requires
non-empty valid collision and current prepared output. Failed validation and
preparation restore the prior recipe, mask, candidate directory, and generated
index. Disabling preserves every authoring and sea-trial artifact.

The read-only available-island catalog is stable-ID ordered and rejects
duplicate IDs, names, invalid revisions, canvas mismatches, duplicate subcells,
and empty solid masks. Island review and promotion endpoints reject island IDs,
and batch promotion excludes islands; Ships and Fishing shoals retain their
general review workflow. Contract and repository-I/O coverage verifies exact
mask round trips, duplicate-name rejection, invalid-enable rollback, review
removal, and catalog projection.

#### GR-4.3 — Deterministic authored-island world planning

Status: implemented and accepted on 2026-07-16.

`WorldGenerator` now receives a renderer-neutral snapshot of available islands.
Stable-ID sorting precedes deterministic seeded selection without replacement.
Every selected authored island is used at most once, and procedural profiles
fill exactly the configured shortfall. Manifest entries record authored or
procedural provenance and the authored asset ID, while the manifest records the
catalog revision used to plan the world.

Authored canvas dimensions and collision footprint drive conservative bounded
placement through the existing spatial index and clearance rules. Rasterization
installs every saved `32`/`8` collision cell, including explicit clear cells, as
authority; pixels are never sampled. Acceptance coverage verifies total count,
unique authored IDs, exact procedural shortfall, catalog-order independence,
deterministic subset selection, byte-equivalent manifests, and exact fine-mask
rasterization.

#### GR-4.4 — Authored-island runtime presentation and closure

Status: implemented and accepted on 2026-07-16.

Available imported islands now project a separate immutable presentation
catalog containing their prepared visible layers, collision-canvas dimensions,
and revisioned texture keys. `WayfindersScene` preloads that snapshot and
`WorldRenderer` resolves only the authored asset IDs recorded in the generated
world manifest. World generation and navigation remain independent of image
URLs and rendered pixels.

Each authored visual is positioned from the planned collision bounds and
displayed at the exact saved grid canvas. Its centre chunk owns all layer
objects through the existing active-chunk lifecycle; retained chunks do not
duplicate images, and deactivation destroys every layer before reactivation.
Procedural drawing remains the coherent fallback for missing textures, catalog-
revision disagreement, or procedural shortfall. Contract coverage verifies
preloading, partial-load fallback, catalog/canvas agreement, manifest identity,
placement, layer composition, and activation churn. Browser smoke acceptance
verified game and Islands modes, zoom input, one WebGL canvas, the simplified
workbench, and a clean warning/error console. The clean production repository
contains no non-home imported island, so exact image alignment is exercised by
synthetic contract fixtures rather than a retained placeholder asset.

## Graphical Great Hall integration

#### GR-5.1 through GR-5.3 — Approved graphical chronicle and shared renderer

Status: implemented and accepted on 2026-07-16.

Product decision (2026-07-16): the previously proposed `GR-5.4` follow-on is
not required. The Great Hall track closes at `GR-5.3`; no ceremony-polish or
additional acceptance milestone remains in the current roadmap.

The product owner accepted the fixed-art Ancestor Wall preview and recorded the
required **Go** for game integration. Twenty stable generation portraits and the
closed ten-symbol achievement vocabulary now feed one validated, JSON-compatible
presentation contract V1. The asset workspace derives scenarios from a checked-
in fixture; the game uses a pure adapter over structured `GreatHallChronicle`
fields. Both hosts pass the resulting object to one semantic HTML renderer.

The renderer owns twelve-generation era paging, pointer and keyboard selection,
direct generation access, a selected portrait, exactly four voyage bands,
accessible state and voyage names, and exact returned-label detail. Live browser
acceptance verified era traversal, exact-symbol activation, current-era image
bounds, four voyage bands, and no horizontal overflow in desktop and narrow
fixture hosts. Fatal voyages remain free of provisional credit, undiscovered
idol hosts remain structurally absent, and home, handover, completion, focus,
movement, and lifecycle actions remain owned by the existing game host.

## Cloud atmosphere

### CLD-1 — Revealed-map cloud atmosphere

Status: implemented and accepted on 2026-07-16.

The game now renders sparse world-space clouds through an independent
`CloudLayerRenderer`. Four deterministic corner-biased candidates per active
chunk cycle through all four approved top-down pixel-art silhouettes, with
seeded scale, reflection, opacity, position, drift amplitude, period, and phase
providing additional variety. The cloud layer shares only the scene's
active-chunk delta and pure knowledge-coverage predicates.

A 2026-07-17 refinement paired every cloud with an offset shadow, moved both
above the ship, and gated the complete cloud/shadow drift envelope against
durable clear knowledge. Transient sight and tile-boundary motion can no longer
make an eligible pair pop in or out, while Unknown or Personal fog, filtered
boundaries, and world edges still suppress the pair in full. The shadow crosses
sea, terrain, and the ship in lockstep with its cloud.

A follow-up acceptance correction on 2026-07-17 made cloud existence and motion
independent of fog. Active candidates now continue their seeded routes while
hidden, and only the pair's current padded footprint is compared with the same
clear coverage rendered by the knowledge overlay. Current ship sight can
therefore uncover an already-moving cloud naturally, and fog changes never
create, destroy, restart, or reroute one. This also replaces full-route startup
rejection, ensuring all three reserved home clouds are visible in the generated
opening world.

The same follow-up raised the cloud opacity range to `0.34` through `0.52` and
the default frequency from four to six pairs per active chunk. Candidate slots
now use stable low-discrepancy spacing so additional clouds do not pile onto the
original positions. A session-only debug control and browser command select
zero through twelve pairs per chunk, rebuilding only cloud-owned resources
within the active-chunk cap.

Opening-view acceptance on 2026-07-17 reserved three deterministic routes around
the home island, increased the shadow separation, and replaced the small orbit
with readable directional drift. Ordinary routes last `120` through `180`
seconds and ease opacity across both ends before a transparent position wrap;
the home routes start partially faded in and remain within the same bounded
candidate budget. A four-tone white-to-storm-blue palette and wider seeded
scale range add darker weather and more varied silhouettes; the opening trio
guarantees visibly distinct light, middle, and dark tones at small, middle, and
large scales.

The scene-owned **Cloud atmosphere** developer checkbox defaults on, immediately
releases cloud/shadow pairs when disabled, and deterministically rebuilds only
cloud-owned resources when re-enabled. The equivalent
`window.__WAYFINDERS__` command and bounded telemetry never enter
`GameSimulation.debug` or change gameplay,
knowledge, visibility, terrain, collision, navigation, or other presentation
resources. Reduced-motion preference freezes seeded cloud phases.

The retained source, provenance, four-frame RGBA runtime sheet, package
metadata, authored opaque-frame bounds, and read-only validation command live
under the CLD-1 asset paths.
Contract coverage verifies package shape, all four variants across deterministic
samples, transform, opacity, frequency and motion variety, current-footprint
fog occlusion, independent
toggle lifecycle, deterministic reconstruction, corner-crossing revealed-area
placement, three-cloud generated-world opening composition, live-sight reveal,
perceptible directional movement,
route-end opacity easing, colour and size variety, shadow
transform/depth/visibility pairing, world-identity invalidation, paired
resource caps and releases, and zero stable-sync allocations. Existing live
browser acceptance confirms that
the scene-owned checkbox remains isolated from the other overlays. The approved
current-game mockup remains reference-only at
`concept_art/clouds/cloud-atmosphere-current-game-mockup.png`.

## Architecture and scale track

The architecture batch established the current large-world and agent-development
foundation. Detailed investigation history remains available in version
control; current contracts live in `ARCHITECTURE_MAP.md`,
`Wayfinders_Technical_Design.md`, `AGENTS.md`, and `tests/README.md`.

| Milestone | Durable outcome | Implementation |
| --- | --- | --- |
| AM-0 | Named scale fixtures, explicit test lanes, test typechecking, and subsystem tracing | `5e01ffd` |
| AM-1 | Cached collision topology and revisioned derived forward guidance | `0796763`, `bbe5c8a` |
| AM-2 | Explicit simulation composition and enforceable feature ownership | `17c3f10` |
| AM-3 | Spatially local, revision-driven interaction and presentation work | `61e27de` |
| AM-4 | Versioned world manifests, bounded placement, and shared world analysis | `582671c` |
| AM-5 | Presentation resource lifetime bounded by the shared active-chunk set | `91a24ce` |
| AM-6 | Exact cooperative forward guidance with bounded slices and atomic publication | `094f388` |

Status: implemented and accepted on 2026-07-15. The normal scale profile is a
deterministic `384 x 384` world with at least 300 islands, and the stress
fixtures cover 500 islands. Cooperative guidance met its main-thread slice
budget without requiring a worker or route hierarchy.

Post-milestone consolidation removed transition-only wrappers, compatibility
paths, test scaffolding, and duplicate runtime authority in `3080c2d`,
`c86c1de`, `94e50da`, and `3dbaef7`. The associated transition-only tests were
removed in `0ea2d7a`.

### Pre-consolidation browser departure evidence

A browser investigation on 2026-07-15, after the spatial-index work but before
the active-chunk and cooperative-guidance architecture settled, confirmed that
the authoritative ship reached its configured `80 px/s` immediately and did
not collide or drop simulation time. One controlled moving sample measured
approximately `25.01 ms` p50, `31.69 ms` p95/p99, and `33.36 ms` maximum rendered
frame time; maximum zoom-out made the symptom worse. Descriptor queries and
diagnostic projection were negligible, pointing toward viewport-dependent
presentation/resource work rather than an acceleration rule.

These measurements are historical diagnosis, not current acceptance evidence.
The settled build still requires a controlled browser zoom matrix and trace to
determine whether the user-visible departure symptom remains.

## Water production integration

WTR-2.0 through WTR-2.6 were implemented on 2026-07-17 after explicit user
authorization. The sequence delivered:

- a renderer-neutral, validated `WaterTypeCatalogV1` with catalog-selected
  placement strategies and an extension fixture proving that a new visual type
  can reuse a strategy without a planner or renderer identity branch;
- manifest-recorded stable water regions and a deterministic,
  chunk-addressable `GeneratedWaterLayout` created only after terrain and world
  analysis, with reef authority preserved and brackish left unplaced;
- a validated `world.water.primary` runtime package, five water sheets, three
  strength-based fishing-ground assets, public runtime handoff, and a read-only
  repository validator included in `assets:check`;
- a dedicated active-chunk `WaterRenderer` with cached base/surface canvas
  textures, static prefetch resources, visible-only discrete surface updates,
  reduced motion, canonical transitions, currents, rough water, and the aligned
  home-shore overlay; the former `WorldRenderer` water/wave path was removed;
- knowledge-safe fishing-ground rendering in which hidden-quality states use the
  neutral cue and surveyed states may use lean, steady, or rich, with restrained
  active-view animation; and
- a Water workspace driven by the real world generator and generated water
  layout with seed, zoom, overlay, pause, type comparison, and shoal comparison
  controls while the general Production tooling sidebar remains absent.

Verification included the water asset gate, source and test typechecks, the
quick lane, focused deterministic/catalog-extension and renderer ownership
contracts, a production bundle, and live game/Water-workspace browser checks.
The I/O lane's older clean-repository fixtures were updated to match the current
six imported-island source/candidate records.

## Archive boundary

This archive includes completed gameplay through `GP-5.1`, graphics and asset
work through `GR-5.3`, cloud atmosphere through `CLD-1`, and architecture work
through `AM-6`. Upcoming, proposed, and deferred work is maintained only in
`Wayfinders_Roadmap.md`.
