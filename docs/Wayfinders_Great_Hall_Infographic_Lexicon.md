# Wayfinders Great Hall infographic lexicon

This document owns the graphical information vocabulary for the proposed Great
Hall presentation. It defines only information available from the current
`GreatHallChronicle` read model and current Hall modes. The detailed milestone
and acceptance sequence lives in
`Wayfinders_Great_Hall_Presentation_Milestone.md`; planning and authorization
state live in `Wayfinders_Roadmap.md`.

The lexicon is an implementation and art contract, not a runtime asset. Final
pixel dimensions and predefined project files are decided and reviewed in the
Great Hall art-and-preview milestone.

Reference art for every component is indexed in
`../concept_art/great-hall/infographics/README.md`. Those sheets visualize this
contract but do not override its field mappings or runtime rules.

## Authority and safety rules

- Map structured fields and discriminated unions. Never parse an achievement's
  prose `label` to choose a symbol.
- Show only exact-dock-committed history. A fatal voyage has no achievement
  tokens, and an undiscovered idol host has no visual representation.
- Use shape, fill, placement, and material before color. Every state must
  remain distinguishable in grayscale and reduced saturation.
- A visible count is always a decimal number or `found / total`; decorative
  tally marks cannot replace an exact value.
- Every compact mark has an accessible name. Focus or activation exposes the
  exact existing labels and values; hover is never the only explanation.
- Portrait, icon, frame, patina, repair, and animation pixels remain
  presentation. They never choose or change gameplay state.
- Use the invented home-island grammar: canoe construction, wakes, islands,
  lagoons, timber, sailcloth, rope, shells, fish, and navigation marks. Do not
  copy an identifiable real-world sacred or culturally restricted motif.

## The eight infographic components

### 1. Lineage counting cord

A shell-and-rope strip summarizes the fourteen facts displayed by the current
Hall. It is not a generic score bar: it appears only inside the Great Hall.

| Token ID | Current source | Compact visual | Value format |
| --- | --- | --- | --- |
| `tally-idol-progress` | `idolProgress.found`, `idolProgress.total`, `idolProgress.complete` | Gold shell-idol inside an open or completed ring | `found / total` |
| `tally-navigators` | `totals.navigators` | Three overlapping portrait silhouettes | Integer |
| `tally-safe-journeys` | `totals.returnedVoyages` | Canoe bow entering a two-post home harbor | Integer |
| `tally-completed-tenures` | `totals.completedNavigators` | Portrait plaque above four closed voyage notches | Integer |
| `tally-lost-navigators` | `totals.lostNavigators` | Broken canoe beneath one wave | Integer |
| `tally-supported-route-tiles` | `totals.supportedRouteTiles` | Dotted wake connecting two safe-water marks | Integer |
| `tally-mapped-water-tiles` | `totals.mappedEnclosedWaterTiles` | Closed lagoon ring | Integer |
| `tally-island-leads` | `totals.islandLeads` | Outline island with two sight rays | Integer |
| `tally-island-dossiers` | `totals.islandDossiers` | Inlaid island inside a closed survey ring | Integer |
| `tally-site-leads` | `totals.surveySiteLeads` | Open coastal survey marker | Integer |
| `tally-site-reports` | `totals.surveySiteReports` | Filled coastal survey marker | Integer |
| `tally-fishing-leads` | `totals.fishingLeads` | Outline fish above an open ripple | Integer |
| `tally-fishing-surveys` | `totals.fishingSurveys` | Filled fish above a closed ripple | Integer |
| `tally-confirmed-wrecks` | `totals.confirmedWreckFates` | Broken mast joined by a bright shell knot | Integer |

Default presentation may emphasize idol progress, navigators, safe journeys,
and loss while placing the other ten tokens in a second line or expandable
counting mat. All fourteen remain directly available without navigating to a
different screen.

The read model contains additional aggregates that the current Hall does not
show globally: `lostVoyages`, `activeNavigators`, `wreckReports`,
`unlocatedWreckFates`, and a separate `idolLocations` credit total. They do not
gain new counting-cord tokens in this proposal. Their relevant facts already
appear through voyage, navigator, wreck-fate, and idol-progress graphics.

### 2. Era navigation rail

The era rail locates the selected navigator inside a long lineage without
turning history into an unbounded scroll.

| Element | Source or derivation | Visual rule |
| --- | --- | --- |
| Era range | Pure twelve-generation page arithmetic from `generation` | Two small endpoint numerals joined by twelve knots |
| Era position | Selected era / total eras | One bright shell on a bounded knot track |
| Previous / next era | Neighboring derived page | Left/right canoe-prow control |
| Current navigator | Last active navigator selected by current Hall behavior | Distinct harbor-shell shortcut |
| Direct generation jump | Valid generation range `1..totals.navigators` | Secondary numeric control, not part of the primary art |

Era grouping is presentation only. It does not imply a historical age,
dynasty, family branch, or gameplay phase.

### 3. Navigator portrait plaque

Each era member is one portrait button with a small generation numeral and a
material state. The current lineage contract has no name, age, gender, role,
trait, or biography, so none may appear as factual badges.

| Plaque state | Current source | Material and silhouette |
| --- | --- | --- |
| Active | `state === "active"` | Fresh turquoise edge, open lower voyage rail |
| Completed | `state === "completed"` | Warm patina, four closed voyage notches |
| Lost, unlocated | `state === "lost"` and fate absent or `unlocated` | Smoke-darkened cracked frame, open break |
| Lost, confirmed | `state === "lost"` and fate `confirmed` | Same crack visibly joined by shell stitching |
| Selected | View selection only | External light/frame emphasis that does not replace lifecycle state |

Portrait appearance comes from the fixed ordered catalog of twenty complete
portrait files. Generation number selects the corresponding file directly.
Lifecycle materials are separate frame treatments so a later wreck report can
repair the same memorial without changing the navigator's face.

### 4. Four-slot voyage record

Every selected navigator has exactly four ordered voyage sockets because the
implemented tenure limit is four. Slot position supplies the voyage number, so
a large repeated word label is unnecessary.

| Slot state | Current source or safe derivation | Visual rule |
| --- | --- | --- |
| Returned with findings | A `returned` voyage with achievements | Closed harbor notch plus achievement tokens |
| Returned without findings | A `returned` voyage with no achievements | Closed harbor notch plus a quiet empty shell |
| Lost at sea | A `lost-at-sea` voyage | Broken band ending in one wave; no achievement token area |
| Next voyage awaits | Active navigator, slot `completedVoyages + 1` | Bright open canoe socket |
| Later unsailed voyage | Active navigator after the next slot | Unpainted hollow socket |
| Closed after loss | Lost navigator after the fatal slot | Dark plain timber with no canoe or achievement marks |

The closed-after-loss state is important: it must not look like a future voyage
the lost navigator can still attempt. A fatal slot never shows provisional or
greyed-out achievements.

### 5. Voyage achievement tokens

These ten tokens map one-to-one to the current `GreatHallAchievement` union.
Lead/report pairs share a base silhouette and change outline versus inlay so
their relationship is learnable.

| Chronicle `kind` | Required visual | Visible modifier | Exact detail retained |
| --- | --- | --- | --- |
| `supported-route-tiles` | Dotted canoe wake | `tileCount` | Existing `label` |
| `mapped-enclosed-water-tiles` | Closed lagoon ring with a small map notch | `tileCount` | Existing `label` |
| `island-lead` | Outline island with sight rays | None | `name`, existing `label` |
| `island-dossier` | Inlaid island inside a closed ring | None | `name`, `findingLabel`, existing `label` |
| `survey-site-lead` | Open survey marker with optional site-type inset | None | `typeLabel`, `clueLabel`, existing `label` |
| `survey-site-report` | Filled survey marker with optional site-type inset | None | `typeLabel`, `resultLabel`, existing `label` |
| `fishing-leads` | Outline fish above open ripples | `leadCount` | Existing `label` |
| `fishing-survey` | Filled fish above closed ripples | One, two, or three quality notches | `quality`, existing `label` |
| `wreck-report` | Broken mast joined by a shell knot | Small lost-generation numeral where space permits | `lostGeneration`, existing `label` |
| `idol-location` | Unique gold shell-idol | `ordinal`; small host-type inset in expanded detail only | `displayLabel`, `locationLabel`, existing `label` |

#### Animation grammar

The checked-in animation preserves each medallion's silhouette, material, and
outline-versus-inlay distinction in every frame. Motion is restrained and
semantic: wake and lagoon marks travel, sight and survey marks pulse, fishing
ripples breathe, the shell repair settles, and the idol alone receives the warm
gold glint. A shared rim shimmer and subpixel-scale settling keep the family
coherent without making motion carry achievement meaning. Reduced-motion
presentation freezes a complete first-frame symbol. Exact sheet geometry and
continuity validation are owned by `Wayfinders_Asset_Pipeline.md`.

#### Current survey-site insets

The site token remains generic and registry-friendly. The three implemented
types may add a small inset without creating separate achievement kinds:

| `siteType` | Inset |
| --- | --- |
| `historic-wreck` | Old hull rib and short broken spar |
| `coastal-ruin` | Three broken shoreline stones |
| `tidal-cave` | Dark rock arch crossed by a tide line |

An unknown future registry type uses the common survey marker without an inset
until reviewed art exists. The absence of a subtype icon must never prevent its
lead or report from appearing.

#### Fishing quality notches

The current quality values are `lean`, `steady`, and `rich`. They use one, two,
and three small fin or ripple notches respectively. The fish silhouette and
accessible label still identify the achievement when the notches are too small
to resolve.

#### Token aggregation

- Route tiles, enclosed-water tiles, and fishing leads are already count-based
  achievements; render one token with the current exact count.
- Island leads, island dossiers, site leads, site reports, fishing surveys,
  wreck reports, and idol locations are distinct records. Render individual
  tokens while they fit.
- When a voyage contains more records than its compact band can show, group
  only identical `kind` values into a stack with an exact count. Activating the
  stack lists every underlying achievement in stable chronicle order.
- Never merge a lead with its report, two different island names, two different
  site results, two fishing qualities, two lost generations, or two idol
  locations in the exact-detail roster.

### 6. Wreck-fate relationship

Loss and later confirmation span two navigators and must read as a historical
relationship rather than two unrelated icons.

| Fate | Available current information | Graphic |
| --- | --- | --- |
| Unlocated | Lost navigator and fatal voyage only | Open crack in the lost portrait frame; no location or finder hint |
| Confirmed | Lost navigator, confirming navigator generation, and confirming voyage number | Shell repair on the lost frame plus a short dotted cord to the finder portrait when both are visible |

If the finder is on another era page, the repair remains and its detail plaque
provides a single action to select that generation. The graphic never exposes
raw `wreckId`, hidden wreck position, or a wreck identity before its report has
returned home.

### 7. Idol progress and completion medallion

Idol-location knowledge is the only finite lineage objective currently exposed
by the Hall. Its gold shell-idol is deliberately unique and must not be reused
for ordinary excellence, portrait decoration, or currency.

- In progress: `found / total` appears inside an open ring with one inset shell
  per returned location when the configured total is small enough.
- Complete: the ring closes after the final exact-dock return and receives a
  restrained harbor-light treatment.
- A voyage token appears only for a returned `idol-location` achievement.
- The token may show whether the known host is an island dossier or survey site
  in expanded detail, but it never hints at an undiscovered host.

Completion presentation still needs the textual **Continue exploring** and
**Start new game** actions. The medallion cannot replace an explicit choice.

### 8. Exact-detail plaque and symbol glossary

Minimal default text is supported by one consistent detail surface, not by
discarding labels.

The plaque can show:

- the selected counting-cord label and exact value;
- navigator generation, lifecycle, returned-voyage progress, and wreck fate;
- voyage number and outcome;
- every exact achievement `label` in a selected token or stack;
- island `name` and `findingLabel`;
- survey-site `typeLabel`, `clueLabel`, or `resultLabel`;
- fishing `quality`;
- lost generation for a wreck report;
- idol `displayLabel` and returned `locationLabel`; and
- the current symbol glossary.

The plaque is reachable by pointer and keyboard, can be pinned without hover,
does not cover the focused control at supported viewports, and exposes the same
content in semantic HTML.

## Visual grammar

### Paired states

| Meaning pair | Visual transformation |
| --- | --- |
| Lead / returned report | Outline / filled or shell-inlaid |
| Awaiting / returned | Open socket / closed harbor notch |
| Unlocated / confirmed fate | Open crack / shell-stitched repair |
| Idol in progress / complete | Open ring / closed illuminated ring |
| Active / completed navigator | Fresh open rail / patinated four-notch rail |

### Palette roles

- Deep teal: Hall shadow and inactive recess, never the only state marker.
- Timber brown and rust: physical structure and completed-history patina.
- Sand cream: readable symbol ground and exact-detail plaque.
- Turquoise/seafoam: active selection, safe return, and navigation continuity.
- Charcoal: loss and unsailed closure, paired with broken silhouettes.
- Shell gold: idol-location knowledge and confirmed memorial repair only.

### Density levels

The same meaning has three approved levels rather than unrelated artwork:

1. **Tally:** one silhouette plus a number.
2. **Voyage token:** silhouette, modifier/count, and focus target.
3. **Detail:** larger symbol plus exact text and record-specific fields.

Portrait thumbnails and the selected portrait use the same fixed portrait file;
the thumbnail is not a separately invented likeness.

## Explicit exclusions from the current infographic set

The current implementation does not support truthful infographics for:

- navigator names, ages, genders, occupations, personalities, skills, traits,
  relationships, family branches, or inherited features;
- voyage duration, distance, route shape, provisions spent, risk survived, or
  chronological date;
- island size, population, culture, trade value, resource yield, or ownership;
- a hidden idol host, unsurveyed finding, provisional expedition record, or
  unrecovered fatal-voyage achievement;
- raw navigator, voyage, expedition, wreck, island, site, fishing, or idol IDs
  as player-facing content;
- a global score, navigator ranking, medal tier, rarity, or best voyage; and
- history persisted across browser refresh.

Adding any of these requires an explicit data and product contract before art
is designed. The Great Hall must not infer them from generation number, seed,
portrait artwork, achievement quantity, or decorative material.

## Acceptance checklist

- [ ] All fourteen current Hall totals map to exactly one counting-cord token.
- [ ] All ten `GreatHallAchievement` kinds map from the discriminant, not text.
- [ ] The three current survey-site types have reviewed optional insets and a
      generic fallback exists.
- [ ] `lean`, `steady`, and `rich` fishing quality remain distinguishable with
      exact labels available.
- [ ] All active, completed, lost/unlocated, and lost/confirmed navigator states
      remain distinguishable without color.
- [ ] All six voyage-slot states remain distinguishable, including future
      unsailed versus permanently closed after loss.
- [ ] A dense voyage can group tokens without dropping, reordering, or merging
      exact achievement labels.
- [ ] Wreck confirmation can link to the returning generation and voyage
      without exposing an unreturned or hidden wreck fact.
- [ ] Idol progress shows only returned locations and preserves both completion
      actions.
- [ ] Every compact symbol works with pointer, keyboard, reduced motion,
      grayscale, and screen-reader presentation.
- [ ] No excluded or unimplemented fact appears as if authoritative.
