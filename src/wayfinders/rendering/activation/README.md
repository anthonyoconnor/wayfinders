# Periodic presentation activation

This directory owns the renderer-neutral decision about which lifted images of
canonical world chunks may hold presentation resources. `viewportTileBounds`
converts the scene camera's lifted pixel rectangle into exact inclusive tile
bounds. `ActiveChunkSet` asks the authoritative `WorldTopology` for intersecting
periodic chunk images, ranks visible images before a configurable prefetch ring,
and applies one hard capacity to image entries.

Each `ActiveChunkEntry` has two deliberately separate identities:

- `viewKey` and `imageOffset` identify one lifted presentation image. The offset
  is a whole-world pixel displacement, so partial final chunks repeat at the
  exact world span instead of a notional chunk lattice.
- `canonicalChunk` identifies the logical chunk that owns revisions, textures,
  dirty state, and read-model data. Multiple active images may share this owner.

The module owns no Phaser objects, authoritative `WorldGrid` storage, feature
rules, or asset loading. `WayfindersScene` is the adapter and uses a hard `25`
image-entry budget with one prefetch ring. It processes `deactivated` first,
then `activated` in load-priority order, and finally `updated` metadata. Visible
`deferred` entries receive the existing low-detail placeholder.

`revision` covers the lifted target and priority ordering.
`membershipRevision` changes only when a view key enters or leaves the active
set. Returned arrays and telemetry are deterministic. Telemetry fields named
`*Chunks` count image entries; canonical texture and redraw plateaus remain the
responsibility of their owning renderers.
