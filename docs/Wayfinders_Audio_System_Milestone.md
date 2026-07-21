# Wayfinders audio-system design

Status: complete and accepted through `AUD-5` on 2026-07-20. Planning and
authorization status for any follow-up is owned only by
`Wayfinders_Roadmap.md`.

This document records the closed audio design and acceptance criteria. Current
runtime behavior is owned by `Wayfinders_Technical_Design.md`; current code
ownership by `ARCHITECTURE_MAP.md`; stored-artifact and replacement contracts by
`Wayfinders_Asset_Pipeline.md`; and volatile audio verification state by
`IMPLEMENTATION_STATUS.md`.

## Design direction

Audio is presentation, not gameplay authority. A small renderer-neutral policy
translates existing committed events and visible read models into audio
intentions. A Phaser adapter owns loading, playback, game mixing, unlocking,
and cleanup. `GameSimulation` does not know which sound plays,
whether audio is enabled, or how a cue is mixed.

The audio track has five milestones:

1. `AUD-1` established the stored sound library, runtime catalog, play-only
   asset workspace, mixer, unlock flow, controls, diagnostics, and lifecycle
   boundary.
2. `AUD-2` added ocean and vessel ambience driven by current presentation state.
3. `AUD-3` added bounded gameplay and interface cues from existing typed events.
4. `AUD-4` added two-state music and lifecycle transitions.
5. `AUD-5` produced the final sounds and music, overwrote the reference files
   at their stable runtime paths, completed browser acceptance, and closed
   production readiness.

This sequence produced useful sound without making the simulation depend
on audio. It keeps every content change replaceable through an ordinary file
overwrite and adds no repository tool for creating or modifying audio.

## Investigation findings

### Existing repository seams

- The project uses Phaser `3.90.0` and already preloads shared presentation
  assets from `WayfindersScene.preload()`.
- `GameEventMap` is a complete typed source for committed discovery, survey,
  return, wreck, succession, and completion events. These events are suitable
  for discrete cues and do not need a second event bus.
- `WayfindersScene.bindSimulationEvents()` already performs presentation-only
  adaptation and coalesces related return events. Audio can follow the same
  subscription and cleanup pattern without changing authoritative ordering.
- Continuous audio cannot come only from discrete events. Wake level, ocean
  ambience, and music state should consume current ship pose, current knowledge
  at the ship, expedition/lifecycle state, and existing return-risk read models.
  They must not query hidden terrain or create a second simulation state.
- The current authored-asset pipeline is intentionally PNG-, layer-, animation-,
  and collision-oriented. Adding audio fields to its V1 package contract would
  couple unrelated lifecycles. Audio therefore has one separate checked-in
  catalog and stable runtime files.
- Game, asset-library, and isolated-trial modes share one application shell.
  Game audio is loaded only in game mode. The asset library receives one
  play-only Audio workspace that loads only the selected stored audio file and never
  starts gameplay ambience or music state.

### Browser and Phaser constraints

Phaser's Sound Manager selects Web Audio when available and falls back to
HTML5 Audio. It is global to the Phaser game rather than scoped to a scene, so
looping instances must be stopped and destroyed explicitly on scene shutdown.
Phaser exposes a global mute and volume plus individual sound configuration; a
portable category mixer should therefore compute effective per-instance volume
rather than depend on custom Web Audio nodes. See the official
[Phaser audio concept](https://docs.phaser.io/phaser/concepts/audio) and
[Phaser 3.90 Sound Manager API](https://docs.phaser.io/api-documentation/3.90.0/class/sound-basesoundmanager).

Audible playback is normally blocked until the user interacts with the page.
The implementation must expose the locked state, use an explicit user action to
enable audio, and treat a failed locked play as a normal state rather than an
error or a cue to replay later. See the
[MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

Phaser accepts stored audio URLs and selects a supported media type. The fixed
library currently uses PCM WAV for the validated desktop-browser target. Every
final replacement must be decoded and loop-tested on those targets; changing
file format or adding alternate sources is a catalog-contract change rather
than an implicit content replacement. See the
[MDN audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs).

## Implemented extension seams

`ARCHITECTURE_MAP.md` is the canonical owner of current boundaries. The audio
track used the existing seams in these directions:

| Seam | Implemented use | Constraint |
| --- | --- | --- |
| Audio workspace | continue auditioning the shared stored files without production controls | no upload, creation, editing, mixing, metadata writes, or gameplay state |
| `public/assets/audio` | store final `AUD-5` bytes at existing paths | no gameplay data or browser-write API |
| `scripts/generate-audio-assets.mjs` | deterministically regenerate the complete shipped WAV set | no runtime dependency, interactive editor, upload, or catalog mutation |

```mermaid
flowchart LR
    SIM["GameSimulation events and read models"] --> POLICY["Audio cue policy and state selector"]
    UI["Game audio controls"] --> MIX["Renderer-neutral mixer state"]
    POLICY --> CTRL["Wayfinders audio controller"]
    MIX --> CTRL
    CAT["Validated audio catalog"] --> CTRL
    CAT --> PREVIEW["Play-only Audio asset workspace"]
    CTRL --> PHASER["Phaser Sound Manager"]
    PHASER --> VOICES["Music, ambience, SFX, and UI instances"]
```

Future audio work changes this ownership only through a coordinated architecture
decision.

## Runtime contract

This section summarizes implemented cue and continuous-audio behavior.
`Wayfinders_Technical_Design.md` remains the
canonical owner of current mixer, unlock, control, and lifecycle behavior.

### Audio categories

The mixer has four categories:

| Category | Content | Initial category gain | Initial voice limit |
| --- | --- | ---: | ---: |
| Music | score loops and lifecycle music transitions | `0.42` | `2` during a crossfade |
| Ambience | ocean bed and speed-controlled wake | `0.275` | `3` |
| SFX | discoveries, surveys, returns, wrecks, and completion accents | `0.10` | `8` |
| UI | confirm, cancel, toggle, and dialog actions | `0.60` | `2` |

Initial master gain is `0.80`. A sound's effective gain is:

```text
master gain × category gain × catalog base gain × transition gain
```

All values are presentation configuration, clamped to `[0, 1]`, and are owned
by `DEFAULT_GAME_SETTINGS.audio`, not the asset catalog or gameplay session
tuning. These numbers are a starting mix for acceptance, not loudness
certification.

The controller owns at most fifteen simultaneous voices across all categories.
When a category reaches its limit, policy rejects the newest low-priority cue
or replaces the oldest equal-or-lower-priority cue. It never creates an
unbounded pool. Music and ambience keep explicit long-lived instances; one-shot
helpers may self-destroy only after the controller has accounted for them.

### Unlock and user control

- Sound is on by default. When the browser reports the Sound Manager as locked,
  playback begins after the first interaction releases that lock.
- **Enable sound** remains an explicit fallback button in the game controls.
  Activating it attempts unlock. `AUD-2` and `AUD-4` reconcile their current
  ambience/music layers only after a successful unlock.
- Events that occurred while locked are not queued or replayed. After unlock,
  continuous layers reconcile to current state and the next eligible one-shot
  plays normally.
- Master mute plus independent music, ambience, SFX, and UI levels are exposed
  in the same screen-space control ownership as the existing game UI. Controls
  remain keyboard accessible and report exact values.
- Audio controls are in-memory for `AUD-1` through `AUD-5`. Cross-session
  preference persistence would be a separate explicit decision; it must not
  become an incidental gameplay-save seam.
- Sound is supplementary. Every discovery, danger, return, failure, and action
  remains readable through existing visual and semantic UI without audio.
- Blur uses Phaser's pause-on-blur behavior. Focus reconciliation resumes only
  current loops; it does not replay one-shots missed while the page was hidden.

### Discrete cue policy

Events emitted synchronously by one authoritative transaction are collected
until the current microtask boundary, then reduced by priority. This prevents a
survey that discovers an idol, or a return that also completes a tenure and the
game, from producing a pile-up of independent stings.

| Source | Default audio intention | Coalescing rule |
| --- | --- | --- |
| Direct accepted UI action | `ui.confirm`; `ui.cancel`; `ui.toggle` | At most one UI cue per action |
| `islandSighted`, `surveySiteSighted`, `fishingShoalSighted`, `wreckDiscovered` | `sfx.discovery` | Stable entity lifecycle already prevents repeated first-sighting spam; controller adds a short global cooldown |
| `islandDossierSurveyed`, `surveySiteSurveyed`, `fishingShoalSurveyed`, `wreckSurveyed` | `sfx.survey-complete` | Suppressed when a higher-priority idol discovery occurs in the same transaction |
| `idolLocationDiscovered` | high-priority `sfx.discovery` | Replaces ordinary discovery/survey cues in the same transaction without requiring another file |
| `expeditionReturned` | `sfx.dock-return` | Returned feature-record events do not each play another cue |
| `shipReplenished` with reason `dock` | `sfx.dock-return` | Used only when no expedition return already owns the transaction |
| `navigatorTenureCompleted` | succession accent in `AUD-4` | Layers with or replaces ordinary return according to music priority |
| `gameCompleted` | final-location completion transition in `AUD-4` | Highest return-transaction priority |
| `shipWrecked` | `sfx.wreck` | `expeditionFailed` does not play a second failure cue |
| `provisionConsumed`, `shipEnteredTile`, `knowledgeChanged`, `returnStateChanged` | no one-shot | High-rate state informs visuals or continuous audio only |
| `shipTeleported`, `worldRegenerated` | no celebratory cue | Reconcile or stop loops; developer actions are not gameplay achievements |

Each one-shot family declares priority, cooldown, maximum simultaneous voices,
and whether a newer cue replaces or rejects. The pure cue-policy tests use
ordered event batches and a fake clock; no test needs to decode audio.

### Continuous ambience

The ocean bed is a low, non-positional loop. The wake loop is multiplied by a
smoothed normalized absolute ship speed and reaches silence at rest. Direction
changes must not restart it. The first implementation does not add surf emitters
to every island, wind simulation, weather, occlusion, or positional landmark
audio.

Continuous state may use only information already available to presentation:
current ship pose and speed, current tile, current visibility/knowledge at the
ship, exact-dock/lifecycle gates, and published risk/read-model state. It must
not sample an unseen island, inspect hidden blockers, scan the world, or infer a
route. Audio can reinforce current knowledge but cannot reveal future terrain.

Updates perform no allocation in a stable frame. The controller changes a gain
only when its target differs by a declared epsilon and advances fades on the
scene clock. Scene shutdown stops loops, removes Sound Manager listeners, and
destroys owned sound instances even though the manager itself is global.

### Music state

The implemented selector has two score states:

- **Home harbor** for the exact dock, home interaction, and quiet Supported
  water near the start of a voyage; and
- **Open water** while an expedition is active outside Supported water.

The selector publishes a small state ID only when its inputs change. It does
not expose exact simulation data to the music adapter. State changes crossfade
over `1.5` seconds by default. Re-entering the same state keeps the current
loop; it never restarts on a stable frame.

Wreck, succession, exact return, and game completion temporarily duck music
behind their high-priority cue, then reconcile to current state. A separate
danger track, generative score, beat-synchronized stems, or music based on
unseen discovery proximity is out of scope until playtesting justifies it.

## Asset contract dependency

The canonical current stored-library, metadata, replacement, validation-budget,
and play-only workspace contract is in `Wayfinders_Asset_Pipeline.md`. Remaining
milestones preserve the stable runtime IDs and paths. `AUD-5` replaces the
reference WAV bytes in place; it does not add a second production directory or
require a loader change. Cue priority, cooldown, transaction coalescing,
continuous-state selection, and music transitions remain presentation policy,
not catalog metadata.

## Milestones

### AUD-1 — Audio foundation, unlock, and controls

Implemented and accepted on 2026-07-20. Current behavior and ownership are
documented by the technical design, architecture map, and asset-pipeline guide.

### AUD-2 — Sailing ambience

Implemented and accepted on 2026-07-20. Current smoothing, hysteresis, input,
lifecycle, diagnostic, and voice-bound behavior is owned by the technical
design.

### AUD-3 — Gameplay and interface cues

Implemented and accepted on 2026-07-20. Current cue
behavior and ownership are documented by the technical design and architecture
map. Contract coverage includes every source row, deterministic fake-clock
cooldowns and caps, idol-survey coalescing, ordinary survey, return, wreck,
high-rate silence, blocked-audio discard, bounded diagnostics, and teardown.

### AUD-4 — Adaptive music and lifecycle transitions

Implemented and accepted on 2026-07-20. Current selection,
crossfade, ducking, lifecycle, diagnostic, and two-voice behavior is owned by
the technical design. Focused contracts cover dock, Supported departure,
expedition start, return, wreck hold, handover, completion, Continue, Start New
Game, stable frames, rapid reversals, completion priority, focus reconciliation,
and teardown.

### AUD-5 — Production audio and closure

Delivered:

- final, product-ready music, ambience, sound-effect, and UI WAV files for every
  catalog entry;
- replacement of the reference WAVs at the existing `public/assets/audio/v1`
  paths without changing runtime IDs, paths, categories, or loader code;
- product-owner audition and approval through the play-only Audio workspace;
- read-only catalog/file validation in the full repository gate;
- final default game mix, category ranges, stored-library budget, and browser
  acceptance records; and
- current-state updates to the architecture map and technical design plus
  durable acceptance evidence in the roadmap archive.

Implemented on 2026-07-17 and accepted on 2026-07-20. The final eleven-file PCM
set occupies the established catalog paths. The retained deterministic renderer
and its operator workflow are owned by `Wayfinders_Asset_Pipeline.md` and
`ASSET_PRODUCTION_QUICKSTART.md`.

Acceptance gate:

- Every catalog entry resolves to its final stored WAV at the already-integrated
  path, and both the Audio workspace and game decode the same bytes.
- Replacing each reference file requires no TypeScript, JSON, or loader change.
- Missing, corrupt, unsupported, or undecodable files fail gracefully to a
  no-audio state without blocking gameplay startup.
- Stored size, load, decode, active-voice, stable-frame, and teardown
  measurements meet the declared budgets on validated desktop-browser targets.
- Default and maximum control mixes do not clip during the worst accepted cue,
  ambience, and music overlap.
- Music and ambience loop seamlessly for ten consecutive repetitions; every
  one-shot starts responsively and ends without an audible cut.
- The deterministic complete-set renderer remains reproducible from the
  repository, while the Audio workspace remains play-only and no interactive
  editor, mixer, upload surface, or browser repository-write API is added.
- Keyboard and screen-reader acceptance confirms controls and all reinforced
  information remain usable with sound disabled.
- `npm.cmd run check`, browser acceptance, and a final repository diff/status
  review pass before the milestone is archived.

## Product decisions and deferred follow-up

1. The restrained palette represented by wooden percussion, soft bells, low
   pads, and abstract surf is accepted.
2. A separate risk or danger music layer remains a future product decision;
   current audio does not infer danger from hidden world state.
3. Decide separately whether audio preferences may persist across refresh.
   The implemented foundation keeps them in memory to avoid expanding the
   current persistence boundary incidentally.

## Explicitly deferred scope

- spoken narration, voice acting, and localization-specific audio;
- weather simulation, dynamic wind, and per-island surf emitters;
- HRTF or general positional-audio infrastructure;
- audio-driven gameplay timing or rhythm mechanics;
- interactive repository tooling for recording, waveform editing, trimming,
  mixing, encoding, or DAW integration beyond the retained deterministic
  complete-set renderer;
- runtime-generative music, middleware, or a universal asset-pipeline rewrite;
- preference persistence or any gameplay save/load behavior; and
- asset-library upload, metadata editing, review, promotion, or repository
  replacement operations for audio.
