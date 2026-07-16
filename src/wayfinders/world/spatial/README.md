# World spatial index

`WorldSpatialIndex` is the shared location/proximity boundary for durable world
descriptors. It is renderer-free and does not own descriptor gameplay state.

## Contract

- Coordinates are logical world units. Bounds are closed: both minimum and
  maximum edges participate in point and intersection queries.
- Every descriptor has a non-empty string ID or safe-integer numeric ID. IDs
  never change; replace an identity with `remove` plus `add`.
- Descriptor bounds are copied into private index records. Descriptor objects
  are returned by reference and must otherwise be treated as immutable.
- An entity is indexed into every intersected chunk. Its `homeChunk` contains
  the centre of its bounds. Membership and query output are deterministic.
- Point, bounds, radius, nearby, and chunk queries only inspect intersecting
  buckets. Nearby output is distance-then-ID; other query output is ID order.
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
