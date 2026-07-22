# Wayfinders possible future features

Status: idea bank only. Nothing in this document is planned, proposed for
implementation, or authorized. The current roadmap remains the sole owner of
planning, sequencing, and authorization status. Any idea selected from this
document needs its own product decision, scoped milestone, technical contract,
budgets, and acceptance criteria before implementation.

## Purpose

Wayfinders already supports sailing beyond safe water, managing provisions,
building Personal knowledge, returning it as Supported knowledge, surveying
discoveries, recovering the stories of lost navigators, and carrying a chart
forward through a lineage. Future features should deepen the decisions and
activities inside a voyage instead of merely adding more locations that use
the same approach-and-survey interaction.

Useful additions should:

- make sailing, observation, route choice, and return timing interesting;
- create stories that can span several voyages or navigators;
- let the world respond visibly to returned knowledge;
- preserve exact-Home docking as the only expedition-settlement point;
- respect provisional discovery, wreck rollback, fog, and hidden-information
  boundaries; and
- avoid turning the game into combat, generic resource harvesting, or a
  conventional accumulating economy.

## Possible activities and progression

### Expedition briefs

At Home, offer a small deterministic choice of optional voyage objectives.
Examples include charting a channel, investigating a rumor, locating a fishing
ground, tracing a coastline, or resolving a known navigator wreck. Briefs give
the player an immediate reason to depart while leaving free exploration valid.

A completed brief could grant one temporary preparation for a later voyage,
such as extra stores, a bounded sounding of one suspected region, a one-use
directional signal, or modest rig tuning. Preparations should create choices
rather than an indefinitely growing stockpile or permanent power curve.

### Active charting

Make skilled sailing itself produce knowledge. Potential charting tasks
include:

- tracing enough of an island's coastline to establish its shape;
- sailing a transect through Unknown water;
- connecting two separated bodies of Supported knowledge;
- completing a loop around a reef or island;
- sounding a narrow passage at controlled speed; and
- recording a safe approach from open water to a discovered site.

These tasks should use actual movement paths and heading without requiring the
player to paint tiles manually. Their provisional results would settle only on
an exact return to Home.

### Clue-led discoveries

Returned dossiers and site reports could provide spatial clues instead of
exact objective markers. A clue might identify a broad direction, distance
band, neighboring landform, water condition, animal sign, or relationship
between two already known places. Several partial clues could overlap to form
a useful search region.

This would make the idol-location objective a deduction problem rather than an
exhaustive series of surveys. Clues must be derived from authoritative facts
and reveal only what their wording promises; presentation must not leak a
hidden host through art, animation, or marker placement.

### Distinct fieldwork

Different discoveries could ask for different short sailing interactions
before the usual provision-spending decision:

- sample a fishing shoal along a slow, directed pass;
- take bearings on a ruin from two clear-water positions;
- hold station on the safe side of a historic wreck;
- visit two or three coastal observation points to complete an island dossier;
  or
- follow the mouth of a tidal cave without crossing its unsafe edge.

These interactions should remain readable, brief, deterministic, and forgiving
of input method. They should not become isolated puzzle screens or precision
tests that ignore the sailing model.

### Wreck-recovery voyages

Identifying a navigator wreck could open an optional follow-up voyage to recover
a chart box, heirloom, tool, or final message. Carrying the recovered object
might reserve supply space, reduce handling, or make a prompt-bound claim on
the return margin. Only exact-Home return would complete the recovery.

The recovered object should primarily close a story: update the navigator's
memorial, expose part of the lost route, or preserve a distinctive observation.
It should not turn wrecks into repeatable loot containers or weaken the cost of
failure.

### Navigator vocations

On succession, let the player choose one modest specialization for the next
navigator. Possible vocations include Chartmaker, Surveyor, Quartermaster, and
Storm Reader. Each should change one legible rule, such as trail width, one
class of survey work, starting stores, or weather interpretation.

Vocations should be authoritative choices independent of portrait appearance.
They should create different voyage styles without becoming a large skill tree
or making later navigators strictly better than earlier ones.

### Personal voyage oaths

Before departing, a navigator could accept one optional mastery condition:
return with two completed surveys, chart a continuous loop, resolve a prior
navigator's lead, or reach Home with a narrow supply margin. Success could add
a distinctive mark to that voyage in the Great Hall.

Oaths should offer recognition and story rather than essential power. Failure
should never erase an otherwise successful returned voyage.

### Player-authored chart marks

The map-review surface could allow session-scoped pins, danger marks, suspected
clue regions, and route sketches. These are the player's notes, not world
authority: they reveal nothing by themselves and may be wrong.

Marks would reduce memory burden and make clue-led exploration practical. They
would need accessible labels and clear visual separation from authoritative
Supported knowledge, current sight, risks, and developer diagnostics.

### Limited waystations

A returned community dossier could permit one emergency cache, signal beacon,
or sheltered anchorage. A waystation might provide a small one-use supply,
improve a nearby clue, or mark a known approach. It must not settle an
expedition, convert discoveries to returned knowledge, create unlimited
refills, or make Home strategically irrelevant.

This is a higher-risk idea because even limited remote support can collapse the
current provision and return decisions. It should be tested only after its
effect on viable range and wreck frequency is modeled.

### Living encounters

Sparse deterministic encounters could appear between permanent landmarks:
stranded crews, signal fires, drifting cargo that can be reported rather than
looted, unusual currents, or migrating sea life. The central decision is
whether the diversion is worth the time, route, and provision risk.

An encounter should leave a meaningful observation or consequence instead of
being a disposable pickup. Important encounters should remain deterministic
and replayable even if their presentation includes movement.

### Community projects

Returned knowledge could eventually offer a choice between qualitative Home
projects, such as a chart room, better signal beacons, a larger departure
store, or a memorial workshop. Projects would let the player shape how Home
supports future voyages and make accumulated knowledge visible in the world.

This idea would require a separately authorized progression contract. It must
not expose or spend the current hidden Prosperity score, and it should avoid a
generic build queue or resource-grinding economy.

## A living sea without combat

Sea animals can add activity, navigation information, wonder, and longer-form
stories without becoming enemies. The player's relationship to them should be
based on attention: observe, follow, give space, interpret, assist, remember,
and return what was learned.

### Roles for ordinary sea life

#### Ambient life and ecological texture

Small fish schools, rays, turtles, seabirds, distant whale blows, and dolphins
can make open water feel inhabited. Most ambient animals need no gameplay
state. Their bounded, deterministic presentation can respond to coastline,
water type, vessel distance, weather, and current-clear visibility.

Ambient life should be sparse enough that a meaningful animal sighting still
feels special. It should never be required to identify unseen terrain by
sampling hidden world state in the renderer.

#### Natural navigation signs

Animals can communicate broad, imperfect clues:

- returning seabirds suggest land somewhere along their flight direction;
- feeding birds or surface fish indicate a possible shoal;
- turtles favor calm approaches through reefs;
- a whale's distant breath provides a bearing but not an exact position; and
- a sudden absence of surface life can warn of an approaching severe storm.

These signs should be observable facts with deliberately bounded accuracy, not
decorative leaks of exact hidden locations. Learning to read them could become
part of Wayfinders' navigation identity.

#### Observation encounters

Some animals can support active, non-invasive fieldwork. The player might:

- match a pod's speed and heading while keeping a respectful distance;
- follow a turtle until it reaches a recurring migration turn;
- record two bearings on a distant whale call;
- remain outside a ray congregation while tracing its boundary; or
- observe which side of a reef animals use to reach sheltered water.

Success should come from reading behavior rather than chasing, colliding with,
feeding, capturing, or exhausting an animal. An observation can be provisional
during the voyage and become part of communal knowledge only after returning
to Home.

#### Rescue and stewardship

Occasional encounters could ask the player to free an entangled animal, guide
a disoriented juvenile toward its group, report a damaged habitat, or escort a
creature around a dangerous shoal. Assistance should cost route time or
provisions and may require careful positioning, but never weapons.

Rescues should be uncommon and specific enough to avoid depicting every animal
as helpless. Their most important reward is a changed story or later sighting,
not a material drop.

#### Recurring individuals

A few great travelers could have stable identities expressed through shape,
movement, scars, coloration, song, or route—not a floating nameplate. A
returned observation allows the community to recognize that individual on a
later voyage. It may then be seen at another point in its migration or near a
place connected to an earlier clue.

This creates continuity across navigators without making an animal a pet,
mount, inventory item, or permanent escort.

### Great beasts as mysteries rather than bosses

Wayfinders could include one or a few rare legendary sea beings per world. A
great beast should function as moving geography, a source of clues, and a
multi-voyage chronicle. The long-term goal is to understand its route,
behavior, history, or relationship to the archipelago.

Possible forms include:

- **The Old Shellback:** an immense turtle whose weathered shell resembles a
  small island at a distance. Navigators gradually chart its migration and the
  plants or birds that travel with it.
- **The Stormwhale:** a deep-water traveler that surfaces before major weather
  changes. Reading its direction helps interpret a storm but never guarantees
  safety.
- **The Reef Singer:** a rarely seen creature whose low calls carry through
  deep channels. Bearings recorded on separate voyages can reveal its passage
  through the reef system.
- **The Ribbon Serpent:** a long, non-hostile animal whose movement traces the
  boundary between two water conditions. The challenge is to keep distance and
  understand the route, not corner it.
- **The Lantern Ray:** a broad ray visible at dusk or beneath storm-dark water.
  Several sightings reveal a repeated congregation route associated with a
  natural event or hidden navigational clue.

A beast encounter can be dangerous without making the creature malicious. Its
wake, scale, surrounding currents, reduced visibility, or the player's decision
to follow too far can create risk. The correct responses are to yield, wait,
keep distance, choose another heading, or abandon the observation and return.

Great beasts should have no health bars, damage phases, attack patterns, weapon
checks, harvest tables, or defeat states. A completed story might end with a
fully charted migration, a peaceful close encounter, a protected route, or a
Great Hall chronicle spanning several navigators.

### Creature knowledge lifecycle

Creature knowledge can reuse the spirit of the existing expedition contract
without assuming that every animal is a stationary survey site:

1. Current sight exposes only the creature and signs that are actually
   observable.
2. A meaningful observation creates a provisional voyage record.
3. Further observation can improve that record from sighting to behavior or
   route knowledge.
4. Exact-Home return commits the observation to the community chronicle.
5. A wreck loses the current voyage's unreturned notes but does not kill,
   despawn, or turn the creature into recoverable property.
6. Later navigators can build on returned observations and recognize recurring
   individuals or routes.

Moving animals require care: a returned record should preserve what was learned
without promising that the animal remains at its old position.

### Example multi-voyage beast story

1. One navigator hears a Reef Singer and returns a rough bearing.
2. A successor hears it from another region and returns a second bearing.
3. The community infers a broad passage rather than an exact marker.
4. A later navigator reaches that passage and observes the creature from a safe
   distance while managing the return margin.
5. The returned account completes a Great Hall story shared by all contributing
   navigators and may reveal a safe deep-water route or clue connected to the
   creature's migration.

No step requires fighting, capturing, or defeating the creature. The arc is
about accumulated observation and inherited understanding.

### Presentation and accessibility principles

- Use silhouette, wake, water displacement, sound, birds, and selective
  surfacing to convey scale; constant glow and spectacle should remain rare.
- Keep animal art within current-clear visibility. Audio may suggest a broad
  off-screen bearing only when the gameplay contract explicitly owns that clue.
- Give important behaviors equivalent static, text, and non-audio cues for
  reduced-motion, hearing, and color-vision accessibility.
- Do not derive species, identity, disposition, or gameplay state from sprite
  pixels.
- Avoid copying culturally specific sacred creatures or stories. Great beasts
  should use an invented Wayfinders vocabulary and receive a focused cultural
  and visual review.
- Never reward deliberate collision, repeated harassment, or driving animals
  into terrain.

### Technical boundaries if explored later

Ambient fauna and interactive creatures should not accidentally become one
unbounded system.

- Purely ambient life can be presentation-owned, deterministic, pooled, and
  bounded by the shared active-chunk set.
- Any animal whose location or behavior affects rules needs sparse,
  renderer-neutral feature authority and an immutable presentation model.
- Creature queries must be spatially indexed and topology-aware; normal frames
  must not scan the complete world.
- Movement and routes must preserve lifted direction across world seams.
- Dynamic creatures must not silently become navigation collision authority or
  invalidate return paths every frame.
- Creature presentation may consume water, weather, and current-clear facts,
  but visual pixels and animation never decide gameplay outcomes.
- Audio should use the existing catalog and bounded voice policy rather than a
  parallel sound system.

## Suggested order for future exploration

If future gameplay work is authorized, a low-risk sequence would be:

1. expedition briefs and player-authored chart marks;
2. active charting and one distinct fieldwork interaction;
3. bounded ambient sea life and one observation encounter;
4. clue-led discovery and wreck-recovery voyages;
5. one recurring animal with returned observation history; and
6. one multi-voyage great-beast story after movement, fog, audio, topology, and
   resource budgets have been proven at the smaller scale.

Storms, if separately authorized, can later interact with animal signs and
beast behavior. Weather should increase the decisions inside these activities,
not substitute for giving the player meaningful reasons to undertake them.

## Ideas to avoid by default

- combat, weapons, boss fights, or defeating a great beast;
- hunting, capture, trophies, animal-derived crafting materials, or loot drops;
- repetitive feeding used to purchase obedience or turn wildlife into mounts;
- creature collection as an inventory checklist detached from voyages;
- exact quest markers produced by animals that merely point at hidden content;
- unlimited remote resupply or progression that removes the decision to return;
- a visible Prosperity currency or generic settlement economy; and
- high-frequency random encounters that undermine the sea's quiet scale.

