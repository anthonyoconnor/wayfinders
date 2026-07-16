# Presentation chunk activation

This directory owns the renderer-agnostic decision about which presentation chunks
may hold expensive resources. `ActiveChunkSet` converts a closed visible chunk region
into a deterministic, capacity-limited list containing visible chunks first and a
configurable prefetch ring second.

It does not own Phaser objects, authoritative `WorldGrid` storage, feature rules, or
asset loading. `WayfindersScene` is the single adapter and uses a hard five-by-five
(`25`) chunk budget with one prefetch ring. It:

1. Convert camera world bounds to an inclusive chunk region and call `update` when
   that region changes.
2. Process `deactivated` first, then `activated` in load-priority order, and finally
   `updated` metadata.
3. Use non-creating world reads (`getChunk`, never `getOrCreateChunk`) while building
   presentation resources.
4. Show low-detail placeholders for visible `deferred` entries when the hard budget
   is smaller than the viewport.
5. Keeps texture byte limits, object pools, and shared-resource reference counts in
   separate resource controllers; their counters are published beside this module's
   telemetry through `window.__WAYFINDERS__.presentationResources()`.

`revision` covers the effective target and priority ordering. `membershipRevision`
changes only when a chunk enters or leaves the active set. Arrays are returned in a
stable order so tests and loaders do not depend on `Map` insertion order.

`WorldRenderer` uses the ocean backdrop as the deterministic low-detail
placeholder, then creates terrain and authored home objects only for active
chunks. Knowledge and risk overlays own at most one and two canvas textures per
active chunk respectively. Marker renderers share the same active entries and
retain only a small bounded pool. `ReferenceCountedResourceCache` is the
entry/decoded-weight boundary for future unique island resources; current pilot
textures remain a small scene-owned shared set.
