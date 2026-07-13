# Wayfinders Island Generation Approach

## Summary

Wayfinders should use **authored island prefabs with procedural placement** rather than generating each island tile by tile at runtime.

Each island is created as a complete, intentionally designed visual asset. The game then divides the island into render chunks and pairs it with gameplay masks for collision, navigation, shoreline effects, and object placement.

The procedural world generator decides:

- Which island prefab to use
- Where to place it
- How far it is from other islands
- Which region or theme it belongs to
- What discoveries, resources, or settlement state it contains

The generator does not construct the island coastline or terrain shape itself.

---

## Island Package

Each island prefab should contain:

```text
island_home_01/
  visual.png
  collision.png
  navigation.png
  shoreline.png
  placement.json
  metadata.json
```

### `visual.png`

The completed static island artwork.

It may include:

- Terrain
- Beaches
- Cliffs
- Static vegetation
- Static rocks
- Ground decoration

### `collision.png`

Defines blocked and passable areas.

### `navigation.png`

Defines gameplay movement states such as:

- Passable water
- Shallow water
- Reef
- Blocked land

### `shoreline.png`

Defines areas used for:

- Foam
- Wave effects
- Water-edge animation

### `placement.json`

Defines anchors for dynamic content:

- Docks
- Buildings
- Discoveries
- NPC spawn points
- Resource locations
- Settlement expansion points

### `metadata.json`

Defines:

- Island ID
- Theme
- Dimensions
- Rarity
- Allowed rotations
- Island type
- Render chunk layout

---

## Runtime Placement

At world-generation time:

```text
Choose island prefab
→ Choose world position
→ Validate spacing and region rules
→ Stamp gameplay masks into the world grid
→ Add island render chunks
→ Add dynamic objects and animations
```

This keeps world generation focused on archipelago layout rather than terrain construction.

---

## Render Chunking

Large island images should be divided into smaller square render chunks.

Example:

```text
Finished island image
→ Split into 512×512 render chunks
→ Load and render only visible chunks
```

Gameplay masks should align to the 32×32 navigation grid.

The player never sees the chunk boundaries.

---

## Static and Dynamic Content

### Static content

Static content can be baked into the island image:

- Terrain
- Beaches
- Cliffs
- Static trees
- Static rocks
- Ground details

### Dynamic content

Dynamic content should remain separate:

- Ships
- People
- Smoke
- Flags
- Shoreline foam
- Waves
- Collectible resources
- Buildings that can change
- Settlement upgrades
- Fog of war
- Exploration overlays

This allows the island to change without regenerating the complete visual asset.

---

## Recommended Hybrid

Use authored island prefabs for:

- Home island
- Inhabited islands
- Major discovery islands
- Important landmarks
- Large islands

Use lightweight procedural generation for:

- Tiny islets
- Reefs
- Rocks
- Sandbars
- Wrecks
- Fishing grounds
- Small offshore details

---

## Advantages

- Much less procedural terrain-generation work
- No runtime coastline construction
- No complex island auto-tiling
- Better visual composition
- More memorable island silhouettes
- Easier asset review and polish
- More predictable performance
- Clear separation between world layout and island appearance

---

## Trade-Off

The main limitation is repetition.

A limited number of island prefabs may eventually become recognizable.

Variation can be added through:

- Valid rotations and reflections
- Different settlement layouts
- Vegetation overlays
- Resource placement
- Dock placement
- Abandoned or damaged variants
- Weather and lighting
- Small surrounding reefs and rocks

---

## Asset Workflow

```text
Design complete island
→ Review composition
→ Export static visual
→ Create collision and navigation masks
→ Define dynamic anchors
→ Split into render chunks
→ Validate in Asset Workshop
→ Register in island prefab manifest
```

---

## Recommendation

Use authored island prefabs with procedural placement for the prototype and initial production version.

The procedural value should come from:

- Uncertain world layout
- Island placement
- Route formation
- Discovery order
- Resource distribution
- Settlement variation

The island coastlines and major visual composition should remain authored.
