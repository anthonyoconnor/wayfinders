# Production island set

This folder retains the concept decisions for the twenty authored islands
created as one production set. Each biome folder owns the two-alternative
concept boards, selection rationale, production-source prompt, and exact path
to the selected source. The imported sources follow the authored-island
`island-composite` workflow and the repository art direction.

## Set composition

| Biome | Island | Habitation | Selected concept | Prepared canvas | Collision intent |
| --- | --- | --- | --- | --- | --- |
| Tropical | Sunweave Lagoon | Inhabited | Left | `640 x 576` | Broken ring with navigable inner lagoon and east harbor mouth |
| Tropical | Mangrove Forks | Inhabited | Left | `576 x 640` | Separate delta fingers with four boat-width channels |
| Tropical | Moonhook Cay | Uninhabited | Left | `448 x 384` | Crescent land with an open eastern cove |
| Tropical | Three-Fin Atoll | Uninhabited | Left | `512 x 512` | Three discrete fins around open central water |
| Desert | Saffron Haven | Inhabited | Left | `640 x 512` | Mesa island with a navigable southern harbor |
| Desert | Copperwind Port | Inhabited | Left | `576 x 448` | Crescent hook with an open eastern port |
| Desert | Glass Dune Isle | Uninhabited | Right | `512 x 384` | Narrow dune spine with two east-facing coves |
| Desert | Scorpion Mesa | Uninhabited | Left | `448 x 512` | Lobed scorpion silhouette with an open inner curl |
| Forest | Cedar Crown | Inhabited | Right | `640 x 576` | Broad crown with a navigable southern harbor |
| Forest | Mosswater Reach | Inhabited | Left | `576 x 448` | Wetland lobes separated by braided navigable channels |
| Forest | Splitpine Wilds | Uninhabited | Right | `512 x 512` | Two land masses joined by a narrow solid isthmus |
| Forest | Ferncoil Isle | Uninhabited | Right | `448 x 512` | Spiral land coil around a connected water channel |
| Winter | Frostharbor | Inhabited | Right | `640 x 576` | Shield coast divided by an open southern fjord |
| Winter | Emberhearth Isle | Inhabited | Right | `576 x 512` | Eastern harbor plus narrow geothermal water cut |
| Winter | Whitefang Skerry | Uninhabited | Left | `384 x 576` | One long ridge; detached ice and needles remain water |
| Winter | Blueglass Atoll | Uninhabited | Left | `512 x 512` | Seven discrete islets with open central water and passes |
| Barren | Cinder Crown | Uninhabited | Left | `576 x 576` | Volcanic ring with connected crater lake and south breach |
| Barren | Ashen Hook | Uninhabited | Left | `448 x 512` | Volcanic crescent with an open eastern bay |
| Barren | Saltbone Flats | Uninhabited | Left | `640 x 448` | Salt mesa with northern cleft and southern inlet |
| Barren | Blackneedle Isle | Uninhabited | Right | `512 x 512` | Four dark lobes around four open coves |

## Repository artifacts

For an island slug `<biome>-<name>`, the retained artifacts are:

- Concept board:
  `concept_art/production-islands-20/<biome>/<name>-concept-board.png`
- Selected production source:
  `assets-src/gr3/intake/production-island-<biome>-<name>-source.png`
- Canonical semantic collision:
  `assets-src/gr3/candidate-masks/production-island-<biome>-<name>-mask.png`
- Prepared composite, thumbnail, collision draft, and report:
  `assets-src/gr3/candidates/production-island-<biome>-<name>/`

The semantic masks were authored at the documented 8 px subcell resolution and
saved through the focused Islands candidate transaction. They deliberately
exclude baked water aprons, docks, detached rocks, reef fragments, ice floes,
and navigable lagoons, channels, coves, harbors, and fjords.

## Acceptance rule

Preparation and repository validation are evidence, not visual approval. An
island remains unavailable until its exact current fingerprint passes the
isolated four-direction ship trial, comparison with its selected concept, and
an actual generated-world review with collision overlays and no fallback or
loading errors.

All twenty islands passed that rule and are available in subsequent generated
worlds. The exact trial revisions, availability-save revisions, and seeded
runtime placements are retained in [ACCEPTANCE.md](./ACCEPTANCE.md).
