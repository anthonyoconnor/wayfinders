# Wayfinders Asset Pipeline

## 1. Purpose

This document defines how visual assets move from source artwork into the Phaser game. It covers developer art, production art, metadata, validation, loading, the Asset Workshop, procedural-world integration, and replacement of placeholders.

The pipeline is designed around four requirements:

1. Assets are integrated continuously rather than in one large pass.
2. Gameplay refers to stable semantic asset IDs rather than filenames.
3. Procedural generation selects semantic content; an asset resolver chooses the visual representation.
4. The Asset Workshop uses the same Phaser renderer, shaders, animations, and game-object factories as the main game.

---

## 2. Runtime Decisions

- Runtime image format: PNG with alpha.
- Pixel-art source format: Aseprite source files.
- Sprite animation export: PNG sprite sheet plus JSON frame data.
- Runtime metadata: JSON.
- Runtime loading: Phaser asset loader.
- Pixel sampling: nearest-neighbor.
- Asset indexing: generated manifest.
- Asset IDs: stable dot-separated strings.
- Production atlases: grouped by theme and asset family.
- Maximum atlas dimension: 2048 × 2048 pixels.

Concept art is reference material only and is never loaded by the game runtime.

---

## 3. Folder Structure

```text
assets-src/
  concepts/
  shared/
    effects/
    debug/
  themes/
    home_waters/
      terrain/
      vegetation/
      structures/
      vessels/
      props/
      discoveries/
      effects/
  prefabs/
  metadata/

public/assets/
  atlases/
  tilesets/
  shaders/
  manifests/

src/tidebound/assets/
  AssetIds.ts
  AssetManifest.ts
  AssetLoader.ts
  AssetResolver.ts
  AssetValidator.ts
  AssetFactories.ts
  types.ts
```

Rules:

- Editable artwork lives only in `assets-src`.
- Phaser loads only files under `public/assets`.
- Generated runtime files are not edited by hand.
- Every production runtime asset has a corresponding source file and metadata record.

---

## 4. Asset IDs

Gameplay code must never refer to file paths.

Use IDs in this format:

```text
<theme>.<family>.<name>.<variant>
```

Examples:

```text
home_waters.terrain.ocean_deep.01
home_waters.terrain.shore_outer_ne.01
home_waters.vegetation.palm_tall.02
home_waters.structure.dock_small.01
home_waters.vessel.player_explorer.01
shared.effect.missing_asset.01
```

An asset ID remains stable when developer art is replaced by production art.

Use constants generated from the manifest:

```ts
AssetIds.homeWaters.vessel.playerExplorer
```

Do not duplicate literal asset ID strings throughout gameplay code.

---

## 5. Asset Lifecycle

Every asset has one status:

```ts
type AssetStatus =
  | "developer"
  | "candidate"
  | "approved"
  | "deprecated";
```

### Developer

Temporary functional art used through Gameplay Milestone 3.

### Candidate

Production-intent art under workshop review.

### Approved

Validated for scale, style, metadata, animation, and in-game use.

### Deprecated

Retained temporarily for save compatibility or migration, but no longer selected for new content.

The manifest must expose status so the Asset Workshop can filter and report it.

---

## 6. Manifest Schema

Each runtime asset has one manifest entry.

```ts
interface AssetDefinition {
  id: string;
  status: AssetStatus;
  kind: "image" | "spritesheet" | "tileset" | "shader";
  theme: string;
  family: string;
  runtimePath: string;
  sourcePath: string;
  pixelWidth: number;
  pixelHeight: number;
  originX: number;
  originY: number;
  drawOffsetX: number;
  drawOffsetY: number;
  navigationFootprint: { width: number; height: number };
  tags: string[];
  placement?: PlacementMetadata;
  animationSet?: string;
  compatibilityGroup?: string;
}
```

Placement metadata:

```ts
interface PlacementMetadata {
  allowedTerrain: string[];
  allowedThemes: string[];
  minimumSpacingTiles: number;
  edgeClearanceTiles: number;
  densityWeight: number;
  rotationMode: "fixed" | "cardinal" | "sixteen_heading";
}
```

Animation definitions are stored separately so multiple visual variants can share one animation contract.

---

## 7. Animation Contracts

Animation IDs are semantic and stable.

Examples:

```text
player_ship.idle
player_ship.sail
player_ship.turn
player_ship.low_provisions
wake.normal
wake.fast
```

Animation metadata:

```ts
interface AnimationDefinition {
  id: string;
  sourceAssetId: string;
  frames: number[];
  framesPerSecond: number;
  repeat: number;
  yoyo: boolean;
}
```

Logical ship heading is continuous. Production ship rendering uses sixteen authored heading frames. The renderer selects the nearest heading frame while movement remains continuous.

The Asset Workshop must display every animation at 1×, 2×, and expected in-game zoom.

---

## 8. Build Commands

The project exposes these commands:

```text
npm run assets:build
npm run assets:validate
npm run assets:workshop
```

### `assets:build`

1. Exports Aseprite source files to PNG and JSON.
2. Packs approved sprites into theme/family atlases.
3. Copies tilesets and shaders.
4. Generates `manifest.json`.
5. Generates typed `AssetIds.ts`.
6. Writes a content hash for browser cache invalidation.

### `assets:validate`

Checks:

- duplicate asset IDs;
- missing source or runtime files;
- invalid dimensions;
- non-integer origins or offsets where forbidden;
- missing animation frames;
- incompatible tile sizes;
- assets without a theme or family;
- deprecated assets still selected by resolvers;
- missing auto-tile combinations;
- placement metadata that references unknown terrain or themes.

The build fails on validation errors.

### `assets:workshop`

Launches the Phaser application directly into `AssetWorkshopScene`.

---

## 9. Integration Workflow

Every asset family follows this sequence.

### Step 1 — Define the contract

Before artwork, define:

- stable asset ID;
- visual footprint;
- navigation footprint;
- origin and draw offset;
- animation names;
- theme and compatibility group;
- placement rules;
- required variants.

### Step 2 — Add developer art

Create the simplest possible asset that satisfies the contract.

### Step 3 — Integrate immediately

Add it to the manifest, load it in the Asset Workshop, and use it in the relevant game scene.

### Step 4 — Validate gameplay assumptions

Confirm scale, camera readability, collision relationship, animation timing, and overlay contrast.

### Step 5 — Lock the contract

After the Gameplay Milestone 3 review gate, freeze tile sizes, pivots, footprints, naming, and animation definitions.

### Step 6 — Replace with production art

The approved artwork replaces the developer runtime files behind the same asset IDs.

### Step 7 — Review in context

Approve the asset only after it passes:

- isolated workshop preview;
- theme-composition preview;
- procedural-placement preview;
- main-game camera preview.

---

## 10. Asset Workshop

The workshop is a Phaser scene in the same application.

It shares:

- the production asset loader;
- the production shaders;
- game-object factories;
- animation definitions;
- camera code;
- tile rendering;
- world depth sorting.

Required workshop modes:

### Asset Browser

- browse by theme, family, status, and tag;
- search by asset ID;
- show metadata and validation state;
- display source and runtime dimensions.

### Sprite and Animation Preview

- play, pause, and scrub animations;
- show frame index and origin;
- show the 32-pixel navigation tile beneath the object;
- rotate vessels through sixteen headings;
- toggle wake, cargo, and overlay context.

### Tile and Auto-Tile Preview

- render every adjacency mask;
- randomize a test terrain patch;
- highlight missing combinations;
- show grid and tile IDs;
- test coastline, cliff, reef, and path transitions.

### Theme Composition Preview

- render terrain, vegetation, buildings, props, and vessels from one theme together;
- randomize deterministic variants;
- check scale, palette, lighting, and texture density.

### Procedural Placement Preview

- generate a small island from a fixed seed;
- show semantic world data;
- show selected asset IDs;
- regenerate with different seeds;
- flag invalid placement.

---

## 11. Procedural Integration

The procedural generator does not place images. It outputs semantic records.

Example:

```ts
interface GeneratedObjectIntent {
  type: "tree" | "rock" | "dock" | "building" | "wreck";
  theme: string;
  subtype: string;
  tileX: number;
  tileY: number;
  orientation: number;
  variationSeed: number;
}
```

The asset resolver converts an intent into an approved asset ID.

```ts
const assetId = assetResolver.resolveObject(intent);
```

Resolution rules:

1. Match the requested theme.
2. Match family and subtype.
3. Reject assets whose placement metadata is invalid.
4. Restrict candidates to one compatibility group.
5. Select a weighted variant with a deterministic hash.
6. Fall back to the theme’s explicit fallback asset.
7. Use the shared missing-asset sprite only when validation failed.

Variant selection:

```ts
variantIndex = stableHash(
  worldSeed,
  intent.tileX,
  intent.tileY,
  intent.variationSeed,
  intent.type
) % candidateCount;
```

The same world seed always resolves to the same visual variant.

---

## 12. Theme Packs and Compatibility

The generator selects one primary theme for an island or region. The resolver may select only assets from:

- that primary theme;
- the shared asset pack;
- the approved transition pack between adjacent themes.

It may not freely mix assets from unrelated themes.

Each theme pack contains:

- terrain;
- shoreline and cliffs;
- vegetation;
- rocks and props;
- structures;
- vessels where culturally relevant;
- discovery variants;
- environmental effects;
- explicit fallback assets.

A `compatibilityGroup` identifies assets authored to appear side by side.

---

## 13. Auto-Tiling

Auto-tiling uses a four-neighbor bitmask for core terrain edges.

```ts
const mask =
  (northMatches ? 1 : 0) |
  (eastMatches ? 2 : 0) |
  (southMatches ? 4 : 0) |
  (westMatches ? 8 : 0);
```

Corner overlays use diagonal-neighbor data in a second pass.

Each auto-tile family must provide:

- all sixteen cardinal masks;
- required inner-corner overlays;
- required outer-corner overlays;
- end-cap variants where the terrain permits narrow features;
- at least two approved visual variants for common straight and full-center tiles after the production gate.

Variation never changes topology. It changes texture detail only.

---

## 14. Prefabs

Complex authored arrangements are stored as semantic prefabs.

Examples:

```text
home_harbour.small.01
fishing_camp.small.01
anchorage.cache.01
wreck_site.wooden.01
settlement.island_small.01
```

A prefab contains:

- footprint;
- placement rules;
- semantic object intents;
- navigation changes;
- interaction anchors;
- optional required terrain pattern.

Prefab files refer to semantic asset queries or stable asset IDs. They never embed image data.

The home island uses an authored semantic prefab with deterministic decorative variation.

---

## 15. Loading Strategy

At boot, load:

- shared debug and fallback assets;
- the Home Waters core atlas;
- UI-independent shaders;
- player-vessel animations.

Load discovery and living-world atlases by theme when the corresponding region becomes active.

Do not load every future theme at startup.

Asset bundles are versioned by content hash so browser caches update correctly.

---

## 16. Replacement and Migration

A production asset can replace developer art without gameplay changes when these remain unchanged:

- asset ID;
- navigation footprint;
- origin contract;
- required animation IDs;
- placement metadata semantics.

If one of those contracts changes, create a new asset ID and deprecate the old one.

Do not silently repurpose an existing ID for an incompatible object.

---

## 17. Version Control Rules

- Commit source and generated runtime files together.
- Do not commit temporary exports.
- Keep concept art outside runtime directories.
- Review manifest changes like code changes.
- Each asset change includes a workshop screenshot or recorded validation result in the pull request.
- Do not rename approved asset IDs without a migration.

---

## 18. Performance Rules

- Keep runtime pixel art at native resolution; scale in Phaser.
- Use atlases to reduce texture switches.
- Keep theme/family atlases at or below 2048 × 2048.
- Reuse animations and metadata across variants.
- Avoid large unique island images for procedural terrain.
- Use tile families and prefabs instead.
- Load only themes needed by active chunks.
- Keep decorative particle counts configurable.

---

## 19. Asset Approval Checklist

An asset is approved only when:

- its asset ID is valid and stable;
- source and runtime files are present;
- metadata validates;
- origin and draw offset are correct;
- navigation footprint is correct;
- animation names and frame timing are correct;
- it matches the theme palette, lighting, scale, and perspective;
- it works beside every required neighboring asset;
- it displays correctly at the expected camera zoom;
- it remains readable under fog and overlays;
- it passes the theme-composition preview;
- it passes the procedural-placement preview;
- it causes no asset-validation errors.
