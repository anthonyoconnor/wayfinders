# Wayfinders Survey, Legacy Goals and Future World Activity Design

## Summary

Wayfinders makes exploration consequential through a simple commitment: sailing
and surveying draw from the same provisions. Every journey begins with the
tribe's standard supply allocation, so the player can always leave home and a
new navigator is never blocked by an earlier loss. Surveying is nevertheless
costly because it immediately reduces the distance and safety margin remaining
on that journey.

The player can notice an opportunity for free, survey it now at a provision
cost, or sail on and return its sighting as a permanent lead. Survey results
remain provisional until exact-dock return and are lost with the navigator if
the voyage ends in a wreck. This makes the four journeys in each navigator's
tenure a sequence of meaningful choices without a separate survey-case,
loadout or tribe-capacity system.

GP-3 expands the range of things that can be sighted, surveyed and brought home
as knowledge. It does not add tribe reserves, fishing output, automatic trade,
recovery floors or economic settlement. Fishing and trade boats can later show
that the world uses returned knowledge during the graphics track; they do not
require an authoritative economy or traffic simulation in GP-3.

A finite set of rare idols remains the long-term lineage goal owned by GP-4.
GP-3 supplies stable survey sites and the shared sighting/survey lifecycle, but
does not place idols, reveal idol-specific clues, carry relics or award
collection credit.

This document describes the accepted GP-3 design and the forward GP-4
direction. The active roadmap remains authoritative, and nothing
here authorizes implementation by itself.

## 1. Purpose

The intended Wayfinders loop is:

1. The tribe gives every journey its standard provision allocation.
2. The navigator explores and notices environmental clues without paying a
   survey cost.
3. Near a sighted opportunity, the player chooses whether its provision cost is
   worth reducing the current journey's remaining reach and return margin.
4. Surveying reveals deterministic information provisionally; sailing away
   simply defers the decision.
5. Exact-dock return converts provisional sightings and surveys into inherited
   leads and records.
6. A wreck loses only the failed journey's provisional knowledge and physical
   finds. Earlier returned knowledge and Supported routes survive.
7. The Great Hall credits returned work to the appropriate navigator and
   voyage, while the lineage eventually works toward recovering every idol.

The intended feeling is that the player is making difficult decisions with a
finite journey, not managing a trading company or waiting for a resource bar.

## 2. Core design principles

- Every journey and every successor receives the standard supply allocation.
  There is no economy state that can prevent a meaningful departure.
- Sailing and surveying use the same provisions. There is no separate survey
  case, salvage allowance or survey-capacity counter in the forward design.
- A survey must materially shorten or endanger the remaining journey. Its cost
  and effect on return guidance are shown before the player commits.
- Sighting is free. A non-modal prompt offers **Survey** only; continuing to
  sail is the choice to defer.
- A returned unsurveyed sighting is useful because it becomes an inherited lead
  for a later journey or navigator.
- Exact-dock return is the permanent commitment boundary. Wrecks discard the
  current journey's provisional sightings, survey results and unreturned
  physical objects.
- Deterministic opportunities and results never silently reroll after a reload
  or revisit.
- One generated island has one authoritative island dossier even when its
  survey reveals several characteristics.
- Shared survey mechanics should be extended through data-driven site types,
  not copied into a reducer and prompt for every content family.
- Idols are finite, lineage-wide historical goals, not money, compulsory
  upgrades or arbitrary open-water collectibles.
- Living communities are not loot sources. Their objects become relationship,
  entrusted-return or cultural-discovery stories where appropriate.
- World traffic and community activity are later presentation. GP-3 does not
  need saved `Active` states, output ledgers or economic settlement cursors to
  justify future fishing or trade boats.

## 3. Surveyable opportunity families

### 3.1 Fishing shoals

Fishing shoals retain their deterministic locations, clues and hidden quality.
A free sighting can be returned as a lead. A provision-funded survey reveals
quality provisionally, and exact-dock return makes that survey inherited.

A returned survey connected to home through Supported water can be described as
an active fishing ground as a derived fact. No separately saved activation
state or numerical fishing output is required. Later graphics may place sparse
fishing boats around a connected returned ground without making those boat
positions authoritative.

### 3.2 Island dossiers

Every non-home island has one stable dossier keyed by its existing island ID.
Seeing the island creates a free provisional sighting. Returning without
surveying commits one inherited island lead, preserving its location and the
fact that it remains unexamined.

The island uses a coastal approach ring derived from its exact painted
footprint. A dock-reachable passable water tile is a valid approach when the
Euclidean distance between its center and the center of at least one tile
carrying that exact island ID is at most 1.5 tile widths. A canonical anchor
may still support labels, developer tools and tests, but it never restricts the
player to one approach. The survey consumes provisions and reveals one
deterministic descriptive result. The implemented V1 themes are a welcoming
community, useful materials, a sheltered anchorage, a charted reef passage or a
weather watchpoint. The catalog can extend its result vocabulary without
changing the one-dossier-per-island lifecycle.

These characteristics are descriptive returned knowledge and Great Hall
credit in GP-3. They do not refill provisions, alter travel, create an economy
or spawn separate point targets.

Surveying reveals the exact generated island footprint through fog for the
current expedition. This is a cartographic island reveal only. It does not
change any water cell between Unknown, Personal and Supported, reveal a safe
water route, reduce provision costs, change return calculations or imply that
the navigator travelled around the island's coast.

The provisional footprint reveal and dossier become permanent only on
exact-dock return. A wreck removes the failed expedition's survey and footprint
reveal, while an island lead returned by an earlier journey remains available
to survey again. Multiple characteristics belong to the one dossier rather
than becoming unrelated discovery records around the same island.

Accepted GP-3.2 folded the former one-per-island generated discovery into the
dossier's descriptive result. Its legacy `HistoricWreck` and `FishingGround` outcomes do
not remain separate target types: GP-3.3 sites and GP-1 fishing shoals are the
only authoritative historic-wreck and fishing targets.

### 3.3 Runtime navigator wrecks

A later navigator initially sees a discovered runtime wreck as unidentified.
Surveying it consumes provisions and reveals the lost navigator's identity and
fate provisionally. Only exact-dock return attaches that report to the correct
Great Hall record. If the reporting navigator is also lost, the report is
discarded and the wreck remains available to survey again.

Runtime navigator wrecks remain distinct from generated historic-wreck sites.
The identification survey does not restore the fatal expedition's Personal
  chart, provisional island/site findings or achievements.

### 3.4 Generic survey sites

GP-3.3 ships exactly one site from each of three generic families:

| Site type | Visual and clue language | Initial result family |
| --- | --- | --- |
| Historic wreck | An old hull, broken mast, debris trail or sealed remains, never presented as a lineage navigator's wreck | Maritime history, evidence of former routes, mundane tools or traces of a larger story |
| Coastal ruin | Foundations, carved stones, broken walls or traces of an abandoned shore settlement | Former habitation, local history, inscriptions or cultural traces |
| Tidal cave | A cliff opening, dark water, unusual birds, echoes or reflected light | Geology, markings, unusual formations or evidence of earlier visitors |

All three use the same stable definition, service-anchor, sighting, provision
cost, provisional survey, return-commit and wreck-rollback mechanics. They are
distinguished initially by world marker, clue vocabulary and deterministic
result content, not by separate controls or type-specific simulation.

They are independently seed-derived, directly sightable targets. An island
dossier does not spawn, unlock or point to one. Chained clues and nested
site-within-island targets are deferred expansion work. Their survey results
are descriptive records only: they do not refill provisions, reveal routes,
create safe waypoints or generate follow-on leads.

The catalog and shared tests remain extensible to later shrines, reef chambers,
abandoned anchorages, natural landmarks and other approved points of interest,
but none ships in GP-3.3. GP-4 can attach an idol catalog entry to a stable
generic-site ID without changing the site's terrain or letting GP-3 expose
which sites contain idols.

### 3.5 Other communities and future activity

An island dossier may record contact with a living community, but GP-3 does not
simulate its needs, surplus, trade output or route operation. Those ideas are
outside the approved gameplay roadmap unless a later decision gives them a
specific player-facing purpose.

Fishing skiffs, community boats and trade vessels may be added during graphics
work as sparse, non-blocking evidence of returned knowledge and elapsed world
time. They should be derived from permanent records and Supported water, never
reveal Unknown or Personal routes, and need not imply a numerical economy.

## 4. Shared discovery lifecycle

Fishing shoals, island dossiers and GP-3.3 generated sites follow one branching
lifecycle:

1. **Latent** — the deterministic opportunity exists but is unknown.
2. **Sighted / provisional** — current sight reveals a clue for free during the
   active expedition.
3. **Surveyed / provisional** — the player deliberately spends provisions and
   learns the deterministic result during the active expedition.
4. **Returned lead** — exact-dock return commits an unsurveyed sighting for
   future journeys.
5. **Returned survey** — exact-dock return commits the surveyed result and
   navigator/voyage credit.

A returned lead can be surveyed on a later journey. That later survey remains
provisional until it too reaches the exact dock. A wreck removes only records
owned by the failed expedition; deterministic sites remain in the world and
earlier returned leads or surveys survive.

Runtime navigator wrecks reuse the provision charge and the provisional-report
return/rollback rules, but not the full latent/returned-lead branch. Once found,
their physical wreck marker remains persistent until its identity is reported.

`Active` and `Developed` are not generic authoritative lifecycle states in
GP-3. If later presentation calls a connected returned fishing survey active,
that label is derived from its returned record and Supported connection.

## 5. Provision-funded surveying

### 5.1 Standard journey allocation

Every journey begins with the same standard provision allocation. Exact-dock
return replenishes the next journey immediately. A wrecked navigator's
successor also begins fully supplied after the succession handover. The tribe
may narratively work, mourn and prepare between voyages, but no capacity,
recovery or wall-clock economy state controls that allocation.

### 5.2 Survey cost

The first version should use one fixed, configurable provision cost shared by
all survey types. A site-specific cost should be introduced only if playtesting
shows that it creates a legible choice rather than hidden content priority.

Before confirmation, the prompt shows:

- the provision cost;
- provisions that will remain;
- the resulting estimated return margin or risk state; and
- that the result remains provisional until exact-dock return.

The simulation deducts the provision cost atomically with the survey result.
Repeated input, reload or revisit cannot charge twice. The player may survey
more than one opportunity on a journey when enough provisions remain; there is
no one-survey-per-voyage restriction.

The game does not secretly reserve provisions for the return journey. If a
survey leaves a dangerous or impossible estimated return, the prompt warns the
player clearly but preserves the choice whenever the stated provision cost can
be paid.

### 5.3 Why deferring matters

Sailing past a clue costs nothing. If that sighting reaches home, the returned
lead gives a later journey an exact target. Surveying immediately trades current
range for earlier certainty; deferring preserves this journey's provisions but
uses one of the navigator's remaining journeys to revisit the site. This is the
central GP-3 decision.

## 6. Idol legacy goal

### 6.1 Purpose and boundary

Idols are a finite collection of rare relics distributed through the seeded
world. They motivate exploration across islands, historic wrecks, reefs,
abandoned places and unusual landmarks. Their value is historical, visual and
completion-driven:

- every returned idol becomes a named exhibit at home;
- the navigator who returned it receives permanent voyage credit;
- a restrained recovered count gives the lineage a finite objective;
- exhibits can reveal lore and a final historical revelation; and
- completing the collection can support a celebration or optional ending while
  allowing continued play.

GP-4 owns the idol registry, idol-specific clues, survey/recovery states,
physical aboard state, recoverable loss, archive presentation and completion.
GP-3 owns only the generic sites and survey mechanics on which some idols may
later depend.

### 6.2 Placement and clue rules

Each world has a configured, deterministic idol set. The player may know the
total count but never receives a list of exact remaining locations. Idols attach
to meaningful stable anchors rather than arbitrary water cells, including:

- a GP-3 historic-wreck, coastal-ruin or tidal-cave site;
- a later approved shrine, reef chamber or abandoned anchorage;
- a distinctive natural landmark with an appropriate recoverable relic.

Clues precede recovery and indicate promise without exposing the exact reward.
An unusual silhouette, carving, map fragment or returned survey elsewhere may
point toward a site. GP-3's ordinary site result must not accidentally reveal an
idol unless GP-4's idol-specific clue contract says it should.

Objects belonging to living communities are not treated as loot. They become
relationship, entrusted-return or cultural-discovery stories instead.

### 6.3 Idol lifecycle and minimal cargo

| State | What the player knows | Permanent credit |
| --- | --- | --- |
| Hidden | Nothing | None |
| Sighted lead | A site may deserve investigation | None |
| Surveyed | The site contains an idol or a strong idol lead | None; provisional expedition knowledge |
| Recovered aboard | The physical idol is carried by the navigator | None; still provisional |
| Returned | The idol reaches the exact home dock | Archive, navigator and lineage credit |
| Lost in a wreck | The idol did not return | None; it remains recoverable at the wreck or source |

Surveying an idol site consumes provisions through the GP-3 survey contract.
GP-4.2 owns the minimal cargo and recovery rules needed to move a surveyed idol
aboard, lose it in a wreck and make it recoverable again. GP-3 does not add a
general loadout screen, salvage-case resource or cargo economy in anticipation
of that feature.

Every idol must exist in exactly one authoritative place or state: source,
aboard, recoverable loss or returned archive. A wreck can delay collection but
can never make full completion impossible.

### 6.4 Great Hall relic wing

The existing Great Hall is the recommended home for the idol archive rather
than a second overlapping home-only history screen. A **Relics** wing can show
named exhibits, silhouettes, lore, recovered count and returning navigator
credit while preserving the Hall's exact-home-dock access and optional nature.

The Great Hall's navigator entries continue to derive from authoritative
lineage and returned-world records. Idols join those entries only after GP-4.2
defines returned-idol and voyage-credit ownership. Collection totals are
derived when the Hall is presented rather than saved as duplicate aggregates,
and they never reveal remaining locations.

Each navigator still receives four numbered voyage positions. Only
exact-dock-returned achievements appear in a safe-voyage row. A terminal lost
voyage never displays its provisional survey or idol work. A later returned
runtime-wreck report may identify the lost navigator without retroactively
committing anything from the fatal voyage.

### 6.5 Completion

Returning the final idol unlocks an unmistakable one-shot completion event. The
player may end the lineage's story or continue exploring the same world. The
ending is never forced, continued play does not invalidate the collection, and
arbitrary legal wreck histories cannot make completion impossible.

## 7. Wrecks and inheritance

A wreck ends the current navigator's tenure and loses:

- the failed journey's Personal water knowledge;
- provisional sightings, surveys and runtime-wreck identity reports;
- unreturned physical finds such as a future idol; and
- the current vessel and remaining provisions.

It preserves:

- all Supported routes and returned knowledge;
- earlier returned island dossiers, leads and surveys;
- the four-journey records already committed for that navigator;
- the new runtime wreck as a later-discoverable marker; and
- the tribe's guarantee of standard provisions for the successor.

There is no tribe-capacity penalty, reduced recovery allocation, blocked
loadout or automatic-output reduction after a wreck. The loss matters through
the navigator's death, the shortened four-journey record and the failed
journey's lost provisional progress.

Surveying a runtime wreck identifies the lost navigator; it does not salvage
cargo, restore chart knowledge or recover economic value. Idol recovery from a
wreck belongs to GP-4.2. Any broader salvage system would require its own later
approval and concrete player-facing purpose.

This remains the central inheritance rule:

> A wreck loses the navigator's unfinished journey, not the lineage's returned world.

## 8. Time between journeys

For the player, return, replenishment and succession are immediate. In the
world, time passes between voyages: the tribe uses the returned report, waits
for a missing navigator, mourns the dead and prepares a successor. That elapsed
time justifies later visual changes such as boats using a reported shoal or a
new route.

No economic clock, output settlement or wall-clock waiting is needed to express
that transition. Later cutscenes and graphics can enrich it without changing
authoritative gameplay time.

## 9. UI direction

### 9.1 Persistent sailing presentation

Normal sailing shows the ship, physical provision bundles, environmental clues
and the existing navigation/risk guidance. It does not show survey cases, a
general cargo rack, tribe reserves, market prices or a permanent economy task
list. GP-4 may later add minimal presentation for an idol physically aboard.

### 9.2 Contextual survey prompt

The player first sees a clue in the world: birds, disturbed water, debris,
carved stones, a cave opening or a broken mast. Within inspection range, a
small world-adjacent prompt appears without pausing or suppressing sailing.

The prompt contains one action:

- **Survey** — spend the displayed provisions and reveal the deterministic
  provisional result.

There is no **Leave** button or authoritative leave command. Continuing to sail
is the decision to defer. The prompt hides automatically when the target leaves
inspection range and appears again on re-entry while the target remains
surveyable. Dismissing or leaving range does not mutate or save gameplay state.

The prompt shows the resulting provision and return-risk consequence before
confirmation. If the cost cannot be paid, it explains why Survey is unavailable
without blocking movement.

### 9.3 Provisional and returned presentation

A provisional sighting or survey receives a faint personal chart/world mark.
An island survey may additionally show its exact footprint through fog for the
current expedition. These presentation records roll back with their owning
expedition on a wreck.

At the exact dock, reporting is automatic. One concise return presentation
lists the committed leads, surveys, island dossier information and wreck
reports, then points to their permanent Great Hall record. There is no sell
screen, manual route assignment or economy-settlement screen.

### 9.4 UI choices

| UI need | Initial direction | Boundary |
| --- | --- | --- |
| Journey supplies | Automatic standard allocation | No dockside loadout or recovery tier |
| Opportunity sighting | Environmental clue and faint provisional mark | Sighting is free |
| Survey decision | Non-modal proximity prompt with **Survey** only | Sailing away defers and auto-hides the prompt |
| Survey consequence | Cost, remaining provisions and return-risk change | No separate survey capacity |
| Returned result | Brief dock report plus Great Hall credit | Exact dock is the permanent boundary |
| Idol collection | Great Hall Relics wing with a restrained total | GP-4 only; never expose remaining locations |

## 10. Map language

| State | World and chart language |
| --- | --- |
| Unknown opportunity | Environmental clue only when current sight reaches it |
| Sighted / provisional | Faint personal mark for the active expedition |
| Returned lead | Persistent inherited lead with survey still available |
| Surveyed / provisional | Revealed result marked as not yet returned |
| Returned survey | Persistent named result and Great Hall voyage credit |
| Surveyed island dossier | Exact island footprint revealed; surrounding water knowledge remains unchanged |
| Connected returned fishing survey | May receive a derived home-linked label; no saved output state |
| Returned idol | Named exhibit and navigator credit in the Great Hall Relics wing |
| Lost idol | Recoverable wreck/source state, never a permanently failed collection slot |

Later fishing or trade traffic is graphics-stage world language. It must remain
sparse, non-blocking and unable to reveal hidden navigation knowledge.

## 11. Content boundaries

GP-3 begins with existing fishing shoals, one dossier for every non-home island,
runtime navigator-wreck reports and the three GP-3.3 generic site types:
historic wreck, coastal ruin and tidal cave.

Do not create a large commodity list, dynamic prices, labour assignment,
arbitrage, manual trade routes, tribe-capacity state, fishing-output ledger or
generic cargo inventory. These systems are not required by the approved
exploration loop. They may return only through a separately approved design
that identifies a concrete player-facing benefit.

Do not place GP-4 idols during GP-3, make ordinary historic objects count toward
the finite idol set or imply that a living community's possessions are
collectibles. GP-3 sites are stable anchors and ordinary discoveries; GP-4 owns
the finite registry and all idol-specific behavior.

## 12. Roadmap placement

The active roadmap is defined in `Wayfinders_Roadmap.md`. This design maps to
the confirmed direction as follows.

### GP-1: fishing grounds and the accepted survey baseline

GP-1 established deterministic fishing clues, sighting/survey/returned records,
exact-dock commitment and wreck rollback. Its one-case allocation and
**Survey / Leave** prompt remain historical acceptance evidence; GP-3.1 has
replaced them with the forward cross-content model.

### GP-2: navigators, generations and lineage history

GP-2.2 owns four-journey tenure, death, succession and the required handover
gate. GP-2.3 presents that gate through the permanent Great Hall, supports
exact-home-dock browsing and derives lineage totals. Runtime-wreck identity and
fate reporting already obey the provisional/exact-dock boundary.

### GP-3: survey choices and discoverable places

- GP-3.1 is accepted: it replaces survey cases with provision-funded surveying, allows multiple
  surveys when provisions permit and simplifies the non-modal prompt to
  **Survey** only.
- GP-3.2 is accepted: it gives every non-home island one sightable and surveyable dossier with
  exact-footprint fog reveal that does not alter water knowledge or travel cost.
- GP-3.3 is accepted: it adds exactly one seed-derived historic wreck, coastal
  ruin and tidal cave through the shared descriptor-extensible site lifecycle.

All GP-3 records use stable IDs, deterministic results, exact-dock commitment,
wreck rollback and Great Hall credit. GP-3 does not include the discarded tribe
capacity, fishing activation/output, loadout, economic wreck-recovery or
automatic-trade milestones.
The accepted boundary uses survey-site content V1, save schema V12, lineage V6
voyage records V3 and Great Hall read model V3.

### GP-4: idols, relic wing and optional completion

GP-4 adds the deterministic idol registry and clues, attaches idols to approved
stable sites, and distinguishes surveying from physical recovery. GP-4.2 owns
the minimal idol cargo and recoverable-wreck-loss contract. Later GP-4 work adds
the Great Hall Relics wing, navigator credit and optional completion/continue
choice.

### GP-5 and exact-version persistence

Every gameplay minor that changes authoritative persisted state bumps the
affected schema/content/format version, invalidates earlier records and includes
deterministic current-version round-trip tests. Cross-version migration remains
out of scope during development. GP-5 later turns the existing foundation into
the confirmed player-facing new/save/load experience.

### Graphics track

Production assets, fishing and trade boat presentation, richer island/site
markers, transition scenes and environmental polish belong to the separate
`GR-*` track. Developer graphics remain the gameplay fallback. Traffic may be
derived from returned records but is not a prerequisite for accepting GP-3.
GP-3.3 acceptance has opened the production-art dependency gate, but GR-1
remains proposed and requires explicit authorization.

### Later expansion

Tribe reserves, economic output, markets, competing routes, specialist
equipment, settlement needs and deeper trade simulation are outside the
approved roadmap. They should be reconsidered only if playtesting identifies a
specific missing decision that the simpler provision-and-survey loop cannot
provide.

## 13. Validation criteria

The forward design succeeds only if playtesting and automated checks show that:

- every journey and successor receives the standard supply allocation;
- no failure sequence can block the player from leaving home immediately;
- surveying deducts provisions exactly once and materially changes remaining
  reach or return risk;
- players understand that sailing away defers a survey without losing the free
  sighting;
- the Survey-only prompt never pauses navigation and auto-hides out of range;
- a returned lead can be found and surveyed on a later journey;
- provisional surveys commit only at the exact dock and roll back on wreck;
- multiple surveys are possible when provisions permit;
- deterministic results cannot reroll across revisit or current-version reload;
- each island has one dossier and its exact-footprint reveal changes no water
  knowledge, path or provision cost;
- historic wreck, coastal ruin and tidal cave sites feel distinct through
  clues, visuals and content while sharing one survey mechanic;
- runtime navigator wrecks cannot be confused with historic-wreck sites;
- the Great Hall credits only returned work to the correct navigator and voyage;
- sighting, surveying, recovering and returning an idol remain distinct states;
- every idol remains collectible after every legal wreck sequence; and
- normal play remains free of a permanent economy, inventory or score HUD.

## 14. Remaining design decisions

- Does the implemented default two-bundle survey cost create a sufficiently
  meaningful survey-versus-range choice at the twelve-bundle allocation?
- What warning language best communicates a tight or impossible estimated
  return after surveying without making the decision for the player?
- Which island dossier characteristics produce the clearest and most memorable
  returned reports?
- How many generic sites should a world contain, and how should their clues
  communicate rough promise without revealing deterministic outcomes?
- Does the player need a dedicated returned-lead log later, or are world marks
  plus the Great Hall sufficient?
- What idol count suits the default world, and how should later clues narrow the
  search without revealing exact remaining locations?
- What form should the final-idol celebration and **End the lineage** /
  **Continue exploring** choice take?
