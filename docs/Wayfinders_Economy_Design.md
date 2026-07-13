# Wayfinders Economy, Legacy Goals and World Activity Design

## Summary

Wayfinders uses a community-backed economy and a lineage-wide relic collection to make exploration feel consequential without turning the game into a waiting or logistics-management game. The player is a wayfinder: they discover, survey, retrieve and safely report opportunities. Communities automatically fish, trade, build and travel on Supported routes once that knowledge has been returned home.

Routine activity is automatic and visible in the world. The player's economic choices happen at a few meaningful moments: how much community support to take on a voyage, whether to spend limited survey or salvage capacity on an uncertain lead, and when to return with what they have found. A failed expedition materially hinders the next generation, but inherited routes and a minimum recovery expedition prevent a death spiral. A finite set of rare idols provides a long-term exploration goal across the entire lineage.

This document is a future economy and legacy-goal direction beyond the accepted implementation baseline. The forward roadmap proves fishing and survey gameplay with developer graphics before tribe economics, idols and production-asset replacement. Nothing in this document is implemented or approved merely by being described here.

![Economy UI direction: dockside loading, an in-world survey prompt, and automatic fishing activity after return](<../concept_art/wayfinders exploration ui concept sheet.png>)

## 1. Purpose

This document defines how the world economy should support the central Wayfinders loop:

1. A community entrusts a navigator with limited resources.
2. The navigator explores, surveys leads and retrieves finds.
3. A safe exact-dock return converts personal knowledge into inherited knowledge.
4. Communities use reported opportunities automatically.
5. The player sees fishing, trade, construction and traffic make Supported waters more alive.
6. A wreck loses the community's latest investment and leaves the next generation less capable, while earlier inherited routes survive.
7. The historical record credits each navigator's returned surveys, discoveries, routes and idols while the full lineage works toward recovering every idol in the world.

The intended feeling is not that the player owns a trading company. The player makes uncertain voyages on behalf of a growing network of island communities.

## 2. Core design principles

- Exploration is funded by community sacrifice. Supplies are not free magic; they represent food, water, repair material, labour and trust invested in a voyage.
- Normal play must never require real-time waiting for resource bars to refill.
- Routine fishing, trade and route operation are automatic. The player does not assign boats, set prices, choose cargo quantities or repeatedly fulfil orders.
- Seeing an opportunity is not the same as proving its value. Survey, salvage or retrieval requires a deliberate expedition commitment.
- Economic information is communicated first through the world: boats, docks, storehouses, cargo, workers and changed island activity. Menus appear only when a decision is needed.
- A wreck must hurt the next generation, but it must not erase all progress or block further play.
- Existing Supported routes are a practical inheritance. They allow a reduced recovery expedition to reach the old frontier at no provision cost.
- The world is deterministic where it affects meaningful discovery value. The player can face uncertainty, but the game must not silently reroll outcomes after each attempt.
- The game should distinguish **sighting**, **survey**, **returned record** and **active community use**. A sighting alone does not make a resource useful to the tribe.
- Idols are achievement-like, lineage-wide goals. They create exploration motivation without becoming generic money or compulsory upgrade currency.
- A failed voyage may delay an idol's recovery, but it must never make full collection permanently impossible.

## 3. What produces value

### 3.1 Island resources

Each island can have one or more productive characteristics: freshwater, timber or fibre, stone, metal, crops, craft materials, protected anchorage or specialised local knowledge. Returning reliable information about an island creates the possibility of a later economic connection.

An island does not need a large economy screen. Its role should be communicated through visible terrain, buildings, dock activity and the kinds of boats that eventually travel there.

### 3.2 Nearby sea resources

The sea itself contains valuable, place-based opportunities:

- fishing shoals;
- reef and tidal harvest grounds;
- kelp, shellfish or other marine materials;
- safe anchorages;
- current lanes and navigational passages.

These are important because they make established waters interesting. A safe route is not exhausted content; it can still contain smaller discoveries that help the community recover or grow.

### 3.3 One-off finds

Wrecks, washed cargo, lost charts, rare tools, historic objects and stranded stores are finite opportunities. They may give immediate supplies, a future discovery lead, a unique upgrade path or a story-relevant object.

A wreck sighting is only a lead. It becomes useful only if the player spends effort to investigate and returns with a report or recoverable object.

### 3.4 Other communities

A discovered settlement can have needs and a surplus. Once the player returns with reliable information and a viable Supported route exists, the connected communities can establish routine exchange automatically.

Early trade should communicate connection and prosperity, not become a buy-low, sell-high minigame.

## 4. Discovery lifecycle

Every economic opportunity moves through a clear, branching state:

1. **Latent** — it exists in the seeded or world-generated simulation but is not known to the player.
2. **Sighted/provisional** — the player notices an environmental clue, such as birds, disturbed water, debris or a reef opening.
3. **Investigated/provisional** — the player spends expedition capacity to survey, test, salvage or chart it. The result belongs to the current expedition.
4. **Returned lead** — an unsurveyed sighting is safely reported at the exact dock. It becomes an inherited lead but grants no economic benefit.
5. **Returned survey or object** — exact-dock return makes an investigated report or recovered object inherited knowledge and eligible for later use.
6. **Active** — the tribe or a connected community uses the returned opportunity automatically, where route and capacity conditions allow.
7. **Developed** — later growth may make its effects more visible through extra boats, dock facilities or settlement change.

A provisional sighting or investigation belongs to the current expedition. If the explorer wrecks before returning, it is lost with them. The physical opportunity remains in the deterministic world and can be found again. A returned lead survives but stays inactive until a later navigator investigates it and safely returns the result.

## 5. Legacy goals: idols and historical records

### 5.1 Purpose of idols

Idols are a finite collection of rare relics distributed through the seeded world. They are a long-term achievement goal that gives players a reason to explore every kind of meaningful place: islands, historic wrecks, reefs, abandoned anchorages, ruins and unusual landmarks.

They should not function primarily as currency or as mandatory power upgrades. Their value is historical, visual and completion-driven:

- every returned idol becomes a named exhibit in the home archive;
- the navigator who returned it receives permanent credit in their generation record;
- the collection count gives the lineage a clear long-term objective;
- idols can reveal lore, display art, archive entries or a final historical revelation;
- a completed collection can support a completion ending or major world celebration without invalidating continued play.

To avoid treating living cultures as loot, idols should normally be relics from abandoned sites, lost ships, shared ancient traditions or places where recovery is explicitly appropriate. An object belonging to a living community should instead become a relationship, entrusted-return or cultural discovery story.

### 5.2 Idol placement and clue rules

Each world has a configured, deterministic idol set. The player may know the total count through oral history or the home archive, but never receives a list of exact locations.

Idols must be attached to meaningful locations rather than arbitrary hidden map cells. Valid sources include:

- a historic wreck with a sealed hold;
- a ruin, shrine or cave on an island;
- a submerged reef site or tidal chamber;
- a long-abandoned anchorage;
- a distinctive natural landmark with a recoverable relic.

The player should encounter clues before an idol becomes available. A clue can be environmental, historical or chart-based: an unusual wreck silhouette, old carvings, birds over a reef gap, a recovered map fragment or a survey result from another site. Clues should indicate promise without revealing the exact reward.

### 5.3 Idol lifecycle

| State | What the player knows | What the tribe or archive gains |
| --- | --- | --- |
| Hidden | Nothing | Nothing |
| Sighted lead | There may be something worth investigating | Nothing |
| Surveyed | The site contains an idol or a strong idol lead | A provisional expedition record only |
| Recovered aboard | The physical idol occupies cargo space | Still provisional until return |
| Returned | The idol is safely delivered to the home archive | Permanent lineage achievement and navigator credit |
| Lost in a wreck | The idol is not collected | A recoverable lost-relic state at the wreck or source; never permanent destruction |

Surveying an idol site must cost expedition capacity, normally a survey or salvage case plus time and, where appropriate, cargo space. This makes discovery a choice: the player can preserve resources for range, investigate now or mark the lead and return later.

An idol aboard a wrecked ship is not credited as collected. It should become recoverable by a future generation through the wreck marker, or be restored to its original site if that is clearer for the content. This preserves meaningful failure without breaking a full-collection game goal.

### 5.4 Great Hall voyage record and lineage archive

The player-facing record is a diegetic **Great Hall** rather than an arcade score screen. It is opened at the home island, after an important return or on the handover to a new generation. It is not a permanent sailing HUD.

Each navigator receives four numbered voyage positions. A navigator who completes their tenure fills all four with safely returned voyages. A navigator who dies in a wreck keeps their earlier completed voyages, receives a respectful terminal lost-voyage record and cannot use the remaining positions.

| Record section | Examples |
| --- | --- |
| Voyages 1–4 | Numbered returned voyages, or the terminal voyage on which the navigator was lost |
| Landfalls | Islands, shoals, wrecks, anchorages and passages first brought home as knowledge |
| Surveys returned | Fishing grounds, resources, settlement contacts, migration sites and safe routes confirmed |
| Connections made | Supported corridors, active fishing grounds, trade links and future home sites enabled |
| Idols recovered | Named relics returned by that navigator |
| Navigator's fate | Completed four-voyage tenure or lost at sea, without treating death as a positive score |

The lineage archive aggregates permanent progress across every generation. It may show a restrained completion count such as **Idols recovered: 4 of 12**, recovered silhouettes and named exhibits. It must not reveal the remaining locations.

Only returned achievements count as permanent legacy. Sighted and surveyed-but-unreturned opportunities remain provisional and are lost after a wreck. The terminal lost-voyage entry records what happened, not its provisional achievements. This keeps exact-dock return as the game's clear commitment boundary.

### 5.5 How idols drive exploration

Idols should create curiosity at several scales:

- A nearby clue makes a player decide whether to spend a survey case during the current voyage.
- A returned clue gives a future voyage a concrete target beyond the next fog frontier.
- A partially completed archive encourages travel to different types of locations rather than repeatedly harvesting one known route.
- A lost idol aboard a wreck creates a recoverable reason for a later generation to revisit dangerous water.

Idols therefore complement, rather than replace, economic discoveries. A fishing shoal improves community capacity; an idol gives the player a memorable historical objective. Both require survey, cargo decisions and a safe return.

## 6. Community support and voyage commitment

### 6.1 Two layers of expedition support

The community provides two different kinds of support:

| Layer | Role |
| --- | --- |
| Recovery allocation | A minimum, still-useful expedition that is always available. It prevents the game from becoming a real-time waiting exercise. |
| Optional commitment | Additional provisions, survey cases, salvage capacity and cargo room that make a longer or more capable voyage possible at a greater cost to community reserves. |

The player should always be able to leave the dock. The real choice is how ambitious the next expedition should be.

### 6.2 Voyage load choices

The first player-facing version should use a few readable commitments rather than a detailed resource ledger:

| Commitment | Gameplay result | Community result |
| --- | --- | --- |
| Light | Short reconnaissance, limited ability to investigate leads | Routine activity remains stable |
| Standard | The normal expedition baseline | The expected community investment |
| Deep-water | Greater range and more survey or salvage capacity | Draws on reserve, delays some growth or reduces visible activity |
| Recovery | Smaller but practical allocation after a major loss | The community is rebuilding after a failed investment |

The exact numbers are tuning values, not normal-play UI. The accepted baseline currently uses physical provision bundles and a fixed resupply model. A future gameplay minor may introduce different allocations only after its save-version invalidation, balance and playtest plans are approved.

### 6.3 Capacity trade-offs

A voyage should have limited physical space. The player balances:

- provision crates for reach;
- survey or salvage cases for validating opportunities;
- open cargo space for recovered finds;
- later, specialised equipment only if it creates distinct and enjoyable decisions.

This makes an expedition plan meaningful without requiring a complex inventory. A navigator who packs only provisions can travel far but may be unable to prove a valuable discovery. A navigator who brings survey equipment may need to turn home earlier.

## 7. Survey and salvage costs

A player should be able to sail past a lead for free. The cost begins only when they choose to investigate.

| Opportunity | Investigation commitment | Possible results |
| --- | --- | --- |
| Fishing shoal | Survey case, a short stop and small voyage cost | Poor or seasonal fishing, useful local catch, major long-term ground |
| Wreck | Salvage case, time and cargo space | Supplies, chart, rare tool, historic object, partial salvage or little value |
| Reef passage | Survey case and careful movement | Safe shortcut, harvest site, useful anchorage or dead end |
| Current lane | Charting effort and voyage time | Faster or safer route, seasonal lane or minor local variation |

Results are uncertain to the player but fixed by the world state. Environmental clues should communicate rough promise: a large, dense bird flock and visibly active water are more promising than a faint ripple. A disappointing result must be uncommon enough and signposted enough that it feels like a reasonable gamble, not arbitrary punishment.

A lead that turns out to be poor can still add small navigational knowledge or story texture, but it should not become a profitable repeat action.

## 8. Wrecks, inheritance and recovery

A failed high-investment expedition is the death of the explorer and the loss of the community's latest contribution. It should produce a tangible inherited setback:

- the active Personal route and provisional discoveries are lost;
- provisions, survey cases, cargo and the expedition vessel are lost;
- the next generation begins with a recovery allocation rather than full ambitious backing;
- extended-voyage options may be unavailable until the community recovers;
- fishing and trade activity can visibly reduce;
- harbour improvements or new route launches can pause.

At the same time, a wreck must preserve earlier success:

- Supported routes survive;
- returned discoveries survive;
- active fishing grounds and trade links continue, though possibly at lower intensity;
- the wreck remains as a visible, later-discoverable marker;
- the next navigator can use Supported water at no provision cost to reach a distant old frontier.

The persistent wreck remains associated with the lost navigator. Finding it can
later become an optional objective that resolves part of the Great Hall record
and returns bounded evidence or knowledge of what happened. Recovery must not
retroactively commit every provisional discovery from the fatal expedition.

This is the central inheritance rule:

> A wreck does not erase the inherited world, but it makes the next generation rely on it.

Recovery happens through play, not idle time. A small safe return, a newly confirmed nearby shoal, a recovered wreck object or output from already-established automatic routes can restore community capacity. The game must maintain a floor beneath which the player cannot fall into an unwinnable wait state.

## 9. Automatic world activity

Once an opportunity has been returned and the required route conditions are met, the communities take over routine operation.

- Fishing boats travel between a connected island and a confirmed shoal.
- Trade vessels travel only along Supported water between connected settlements.
- Local boats may use confirmed anchorages, reef passages or current lanes.
- Dock activity, storehouse fullness, repair work and settlement silhouettes respond to sustained connections.
- Traffic remains sparse enough to read as a world consequence, not visual noise.

The player does not open a route-management screen. Their return report and Supported route are the approval. In a later, deeper economy, communities may choose among competing opportunities automatically based on their needs, but this should remain legible through visible world changes.

## 10. Economic time without waiting

Economic simulation should advance on meaningful voyage transitions, not through a requirement to idle at the dock.

The next playable voyage starts immediately, but a safe return or fatal-wreck succession represents elapsed world time between voyages. Connected communities are assumed to have been fishing, trading and working; after a loss, the tribe has also determined that its navigator will not return, mourned them and nominated a successor. The transition settles the effects of that elapsed period and can later present a short world-facing handover or mourning scene without imposing real-time waiting.

This supports the desired pacing:

- the player returns and can leave again immediately;
- automatic routes have had time to matter during the compressed transition;
- a major loss changes available support and visible activity immediately;
- recovery occurs through successful play and established infrastructure rather than a countdown timer.

## 11. UI direction

The UI must uphold the normal-play minimal-HUD rule. The world and the physical ship communicate most state. Interface appears only at a dock or at the moment of a contextual decision.

### 11.1 Persistent sailing presentation

Normal sailing should show:

- the boat and its physical cargo rack;
- provisions, survey cases and empty cargo positions as distinct physical objects;
- environmental clues in the world;
- active fishing and trade boats on Supported routes;
- only the existing navigation and risk guidance required by the exploration loop.

It should not show a permanent economy panel, resource spreadsheet, market prices or task list.

### 11.2 Dock preparation

While moored at the home dock, the player opens a compact cargo layout. This is the one deliberate preparation surface.

The preferred initial UI is a small set of commitment choices such as **Light**, **Standard** and **Deep water**. The selected option changes the physically shown cargo plan and displays a plain-language community consequence such as:

- “The village will manage well.”
- “This is the usual expedition provision.”
- “Fishing crews will reduce their trips.”
- “The stores cannot support a voyage this large.”

A later version can expose a small grid of physical cargo slots for more detailed tuning. It should still avoid a raw numerical slider as the main interaction.

### 11.3 Contextual survey and salvage

At sea, the player first sees a clue, not a menu. Birds, fish, debris, water colour or a broken mast draw attention.

Only within inspection range should a small world-adjacent ribbon appear:

- **Survey** — consumes a survey case;
- **Leave** — continue sailing.

For a wreck, the first option becomes **Examine wreck** and visually shows the required salvage case and cargo space. The selected physical case on the boat can highlight before it is consumed. The ship pauses briefly while the crew performs the action; this is a concise world action, not a long progress bar.

### 11.4 Provisional records

A sighted or investigated opportunity can leave a faint temporary mark on the expedition’s personal chart. It is useful for deciding whether to return later during that expedition, but it is not a permanent map marker until exact-dock return.

### 11.5 Automatic return report

At the dock, reporting is automatic. Workers receive the chart or cargo, followed by one concise world-facing confirmation such as **Fishing ground confirmed**. Later voyages visibly show the consequence: fishing skiffs operate at the shoal, trade vessels use the new route or the harbour gains activity.

There is no sell screen and no manual route assignment.

### 11.6 UI options and recommendation

| UI need | Minimal option | Richer option | Recommendation |
| --- | --- | --- | --- |
| Expedition load | Light, Standard and Deep-water commitments | Small physical cargo-slot layout | Begin with commitments; add slots only if playtests need more planning depth |
| Opportunity discovery | Proximity prompt with Survey or Leave | A short inspection card with a clue-quality description | Use proximity prompt; do not interrupt sailing at first sight |
| Provisional knowledge | Faint temporary world/chart mark | Expandable personal expedition log | Start with the faint mark |
| Returned result | Brief dock report and visible boat activity | A compact returned-discovery journal | Use automatic dock report; journal can be optional later |
| Community health | World activity and plain-language dock feedback | Optional accessible summary | Prefer visual world state, with an accessibility-readable summary |
| Idol collection | Home archive and a restrained total recovered count | Expandable generation-by-generation relic chronicle | Keep the collection out of the sailing HUD and do not reveal remaining locations |

The single three-panel UI mockup created for this discussion is the intended visual reference: dockside physical loading, a tiny in-world survey decision, and automatic dock reporting followed by fishing traffic. Idol recovery uses the same contextual pattern: a meaningful world clue, a small **Survey** or **Examine** decision, physical cargo space and automatic archiving after return. The mockup is a direction reference, not a final production layout.

## 12. Map language

Map and world presentation should make the economic state readable without a large legend:

| State | World language |
| --- | --- |
| Unknown opportunity | Environmental clue only |
| Sighted or provisional | Faint personal mark, visible only to the active expedition |
| Returned opportunity | Persistent mapped symbol or recognisable landmark |
| Active fishing ground | Small skiffs, nets, fish activity and route wakes |
| Active trade connection | Cargo boats, busy docks, storage and travel on Supported corridors |
| Community recovery | Reduced but surviving activity, quieter dock, fewer optional projects |
| Community growth | More boats, fuller stores, expanded docks and active island silhouettes |
| Returned idol | Archive display and named historical record at home; no map spoiler for remaining idols |
| Lost idol | Recoverable wreck or renewed site clue, never a permanently failed collection slot |

## 13. Content boundaries

The first economy layer should use a small number of clear resource families. Suggested initial families are food and marine harvest, repair and craft material, building material, navigation knowledge, surveyable settlement or migration sites, and rare one-off finds.

Do not start with a large list of commodities, dynamic price simulation, manual labour assignment, arbitrage or a global market. The goal is to make the world’s growth visible and exploration choices richer.

Do not make idols a generic sale item, a compulsory source of raw power or a random collectible hidden in ordinary water. They are finite, meaningful relics tied to surveyable points of interest.

## 14. Roadmap placement

The active roadmap is defined in `Wayfinders_Roadmap.md`. This design maps to it as follows.

### GP-1: fishing grounds and survey work

Begin with deterministic fishing-shoal clues, limited survey cases, an explicit **Survey / Leave** choice, branching returned-lead/returned-survey records and one clear developer cue proving Supported connectivity. Authoritative tribe activation and output wait for GP-3. Use developer graphics and do not introduce tribe reserves, production assets, salvage or idols in the first vertical slice.

### GP-2: explorers, generations and lineage history

Add persistent navigator identity, a maximum four-voyage tenure, automatic succession after the fourth safe return, fatal early succession on wreck and the Great Hall voyage chronicle used to credit later economic discoveries and idols. A later wreck-recovery milestone may let another navigator discover evidence or knowledge about someone lost at sea.

### GP-3: tribe economy, support and recovery

After survey work is understood, introduce tribe support state, a protected recovery floor, automatic activation and output from returned fishing grounds, dockside voyage commitments, Supported-only fishing activity, wreck setback/recovery and later automatic exchange with connected communities. Economic time settles on inter-voyage return/wreck transitions and never requires real-time waiting.

`GP-3.2` is the proposed earliest gate for isolated graphics-platform work: the complete survey → return → visible tribe benefit loop must first work with developer graphics.

### GP-4: idols, archive and optional completion

Add the deterministic idol registry, clue and survey state, salvage/cargo rules, recoverable wreck loss, home archive and navigator credit. Returning every idol unlocks an optional completion ending while allowing continued play.

### GP-5 and the cross-cutting persistence gate

Every gameplay minor that changes authoritative persisted state bumps the affected schema/content/format version, invalidates earlier saves and includes deterministic current-version round-trip tests. Cross-version migration is intentionally out of scope during development. GP-5 later turns the working autosave/checkpoint foundation into the confirmed player-facing new/save/load experience and hardens long multi-generation continuity within a supported version.

### Graphics track

Production asset IDs, the resolver, asset viewing/creation tooling and production passes belong to the separate `GR-*` track. Developer graphics remain the gameplay fallback. Production replacement begins only after its roadmap start gate is explicitly approved.

### Later expansion

Only after the basic loop is enjoyable should the game add richer settlement needs, multiple competing routes, specialist equipment, family trees, inheritable traits, reputation, politics or a deeper trade simulation.

## 15. Validation criteria

The economy design is successful only if playtests show all of the following:

- Players can always begin another meaningful voyage without waiting in real time.
- Players understand that more support enables longer or more capable voyages but draws on the community.
- Survey and salvage feel like real choices, not compulsory interaction prompts.
- A returned fishing ground or trade link visibly changes the world.
- Players understand that sighting, surveying, recovering and returning an idol are different states.
- Every idol remains collectible after any legal sequence of wrecks; a lost relic is recoverable rather than silently destroyed.
- The generation record clearly credits returned surveys and idols without becoming a permanent score HUD.
- The lineage archive gives a clear collection goal without exposing exact remaining idol locations.
- Players understand that a wreck hurts the next generation while earlier Supported routes remain valuable.
- Recovery feels achievable through smaller successful voyages and inherited routes, not through grinding.
- Routine automatic traffic makes Supported waters feel alive without obscuring navigation, fog, risk overlays or performance.
- Normal play remains free of a permanent numerical economy HUD.

## 16. Roadmap approval gates and later decisions

- Should a recovery allocation be a fixed lower supply level, a changing percentage of community capacity, or both?
- How much uncertainty should visual clues communicate before a player spends a survey case?
- Should any wreck salvage restore a portion of the original community investment, or only provide new opportunities?
- Which resource families create the strongest early visible changes at home and on remote islands?
- When should a returned opportunity activate automatically, and when should it wait for a compatible Supported route or community capacity?
- Does the player need a dedicated map or logbook outside the world view, or is a temporary personal mark plus returned world markers sufficient?
- What is the appropriate idol count for the default world and for larger future worlds?
- Should all remaining idols have equal mystery, or should partial charts and archive clues gradually narrow the search?
- The roadmap proposes that returning the final idol marks the game complete, presents a historical revelation or world celebration, and offers **End the lineage** or **Continue exploring**. The exact presentation and permanence of that choice still require approval.
