# Wayfinders Browser Prototype — Technical Design Document

## World in Brief

The world once had larger landmasses, but tectonic subsidence, rising seas, and volcanic fragmentation left a planet of scattered islands and reefs. Humanity survived on these remnants, gradually mastering water collection, reef cultivation, boatbuilding, and local navigation.

For generations, most communities remained isolated within their home waters, developing distinct cultures and incomplete understandings of the ocean. A few navigators eventually began making uncertain open-water crossings, but routes were rarely dependable or widely shared.

The game begins at a turning point: successive explorers are starting to convert dangerous personal voyages into inherited knowledge, creating the first lasting connections between distant island communities.

### 0. Overall rules
The game must be automatically testable by AI through the browser. 
The user is not required to run it to prove it is working correctly.
Use best judgement for decisions and do not get blocked.
Track work that has been completed in a doc so it is not redone.
Use git approprately to save logical groupings of work.
At the end of each milestone all changes must be commited to git.
concept art is provided in ../concept_art and can be used for direction when necessary.
Minimal HUD should be used apart from developer tooling.
Add new documents if necessary to helo with future development.

## 1. Purpose

This document defines the implementation plan for the Wayfinders exploration prototype as a browser game built with Phaser and TypeScript. It assumes parts of an existing Phaser codebase will be reused where practical.

The prototype must prove this loop:

1. Leave supported water.
2. Reveal unknown water around the ship.
3. Create a broad personal-knowledge corridor.
4. Consume provisions at different rates by knowledge state.
5. Read forward travel range and return viability directly from world overlays.
6. Return to supported water.
7. Convert successfully returned personal knowledge into permanent supported water.

Systems outside this loop are excluded until the loop is playable and readable.

---

## 2. Fixed Technical Decisions

Use the following implementation decisions:

- Runtime: browser
- Framework: Phaser
- Language: TypeScript
- Renderer: Phaser WebGL
- Player Controls: Keyboard navigation (WASD for ship movement)
- Navigation grid: square grid
- Navigation tile size: 32 × 32 world pixels
- Art tile size: 16 × 16 pixels
- Navigation-to-art ratio: one navigation tile contains 2 × 2 art tiles
- Ship footprint: one navigation tile
- Ship sight radius: five navigation tiles
- World chunk size: 32 × 32 navigation tiles
- Unknown-water provision cost: 1 per navigation-tile distance
- Personal-water provision cost: 0.5 per navigation-tile distance
- Supported-water provision cost: 0
- Player movement: continuous visually, grid-sampled logically
- Fog and overlays: generated from grid masks and rendered through Phaser textures and WebGL shaders
- Pathfinding: Dijkstra search over the navigation grid
- Save format: versioned JSON plus compact typed-array data


---

## 3. Reuse Strategy for the Existing Phaser Project

review ..\..\Ship Game Prototype\docs\Reusable_Systems.md when needed to determine if parts can be copied and reused or need to be created from scratch. The full project is located at ..\..\Ship Game Prototype. 
Do not attempt to use anything in place. these are 2 separate projects and Ship Game Prototype should only be used to reduce development time by copying code into this project when sure it will save time.
---


## 3A. Prototype Configuration and Runtime Tuning

All gameplay tuning values must be defined in a single configuration module.

No gameplay system may hardcode prototype constants.

Example:

```ts
export const PrototypeConfig = {
  navigation: {
    tileSize: 32,
    sightRadius: 5,
    chunkSize: 32,
  },

  provisions: {
    startingBundles: 12,
    supportedCost: 0,
    personalCost: 0.5,
    unknownCost: 1,
  },

  returnRisk: {
    comfortable: 3,
    warning: 1,
    critical: 0,
  },

  overlays: {
    fogNoise: 0.18,
    fogBlend: 0.12,
    forwardOverlayOpacity: 0.18,
    returnOverlayOpacity: 0.35,
  },

  movement: {
    shipSpeed: 2.5,
    turnRate: 180,
  }
};
```

### Runtime tuning

The prototype must include a developer settings panel that allows live adjustment of gameplay values without recompiling.

The panel should expose at least:

- Sight radius
- Starting provisions
- Supported, Personal and Unknown movement costs
- Ship speed
- Return-risk thresholds
- Overlay opacity
- Fog transition width
- Fog noise strength

Changing a value should automatically invalidate and rebuild only the affected systems.

Examples:

- Sight radius → rebuild visibility and overlays.
- Movement costs → rebuild forward-range and return calculations.
- Return thresholds → reclassify overlay colours only.
- Shader values → update renderer uniforms only.

The following values must never appear as hardcoded literals outside the configuration module:

- Navigation tile size
- Sight radius
- Chunk size
- Provision costs
- Starting provisions
- Return-risk thresholds
- Ship movement speed
- Overlay opacity
- Fog parameters



## 3B. Developer Tools Architecture

The project shall be designed from the beginning to support multiple development scenes built on the same engine, renderer and simulation. These tools do not need to be implemented immediately, but the architecture must not prevent them.

### Principle

There is a single Wayfinders application with multiple Phaser scenes.

Example:

```text
BootScene
MainMenuScene
ExplorationScene
AssetWorkshopScene
ExplorationSandboxScene
```

All scenes share:

- Asset loading
- Rendering pipeline
- Shader pipeline
- Animation system
- Camera implementation
- Tile rendering
- World simulation interfaces

The only difference between scenes is the user interface and the systems they expose.

### Asset Workshop

The Asset Workshop is a dedicated scene for creating and validating assets without loading the game.

Planned capabilities:

- Browse assets by category
- Preview sprite sheets
- Preview animations
- Rotate ships through all supported headings
- Preview tile auto-tiling
- Zoom and pan
- Reload modified assets
- Validate asset metadata (pivot, footprint, animation definitions)

The workshop should instantiate the same game objects used by the main game wherever practical rather than displaying static images.

### Exploration Sandbox

The Exploration Sandbox is a dedicated scene for tuning gameplay systems.

Planned capabilities:

- Place the ship anywhere
- Paint Supported, Personal and Unknown water
- Adjust prototype configuration values
- View line of sight
- View forward exploration range
- View return viability
- Instantly regenerate test worlds

The sandbox uses the same simulation systems as the main game but presents them in an environment optimised for rapid iteration.

### Architectural Requirement

All gameplay systems must remain independent of Phaser scene logic so they can be reused unchanged by:

- ExplorationScene
- AssetWorkshopScene
- ExplorationSandboxScene

Future developer tools should consume the same simulation and rendering APIs as the game rather than implementing duplicate behaviour.


## 4. Project Structure

Add the following structure inside the existing source directory:

```text
src/
  tidebound/
    config/
      prototypeConfig.ts
    core/
      GameSimulation.ts
      SimulationClock.ts
      types.ts
    world/
      WorldGrid.ts
      WorldChunk.ts
      TileData.ts
      CoordinateSystem.ts
      WorldGenerator.ts
    exploration/
      KnowledgeSystem.ts
      VisibilitySystem.ts
      ProvisionSystem.ts
      ForwardRangeSystem.ts
      ReturnPathSystem.ts
      ExpeditionSystem.ts
    navigation/
      GridGraph.ts
      Dijkstra.ts
      PriorityQueue.ts
      MovementSystem.ts
    rendering/
      TideboundScene.ts
      WorldRenderer.ts
      ShipRenderer.ts
      OverlayRenderer.ts
      MaskTexture.ts
      shaders/
        fog.frag
        overlay.frag
    persistence/
      SaveGame.ts
      SaveSerializer.ts
      BrowserStorage.ts
    integration/
      ExistingGameBridge.ts
      PhaserInputAdapter.ts
      PhaserRenderAdapter.ts
    debug/
      DebugOverlay.ts
      GridInspector.ts
    tests/
      visibility.test.ts
      provisions.test.ts
      returnPath.test.ts
      expedition.test.ts
```

Keep existing project conventions where they differ only in naming or folder organization.

---

## 5. Coordinate Systems

Use three coordinate systems.

### 5.1 Navigation coordinates

Integer tile coordinates:

```ts
interface GridPoint {
  x: number;
  y: number;
}
```

### 5.2 World coordinates

Phaser world-space pixels:

```ts
worldX = gridX * 32 + 16;
worldY = gridY * 32 + 16;
```

### 5.3 Art-tile coordinates

```ts
artX = gridX * 2;
artY = gridY * 2;
```

Centralize conversion functions:

```ts
export const NAV_TILE_SIZE = 32;
export const ART_TILE_SIZE = 16;

export function gridToWorld(p: GridPoint): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(
    p.x * NAV_TILE_SIZE + NAV_TILE_SIZE / 2,
    p.y * NAV_TILE_SIZE + NAV_TILE_SIZE / 2
  );
}

export function worldToGrid(x: number, y: number): GridPoint {
  return {
    x: Math.floor(x / NAV_TILE_SIZE),
    y: Math.floor(y / NAV_TILE_SIZE),
  };
}
```

Only the Phaser integration layer may return Phaser types. The core simulation should return plain numeric structures.

---

## 6. Tile Data Model

Use compact numeric enums.

```ts
export const enum TerrainType {
  DeepOcean = 0,
  ShallowOcean = 1,
  Reef = 2,
  Rock = 3,
  Land = 4,
}

export const enum KnowledgeState {
  Unknown = 0,
  Personal = 1,
  Supported = 2,
}
```

Store chunk tile data in typed arrays rather than one JavaScript object per tile.

```ts
export interface ChunkData {
  terrain: Uint8Array;
  knowledge: Uint8Array;
  visibleNow: Uint8Array;
  movementBlocked: Uint8Array;
  sightBlocked: Uint8Array;
  expeditionStamp: Uint32Array;
  islandId: Int32Array;
  resourceId: Int32Array;
}
```

Tile index:

```ts
index = localY * CHUNK_SIZE + localX;
```

Use `expeditionStamp` to identify which personal tiles belong to the current expedition. This allows failed-expedition knowledge to be reverted without scanning historical expedition data.

---

## 7. Chunking

Each chunk contains:

```ts
const CHUNK_SIZE = 32;
const TILES_PER_CHUNK = 1024;
```

Chunk key:

```ts
`${chunkX},${chunkY}`
```

Maintain three chunk states:

- Loaded: tile data exists in memory
- Active: simulation updates are allowed
- Visible: rendering objects are present

Keep active:

- the ship’s current chunk;
- the eight adjacent chunks;
- chunks touched by the current expedition;
- chunks needed by the current return calculation.

Unload distant, unchanged generated chunks. Persist modified chunks before unloading.

---

## 8. World Generation

For the prototype, use a deterministic seed and a hand-authored or semi-authored starting region.

The starting world must contain:

- one home island;
- supported water around the home island;
- an uneven gray-to-black boundary;
- open unknown water beyond the boundary;
- at least one hidden island;
- at least one hidden resource location;
- navigable sea routes wide enough for the five-tile visibility radius.

Generation sequence:

1. Fill the world with deep ocean.
2. Place the home island.
3. Add shallow-water and reef bands.
4. Mark land and blocking terrain.
5. Mark the starting supported-water mask.
6. Distort the supported boundary with seeded low-frequency noise.
7. Place hidden discoveries outside supported water.
8. Create visual decoration from the resulting terrain.

The supported boundary is gameplay data, not a rendered gradient. Rendering derives the gradient from it.

---

## 9. Phaser Scene Design

Use one main exploration scene:

```ts
export class TideboundScene extends Phaser.Scene {
  private simulation!: GameSimulation;
  private worldRenderer!: WorldRenderer;
  private overlayRenderer!: OverlayRenderer;
  private shipRenderer!: ShipRenderer;

  create(): void;
  update(time: number, delta: number): void;
}
```

Scene responsibilities:

- receive Phaser lifecycle events;
- read input;
- advance the simulation;
- synchronize render objects;
- update camera;
- display development diagnostics.

The scene must not contain exploration rules, pathfinding rules, or provision calculations.

---

## 10. Simulation Clock

Use a fixed simulation step.

```ts
const FIXED_STEP_MS = 1000 / 30;
```

Accumulate frame delta and run the simulation at 30 updates per second.

```ts
accumulator += Math.min(delta, 100);

while (accumulator >= FIXED_STEP_MS) {
  simulation.update(FIXED_STEP_MS / 1000, input);
  accumulator -= FIXED_STEP_MS;
}
```

Render every Phaser frame using interpolated state.

This keeps provision use, movement and discovery independent of frame rate.

---

## 11. Ship Movement

The ship has continuous world position and one logical navigation tile.

```ts
interface ShipState {
  worldX: number;
  worldY: number;
  heading: number;
  speed: number;
  currentTileX: number;
  currentTileY: number;
  provisions: number;
  provisionAccumulator: number;
}
```

Movement process:

1. Read steering input.
2. Update heading.
3. Calculate proposed world-space movement.
4. Test the navigation tiles touched by the ship centre.
5. Reject movement into blocked tiles.
6. Apply movement.
7. Detect navigation-tile transitions.
8. Trigger exploration updates on tile transition.
9. Accumulate provision cost from actual world distance.

The ship sprite may be larger than 32 × 32 pixels. Collision and simulation use only its centre tile in the prototype.

Do not snap the sprite to tile centres.

---

## 12. Visibility System

Use a precomputed circular set of offsets for a radius of five tiles.

```ts
interface VisibilityOffset {
  dx: number;
  dy: number;
  distanceSquared: number;
}
```

On entering a new navigation tile:

1. Clear the previous `visibleNow` set.
2. For every radius offset:
   - find the target tile;
   - perform grid line-of-sight;
   - mark the tile visible when unobstructed.
3. Convert visible Unknown tiles to Personal.
4. Stamp converted tiles with the current expedition ID.
5. Mark affected chunks dirty for mask regeneration.

Use Bresenham grid traversal for line-of-sight.

Ocean does not block sight. Land, tall cliffs and designated weather obstacles may block sight.

The currently visible five-tile area is always rendered in full colour, including newly revealed unknown water.

---

## 13. Personal Trail

Do not maintain a separate line or path geometry.

The personal trail is the connected collection of tiles whose knowledge state is Personal.

Movement creates the corridor through overlapping visibility discs.

When diagonal or curved movement leaves visual gaps, fill them by applying visibility at every crossed navigation tile using grid traversal between the previous and current tile.

---

## 14. Provision System

Store provisions as an integer number of physical bundles plus a fractional travel accumulator.

```ts
const COST_SUPPORTED = 0;
const COST_PERSONAL = 0.5;
const COST_UNKNOWN = 1;
```

For every movement segment:

1. Determine the knowledge state at the segment midpoint.
2. Convert pixel distance to navigation-tile distance.
3. Multiply by the state cost.
4. Add to `provisionAccumulator`.
5. Remove a physical provision bundle each time the accumulator reaches one.

```ts
tileDistance = pixelDistance / NAV_TILE_SIZE;
cost = tileDistance * knowledgeCost;
```

```ts
while (ship.provisionAccumulator >= 1 && ship.provisions > 0) {
  ship.provisionAccumulator -= 1;
  ship.provisions -= 1;
  events.emit("provisionConsumed");
}
```

Supported travel does not increase the accumulator.

Entering visible water that was Unknown at the start of the movement segment is charged at Unknown cost. Retracing it later is charged at Personal cost.

---

## 15. Expedition State

```ts
interface ExpeditionState {
  id: number;
  active: boolean;
  departedHome: boolean;
  personalTileCount: number;
  discoveries: DiscoveryRecord[];
}
```

Start an expedition when the ship leaves Supported water.

Complete it when the ship re-enters a designated home-return tile or dock.

On successful return:

1. Find all tiles stamped with the current expedition ID.
2. Convert Personal to Supported.
3. Clear their expedition stamps.
4. Commit discoveries.
5. Increment expedition ID.
6. Recalculate overlays.

On expedition failure:

1. Find all tiles stamped with the current expedition ID.
2. Convert Personal to Unknown.
3. Clear visibility.
4. Remove unreturned discoveries.
5. Reset the ship at home.
6. Increment expedition ID.

---

## 16. Forward Exploration Range

The forward overlay answers:

> Which currently unknown cells can the ship reach with the provisions it has now?

Run a cost-limited Dijkstra search from the ship’s current tile.

Traversal cost:

```ts
Supported = 0
Personal = 0.5
Unknown = 1
```

Include terrain movement modifiers only when the terrain is currently known. Unknown cells use the constant Unknown cost and reveal no terrain information.

Stop expanding when accumulated cost exceeds:

```ts
ship.provisions + (1 - ship.provisionAccumulator)
```

Output one mask value per tile:

```ts
0 = not displayed
1 = reachable unknown
```

Display only Unknown cells.

Do not display direction, safety level, terrain or discoveries.

Recalculate when:

- the ship enters a tile;
- provisions change;
- knowledge changes;
- a blocking tile changes.

---

## 17. Return Cost Calculation

The return calculation answers:

> What is the cheapest currently known cost from each Personal tile to any Supported tile?

Run multi-source Dijkstra:

1. Add all relevant Supported boundary tiles to the priority queue with cost zero.
2. Traverse Supported and Personal tiles.
3. Exclude Unknown tiles.
4. Store the cheapest return cost for each visited tile.
5. Store a parent direction for optional path reconstruction.

Traversal costs:

```ts
Supported = 0
Personal = 0.5
Unknown = blocked
```

To avoid zero-cost cycles causing unnecessary processing, mark a Supported region as one connected zero-cost component and seed only its boundary cells.

For the prototype, calculate over the connected explored region containing the ship and nearby Supported water.

---

## 18. Return Margin and Colours

For each Personal tile:

```ts
returnMargin =
  availableProvisionUnits - returnCost[tile];
```

Available provision units:

```ts
ship.provisions + (1 - ship.provisionAccumulator)
```

Use these fixed thresholds:

```ts
returnMargin >= 3.0  => gray
returnMargin >= 1.0  => yellow
returnMargin >= 0.0  => orange
returnMargin < 0.0   => red
```

Red means the tile cannot currently reach Supported water through known water with the remaining provisions.

It does not assert that no undiscovered alternative exists.

Apply these colours only to Personal tiles.

Do not colour Unknown or Supported water.

---

## 19. Mask Textures

Create one mask texture for each system:

- knowledge mask;
- current visibility mask;
- forward range mask;
- return-risk mask.

Create masks at navigation-grid resolution for each active chunk.

Use `Phaser.Textures.CanvasTexture` or a WebGL texture update path supported by the installed Phaser version.

Mask channel values:

### Knowledge mask

```text
0   Supported
140 Personal
255 Unknown
```

### Visibility mask

```text
0   not currently visible
255 currently visible
```

### Forward range mask

```text
0   outside range
255 reachable Unknown
```

### Return mask

```text
0   none
64  gray
128 yellow
192 orange
255 red
```

Update only dirty chunks.

Do not recreate texture objects every update. Reuse textures and replace pixel data.

---

## 20. Overlay Rendering

Render overlays using full-chunk quads aligned with world coordinates.

Rendering order:

1. base ocean;
2. terrain;
3. world objects;
4. knowledge/fog treatment;
5. current-visibility clearing;
6. forward-range overlay;
7. return-risk overlay;
8. ship;
9. wake and particles;
10. optional accessibility treatment.

The ship renders above overlays so it remains readable.

### Knowledge treatment

- Supported: unmodified base scene
- Personal: desaturated and slightly darkened
- Unknown: near-black opaque fog

### Current visibility

The visibility mask removes both Unknown fog and Personal desaturation in the five-tile sight area.

### Forward range

Render a neutral low-opacity texture over Unknown fog. Do not reveal the base scene.

### Return risk

Tint only Personal water according to the mask.

---

## 21. Shader Requirements

Use world-space UVs so effects do not move when the camera moves.

Apply:

- bilinear mask sampling;
- `smoothstep` around mask thresholds;
- two-octave low-frequency noise to boundary coordinates;
- subtle animated fine noise for water-like movement.

Noise distortion must remain small enough that an overlay never implies reachability more than approximately half a navigation tile beyond the calculated mask.

Shader inputs:

```glsl
uniform sampler2D uKnowledgeMask;
uniform sampler2D uVisibilityMask;
uniform sampler2D uForwardMask;
uniform sampler2D uReturnMask;
uniform vec2 uWorldOrigin;
uniform vec2 uWorldSize;
uniform float uTime;
```

The source of truth remains the discrete grid. Shaders only change presentation.

Phaser supports shader Game Objects and WebGL shader uniforms; implement using the shader/pipeline mechanism available in the installed project version rather than changing framework versions solely for this feature.

---

## 22. Camera

Use the existing camera implementation where possible.

Required behaviour:

- follow the ship smoothly;
- preserve pixel-art sampling;
- permit a limited zoom range;
- avoid revealing unknown terrain through camera background or unloaded chunks;
- cull distant chunks.

Use integer camera rounding only when it does not introduce visible ship jitter. Keep ship movement smooth.

---

## 23. Isometric Presentation

The simulation remains a square top-down grid even when art is drawn in an isometric style.

Do not use Phaser’s isometric tile coordinates for gameplay calculations.

Render art with isometric-looking sprites, raised cliffs and diagonal shorelines while retaining Cartesian world positions.

This avoids coupling pathfinding and visibility to diamond-grid projection.

Depth sort objects by world Y:

```ts
displayObject.setDepth(worldY + depthOffset);
```

Ocean and overlay chunk quads remain flat.

---

## 24. Terrain Rendering

Use Phaser Tilemaps for static art layers when this matches the existing code.

Recommended layers:

- deep ocean;
- shallow ocean;
- shoreline;
- land;
- cliffs;
- structures;
- decorations.

Gameplay terrain is not read back from rendered tilemap layers. Both rendering and gameplay are generated from the same world-generation source data.

This prevents art edits from silently changing navigation rules.

---

## 25. Discoveries

```ts
export const enum DiscoveryType {
  Island,
  Settlement,
  FishingGround,
  Anchorage,
  ReefPassage,
  Wreck,
  Resource,
}
```

A discovery is detected when any of its reveal tiles becomes currently visible.

Store it as provisional during the expedition.

```ts
interface DiscoveryRecord {
  id: number;
  type: DiscoveryType;
  tileX: number;
  tileY: number;
  returned: boolean;
}
```

Only successful return marks it permanent and allows later world effects.

For the prototype, discoveries need only a visible world marker and successful-return persistence.

---

## 26. NPC Ships

NPC ships are deferred until the exploration loop works.

The first NPC implementation should only visualize established support:

- spawn on Supported water;
- follow precomputed Supported paths;
- never enter Personal or Unknown water;
- use the same tile passability rules;
- use simple interpolation between path nodes.

NPC traffic is cosmetic in the first implementation.

---

## 27. Save Format

```ts
interface SaveGame {
  schemaVersion: 1;
  worldSeed: number;
  currentExpeditionId: number;
  ship: ShipSaveData;
  modifiedChunks: ChunkSaveData[];
  returnedDiscoveries: DiscoveryRecord[];
}
```

Serialize typed arrays as compressed base64 or run-length encoded numeric arrays.

Save:

- ship state;
- provision state;
- knowledge states;
- expedition stamps;
- returned discoveries;
- terrain modifications;
- persistent objects.

Do not save derived overlays or pathfinding output. Rebuild them on load.

Use browser storage through the existing persistence layer. Use IndexedDB when no existing storage layer is present.

---

## 28. Event Model

Use a typed event bus between simulation and presentation.

Required events:

```ts
shipEnteredTile
knowledgeChanged
provisionConsumed
returnStateChanged
discoveryFound
expeditionStarted
expeditionReturned
expeditionFailed
chunkDirty
```

Renderers respond to events or dirty flags. They must not poll the entire world every frame.

---

## 29. Debug Tools

The development build must provide toggles for:

- navigation grid;
- chunk boundaries;
- terrain passability;
- knowledge state;
- sight radius;
- forward search cost;
- return cost;
- return margin;
- parent directions;
- active chunks;
- current expedition stamps.

Debug visuals may be numeric and tile-based. Release visuals must hide them.

Add deterministic controls:

- reset expedition;
- add/remove provisions;
- teleport to tile;
- force successful return;
- force failure;
- reveal hidden discovery;
- regenerate from seed.

---

## 30. Tests

Core systems must be testable without Phaser.

Required unit tests:

### Visibility

- reveals all unobstructed cells within radius;
- does not reveal beyond radius;
- respects blockers;
- fills crossed tiles during fast movement.

### Provisions

- supported movement costs zero;
- unknown movement costs one per tile;
- personal movement costs half per tile;
- partial movement accumulates correctly;
- frame rate does not affect cost.

### Forward range

- includes reachable Unknown cells;
- excludes cells beyond provision budget;
- does not reveal hidden terrain costs;
- updates after provision consumption.

### Return path

- chooses the cheapest known route;
- excludes Unknown;
- uses Personal at half cost;
- reaches the nearest Supported region;
- marks negative-margin cells red;
- discovers shorter alternate known paths.

### Expedition

- successful return converts current Personal tiles to Supported;
- failure reverts current-expedition Personal tiles;
- previous Supported knowledge remains;
- provisional discoveries are discarded on failure.

---

## 31. Performance Budgets

Target:

- 60 rendered frames per second on a mid-range mobile browser;
- 30 fixed simulation updates per second;
- no more than 8 ms average JavaScript simulation time per rendered frame;
- no full-world overlay rebuilds during normal movement;
- no per-tile JavaScript object allocation in hot loops;
- no new texture allocation when masks update;
- no pathfinding on every render frame.

Pathfinding should run only after tile, provision or knowledge changes.

If Dijkstra exceeds the budget:

1. restrict the calculation to the connected explored region;
2. cache supported components;
3. reuse typed arrays;
4. reuse the priority queue;
5. move calculations to a Web Worker only after profiling confirms the need.

Do not begin with a Web Worker.

---

## 32. Browser and Mobile Requirements

- Use pointer input so mouse and touch share one path.
- Prevent accidental page scrolling over the game canvas.
- Pause the simulation when the page is hidden.
- Cap unusually large frame deltas after tab restoration.
- Resize using the existing Phaser scale configuration.
- Keep masks and chunk textures below browser texture-size limits.
- Test Safari on iOS, Chrome on Android and desktop Chromium.
- Do not rely on filesystem APIs.
- Persist saves through browser storage.
- Provide a WebGL-unavailable error screen rather than a partial Canvas fallback because the prototype depends on overlay shaders.

---

## 33. Accessibility

The overlay must not rely on hue alone.

Add an accessibility mode using:

- gray: no pattern;
- yellow: sparse diagonal dashes;
- orange: denser diagonal dashes;
- red: crosshatch or pulse.

The neutral forward range uses a dotted boundary and no risk pattern.

Physical provisions remain visible on the ship.

Do not add a permanent numerical HUD to normal play.

---

## 34. Implementation Milestones

### Milestone 1 — Existing Project Integration

- Run the existing Phaser project.
- Record the installed Phaser version.
- Identify reusable bootstrap, scenes, input, assets and camera code.
- Add the `tidebound` module without changing current behaviour.
- Add unit-test execution for core TypeScript.

Completion condition: an empty Wayfinders scene runs through the existing build and deployment path.

### Milestone 2 — Grid and Ship

- Implement world/grid coordinate conversions.
- Implement typed-array chunks.
- Add passable ocean and blocked land.
- Move one ship continuously.
- Track its current navigation tile.
- Add debug grid and chunk display.

Completion condition: the ship moves smoothly while all logical positions remain correct.

### Milestone 3 — Knowledge and Fog

- Implement Supported, Personal and Unknown states.
- Add five-tile visibility.
- Add personal-trail creation.
- Render gray personal water and black unknown fog.
- Add irregular, smoothed boundaries.

Completion condition: movement through black water produces a broad personal corridor while the area around the ship remains fully visible.

### Milestone 4 — Provisions

- Implement distance-based provision consumption.
- Add physical provision objects to the vessel.
- Animate removal when consumed.
- Apply three fixed knowledge costs.

Completion condition: travelling out and returning through the same corridor consumes the expected asymmetric cost.

### Milestone 5 — Range Overlays

- Implement forward-range Dijkstra.
- Implement multi-source return Dijkstra.
- Generate forward and return mask textures.
- Add gray, yellow, orange and red trail states.
- Add accessibility patterns.

Completion condition: the player can visually identify both remaining forward reach and whether the known return route remains viable.

### Milestone 6 — Expedition Resolution

- Start expedition on leaving Supported water.
- Track expedition-stamped tiles and discoveries.
- Convert Personal to Supported on return.
- Revert Personal to Unknown on failure.
- Save and reload the resulting world.

Completion condition: repeated voyages permanently expand the known world only after safe return.

### Milestone 7 — Prototype Content

- Add home island.
- Add hidden island.
- Add fishing ground.
- Add wreck or anchorage.
- Add return presentation.
- Add basic sound and movement feedback.

Completion condition: the full exploration loop can be played repeatedly for evaluation.

---

## 35. Prototype Acceptance Criteria

The prototype is complete when all of the following are true:

1. The browser game loads through the existing Phaser project.
2. The ship is visually smooth but logically occupies one navigation tile.
3. Unknown water is black and hides all content.
4. The five-tile sight area is shown in normal colour.
5. Travel creates a broad Personal corridor.
6. Personal water is gray after leaving current sight.
7. Physical provisions visibly diminish.
8. Unknown travel costs twice as much as retracing Personal water.
9. Supported travel costs nothing.
10. The neutral overlay shows reachable Unknown water.
11. The trail overlay communicates return viability.
12. Yellow, orange and red appear only behind the ship on Personal water.
13. Red means no known return through the explored network.
14. Returning converts expedition knowledge into Supported water.
15. Failure removes unreturned knowledge.
16. Saving and loading preserve permanent knowledge.
17. Normal exploration contains no numerical resource bar or route forecast.
18. The prototype maintains the performance targets on desktop and mobile browsers.

---

## 36. Official Phaser References

Implementation should use the documentation matching the Phaser version installed in the existing project.

Relevant official documentation areas:

- Phaser API documentation
- Phaser Tilemaps
- Phaser Shader Game Objects and WebGL shaders
- Phaser camera and scene systems
- Phaser development-environment guidance

Do not copy examples blindly across major Phaser versions. Confirm every rendering or shader API against the installed version before implementation.
