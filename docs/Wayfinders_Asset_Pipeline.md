# Wayfinders Milestone 5 asset direction

Status: planned, not implemented.

This document records only the constraints needed to begin production asset
work. It does not claim that an asset workshop, manifest generator or asset
build commands already exist.

## Goal

Replace developer art incrementally while preserving the completed exploration,
navigation, discovery, persistence and performance foundation.

Production art must improve readability and atmosphere without becoming a new
source of gameplay truth.

## Foundation contracts

Asset work must preserve:

- the `32`-pixel navigation grid;
- terrain-authoritative movement and sight blocking;
- stable island and discovery IDs;
- deterministic seed behavior;
- current fog and overlay readability;
- ship origin/heading behavior;
- runtime wreck and discovery marker distinction;
- save compatibility;
- camera-culling and dirty-chunk performance.

Rendered pixels are never read back to determine collision, navigation,
knowledge, resources or discovery state.

## Semantic asset identity

Gameplay should request semantic IDs rather than filenames. A future resolver
maps those IDs to developer, candidate or approved visuals.

Recommended ID shape:

```text
<theme>.<family>.<name>.<variant>
```

Examples:

```text
home_waters.terrain.ocean_deep.01
home_waters.structure.dock_small.01
home_waters.vessel.player_explorer.01
shared.discovery.resource.01
shared.effect.missing_asset.01
```

An ID remains stable when its visual is replaced. If footprint, origin,
animation contract or semantic meaning changes incompatibly, create a new ID
instead of repurposing the old one.

## Asset lifecycle

Use four explicit states:

- `developer`: current functional placeholder;
- `candidate`: production-intent art under in-game review;
- `approved`: accepted for the active theme and scale;
- `deprecated`: retained only while references or migrations still require it.

The first implementation may use a hand-authored JSON manifest. Typed ID
generation, atlas packing and a dedicated workshop should be added only when
the initial asset family proves the contracts useful.

## Proposed source and runtime layout

This layout is a Milestone 5 proposal; create it only as the corresponding
pipeline is implemented.

```text
assets-src/
  concepts/
  shared/
  themes/
    home_waters/
      terrain/
      structures/
      vessels/
      discoveries/

public/assets/
  images/
  atlases/
  manifests/

asset runtime module/
  asset IDs
  manifest types
  loader
  resolver
  factories
```

Concept art remains reference material and is not loaded at runtime.

## Island presentation strategy

The current procedural generator remains the authority for island descriptors,
terrain, collision, sight blocking, placement and save identity.

Production presentation should use a hybrid approach:

- authored composition for the home island and other major landmarks;
- semantic terrain/decoration families for deterministic non-home islands;
- lightweight procedural variants for small islets, reefs, rocks, sandbars,
  fishing grounds and offshore detail;
- dynamic objects kept separate from static terrain art.

An authored island image or prefab is acceptable only when it supplies masks
and anchors aligned with the authoritative navigation grid. It must not replace
the saved/generated island ID or cause rendered pixels to define gameplay.

Dynamic content remains separate from static island art:

- ships and people;
- smoke, flags, foam and waves;
- runtime player wrecks;
- discovery markers;
- resources and settlement changes;
- fog and voyage overlays.

This separation allows the living world to change without rebuilding a whole
island image.

## Deterministic variation

Visual variants must be selected from stable semantic data, for example:

```text
world seed + island ID + tile + object type + variation slot
```

Adding or replacing a visual variant must not change terrain topology,
discovery identity or navigation. Resolver changes that would reshuffle an
existing saved world's visuals require an explicit content-version decision.

## First implementation slice

Build the smallest end-to-end asset path:

1. Define semantic IDs and origin/footprint contracts for the player ship,
   dock, ocean and one representative island family.
2. Add a minimal manifest, loader and resolver.
3. Render developer and candidate assets through the same factory.
4. Review them at normal camera zoom under fog, Personal-grey and risk overlays.
5. Confirm no gameplay arrays or saves change when visuals are swapped.
6. Measure draw calls, texture memory and frame timing before expanding the
   asset set.

Do not begin by building a large workshop or automated atlas pipeline. Add
those tools after repeated manual work demonstrates which automation is needed.

## Future workshop requirements

If a dedicated asset workshop is justified, it should use the same Phaser
renderer, camera, runtime asset factories and rendering/texture paths as the
game. Useful views are:

- asset browser by ID, theme, family and lifecycle state;
- ship heading/animation preview at expected zoom levels;
- terrain adjacency and island-composition preview;
- deterministic placement preview from fixed seeds;
- overlay/fog contrast preview;
- origin, footprint and metadata validation.

The workshop is not a parallel renderer and must not invent separate gameplay
placement rules.

## Performance and loading

- Keep native-resolution pixel art and scale it in Phaser.
- Prefer shared atlases only when they reduce real texture switches.
- Keep atlas dimensions within broadly supported browser limits.
- Load core home/ship assets at boot; load later theme content when needed.
- Preserve camera culling for static world chunks.
- Reuse animation and factory definitions across variants.
- Avoid one large unique texture for every procedural island.
- Keep environmental particle counts configurable.

## Approval checklist

An asset family is ready only when:

- semantic IDs and lifecycle states are clear;
- source and runtime files are tracked together;
- scale, origin and draw offsets are correct;
- navigation footprint matches authoritative gameplay data;
- required animation names and headings exist;
- the art is readable under fog and voyage overlays;
- deterministic variants remain stable;
- save data and generated terrain are unchanged by visual replacement;
- default-world performance does not regress;
- the result has been reviewed in the running game.
