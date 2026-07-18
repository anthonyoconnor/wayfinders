# World spatial index

`WorldSpatialIndex` is the shared location/proximity boundary for durable world
descriptors. It is renderer-free and does not own descriptor gameplay state.

## Contract

- Construction requires one explicit `WorldTopology`; its tile dimensions,
  chunk size, and per-axis bounded/wrapped policy define the complete index.
- Coordinates are logical tile coordinates. Descriptor bounds are closed,
  integer, lifted rectangles. A wrapped descriptor must be strictly smaller
  than each wrapped world span and becomes one to four canonical pieces under
  one stable ID. Bounded descriptor bounds remain wholly canonical.
- Every descriptor has a non-empty string ID or safe-integer numeric ID. IDs
  never change; replace an identity with `remove` plus `add`.
- Descriptor bounds are copied into private index records. Descriptor objects
  are returned by reference and must otherwise be treated as immutable.
- An entity is indexed into every canonical chunk intersected by any footprint
  piece. Its `homeChunk` contains the canonicalized centre of its lifted source
  bounds. Membership exposes the canonical centre and pieces; membership and
  query output are deterministic.
- Point, bounds, radius, nearby, and chunk queries split at wrapped seams and
  corners, inspect each canonical bucket once, and deduplicate descriptor IDs
  before exact filtering. Nearby uses periodic minimum-image distance and
  distance-then-ID ordering; other output is ID order. Chunk aliases wrap only
  on wrapped axes, so bounded asset contexts retain bounded behavior.
- Queries wider than one image and worlds with one- or two-cell axes return
  each authoritative descriptor once. Chunk membership remains row-major.
- Every query returns counters for buckets, raw bucket entries, unique entities
  tested, and matches. `getQueryTotals` exposes aggregate diagnostic counters;
  `resetQueryTotals` starts a new sampling interval.

## Mutation and invalidation

`build` validates and constructs a replacement index before touching live
state. `add`, `update`, `remove`, and `clear` return a `SpatialIndexMutation`
containing the old/new revision, stable changed IDs, and affected chunks. A
missing removal or an update with the exact same immutable descriptor is a
`none` mutation and does not advance the revision.

Consumers should retain only the revision they last applied and use the typed
changed ID/chunk output to update active presentation. Static and dynamic
content can use separate index instances when their mutation rates or lifetime
rules differ.
