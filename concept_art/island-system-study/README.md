# Island water-system concept study

These concepts apply the current island-and-sea art direction to four authored
island archetypes. They are art targets rather than collision layouts: each
production island is created outside the game and imported as a transparent
RGBA image whose painted water apron joins the animated deep-sea base.

Procedural islands are temporary stand-ins and are not an art-production target.

## Shared system rules

- Deep water remains a continuous dark navy-to-teal field with directional
  wavelets and sparse whitecaps.
- Shallows are terrain-driven lobes, channels, shelves, reef heads, and pockets,
  not a fixed-width outline around land.
- Windward rock and open-ocean coasts have a narrow shelf and more broken surf.
- Leeward beaches, lagoons, river mouths, and bays have broader calmer shelves.
- Surf is fragmented and exposure-driven rather than a continuous white ring.
- Color changes pass through textured intermediate water instead of hard bands.

## Concepts

- `crescent-fishing-cay.png`: rough outer crescent versus a broad calm lagoon.
- `lightning-ridge.png`: narrow cliff-side shelf versus a large lee-side shelf.
- `river-delta-haven.png`: branching brackish channels, bars, and calm sediment
  flats contrasted with a rocky exposed coast.
- `star-reef-atoll.png`: connected reef platform, deep-water passes, patch coral,
  and discontinuous outer surf.

The rocky ridge and river delta are the clearest references for validating that
authored water responds to coast type, exposure, and underwater terrain rather
than simply dilating the island silhouette.

The square runtime-source prompts and import mapping are recorded in
`RUNTIME_ASSET_PROMPTS.md`.
