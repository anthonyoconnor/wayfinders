# Wayfinders Survey, Legacy Goals and Future World Activity Design

Saving is intentionally absent from active development. References below to
reload behavior, saved state or GP-5 describe historical acceptance or a
possible future design; they do not authorize implementation. Saving may return
only through a named milestone explicitly authorized with saving in scope.

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

A finite set of lost idol locations is now the accepted lineage goal. GP-4.1
selects hidden locations from stable island dossiers and GP-3.3 sites, then
reuses their ordinary provision-funded survey, wreck rollback and exact-dock
knowledge commitment. The lineage seeks where the idols were lost, not the
physical objects, and no relic cargo or recovery system exists.

This document describes the accepted GP-3 and GP-4.1 design. The active roadmap
remains authoritative, and nothing here authorizes later implementation by
itself.

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
6. A wreck loses only the failed journey's provisional knowledge. Earlier
   returned knowledge and Supported routes survive.
7. The Great Hall credits returned work to the appropriate navigator and
   voyage, while the lineage works toward finding every lost idol location.

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
  current journey's provisional sightings and survey results.
- Deterministic opportunities and results never silently reroll for the same
  world seed or on revisit.
- One generated island has one authoritative island dossier even when its
  survey reveals several characteristics.
- Shared survey mechanics should be extended through data-driven site types,
  not copied into a reducer and prompt for every content family.
- Idol locations are finite, lineage-wide historical goals, not money,
  compulsory upgrades, physical collectibles or arbitrary open-water targets.
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
but none ships in GP-3.3. GP-4.1 attaches hidden idol-location entries to some
stable generic-site IDs without changing their terrain or revealing which sites
contain one before survey.

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

An idol-location entry does not add another branch. If an eligible island or
site is an idol host, its ordinary successful survey also reveals that special
location provisionally. The same wreck removes it and the same exact-dock
return commits it; an unsurveyed returned lead never counts as an idol finding.

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
Repeated input or revisit cannot charge twice within a session. The player may survey
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

When the world split into islands, the idols and knowledge of their locations
were lost to time. The lineage's finite objective is to rediscover every
location and bring that knowledge home. The navigator does not remove, recover
or transport an idol.

Each exact-dock-returned location becomes a distinguished Great Hall finding
credited to the navigator and voyage that reported it. A restrained returned
count gives the lineage its objective without turning idols into inventory,
currency, powers or compulsory upgrades.

### 6.2 Placement and clue rules

Each world configures a positive idol-location count. The default world uses
three. The deterministic catalog selects that many unique eligible hosts
without replacement and rejects a count greater than the available host set.

Current eligible hosts are:

- every non-home island dossier; and
- the seed-derived GP-3.3 historic wreck, coastal ruin and tidal cave.

Fishing shoals are excluded. Runtime navigator wrecks are also excluded because
they are dynamic fate-report locations rather than seed-derived survey hosts.
Future survey families must explicitly opt into eligibility.

The mapping stays hidden until ordinary survey. There is no advance idol mark,
remote clue chain, special survey command or list of undiscovered hosts. The
Great Hall may show returned count against the configured total only.

### 6.3 Knowledge lifecycle

| State | What the player knows | Permanent credit |
| --- | --- | --- |
| Hidden host | The ordinary survey location exists; its idol mapping is unknown | None |
| Sighted / returned lead | The host is known but remains unsurveyed | None |
| Surveyed / provisional | The ordinary result and special idol location are known aboard | None; current-expedition knowledge only |
| Returned location | Knowledge reaches the exact home dock | Great Hall, navigator and voyage credit |
| Lost with a wreck | The provisional knowledge did not return | None; the unchanged host can be surveyed again |

Surveying uses the host's existing GP-3 provision cost and result. When the host
contains an idol location, the same transaction adds a special provisional
finding. Wreck rollback and exact-dock commitment remain owned by that host's
survey record, so there is no parallel mutable idol reducer. Repeat survey,
dock and wreck paths cannot duplicate credit.

No physical idol, aboard object, recovery action, cargo slot, salvage case,
idol loss site or collection inventory exists. A wreck can delay knowledge but
cannot make completion impossible because the deterministic host remains.

### 6.4 Great Hall credit

Returned idol locations appear as distinguished achievements inside the
existing Great Hall. There is no Gem Hall, separate archive or Relics wing. The
read model joins returned host records to the navigator's committed voyage, so
the exact finder and journey receive credit without storing a duplicate
collection ledger. It receives returned definitions plus the total, never the
full hidden host catalog.

Each navigator still receives four numbered voyage positions. Only
exact-dock-returned achievements appear in a safe-voyage row. A terminal lost
voyage never displays its provisional survey or idol work. A later returned
runtime-wreck report may identify the lost navigator without retroactively
committing anything from the fatal voyage.

### 6.5 Completion

Returning knowledge of the final location commits the normal host result,
voyage and Great Hall credit first, then opens the final Great Hall. It offers:

- **Continue exploring** — preserve the completed world and lineage, return to
  ordinary discovery play, keep normal exact-home-dock Great Hall access and
  permanently prevent this world from triggering the ending again; or
- **Start new game** — discard the current in-session world and lineage, use a
  distinct effective seed, and begin again with reset progress.

If the final return is also voyage four, completion presentation takes priority
over the required succession handover. Continuing then shows that already
committed handover before sailing resumes; starting a new game discards it with
the old world.

## 7. Wrecks and inheritance

A wreck ends the current navigator's tenure and loses:

- the failed journey's Personal water knowledge;
- provisional sightings, surveys and runtime-wreck identity reports;
- provisional idol-location knowledge carried by an eligible host survey; and
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
cargo, restore chart knowledge, recover economic value or find an idol. Any
broader salvage system would require its own later approval and concrete
player-facing purpose.

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
list. An idol host uses its ordinary marker until survey; the resulting special
finding is knowledge, not an aboard object.

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
| Idol locations | Distinguished existing Great Hall credit and returned/total progress | No Gem Hall, Relics wing or undiscovered-host list |
| Final location | Final Great Hall with **Continue exploring** / **Start new game** | Credit commits first; continuing never retriggers completion |

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
| Surveyed idol host | Special provisional location finding alongside the ordinary result |
| Returned idol location | Distinguished navigator/voyage credit in the existing Great Hall |
| Lost idol-location knowledge | Host remains unchanged and can be surveyed again |

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

GP-4.1 overlays a finite hidden location registry on eligible GP-3 hosts. It
does not make the hosts' ordinary historic objects into idol collectibles or
imply that a living community's possessions are loot. The host's survey result
remains an ordinary discovery; the additional special finding is the lost
idol's location.

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
The accepted GP-3.3 boundary uses survey-site content V1, lineage V6 voyage
records V3 and Great Hall read model V3. GP-4.1 advances the derived Hall read
model to V4. Saving remains absent from the active runtime.

### GP-4.1: lost idol locations and completion

GP-4.1 is accepted as one complete slice. It adds a deterministic hidden
idol-location catalog over non-home island dossiers and the three GP-3.3 sites,
with a configurable positive count bounded by eligible hosts and a default of
three. Ordinary surveying reveals a location provisionally; wreck and
exact-dock behavior reuse the host record. Returned locations receive
distinguished exact navigator/voyage credit in Great Hall V4. The final return
opens the final Great Hall and offers continued play in the preserved,
non-retriggering world or a reset on a distinct-seed new game.

There is no multi-stage GP-4 recovery plan, physical idol, cargo, clue chain,
Gem Hall or Relics wing.

### GP-5 and future persistence

GP-5 is a deferred placeholder, not an active schema plan. If saving is later
authorized, it must begin from the authoritative gameplay shape that exists
then, define a new version-one format and add its own round-trip acceptance.
No current gameplay milestone inherits a save, reload or migration obligation.

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
- deterministic results cannot reroll across revisit or same-seed regeneration;
- each island has one dossier and its exact-footprint reveal changes no water
  knowledge, path or provision cost;
- historic wreck, coastal ruin and tidal cave sites feel distinct through
  clues, visuals and content while sharing one survey mechanic;
- runtime navigator wrecks cannot be confused with historic-wreck sites;
- the Great Hall credits only returned work to the correct navigator and voyage;
- the default world has three deterministic unique idol locations and every
  configured count is positive and bounded by eligible hosts;
- no fishing shoal, runtime navigator wreck or undiscovered host enters idol
  progress or Hall credit;
- idol-location knowledge is provisional on survey, rolls back with its host on
  wreck and commits exactly once at the exact dock;
- final-location credit precedes the final Great Hall;
- continuing preserves the completed world, keeps normal Hall access and never
  retriggers completion, while new game resets on a distinct effective seed;
- fourth-voyage completion shows the final Hall before the pending handover; and
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
- Does the three-location default produce enough world coverage across seeds?
- What production-art treatment should distinguish an idol-location finding
  and final Great Hall without implying that the physical object was recovered?
