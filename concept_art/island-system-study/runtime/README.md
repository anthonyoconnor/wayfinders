# Authored-island runtime acceptance

These live game captures use deterministic world seed `129`. Navigation and
return guidance plus cloud atmosphere are disabled so the island-to-sea join is
visible; each non-Home island is surveyed from its deterministic coastal
approach. The game UI is retained as evidence that the images are running in
the production renderer rather than a standalone art preview.

## Acceptance capture set

| Island | Runtime capture | Concept reference | Visual check |
| --- | --- | --- | --- |
| Home Island | [home-island-final.png](home-island-final.png) | [selected Home shelf](../../home-shoreline/concept-a-bahamian-sand-shelf-selected.png) | Broad sheltered shelf, tight exposed reach, deep-water edge convergence |
| Crescent Cay | [crescent-cay-final.png](crescent-cay-final.png) | [crescent fishing cay](../crescent-fishing-cay.png) | Rough exterior versus broad calm inner lagoon |
| Lightning Ridge | [lightning-ridge-final.png](lightning-ridge-final.png) | [lightning ridge](../lightning-ridge.png) | Cliff-tight windward water versus wide lee shelf |
| Star Atoll | [star-atoll-final.png](star-atoll-final.png) | [star reef atoll](../star-reef-atoll.png) | Irregular reef platform, lagoon, and deep navigable passes |
| River Delta | [river-delta-final.png](river-delta-final.png) | [river delta haven](../river-delta-haven.png) | Branching sediment flats and channels rather than a coast outline |

The acceptance standard is a continuous join to the live deep sea with no hard
colour or rectangular alpha boundary. Each painted shallow region must have an
island-specific bathymetric silhouette rather than a uniform dilation of the
coast. Edge preparation converges fade-band RGB on the measured default sea
median `[8, 48, 68]` before alpha reaches zero, while ordinary animated water
continues outside the authored claim.

Complete revision-matched `island-composite` or `water-apron` presentations own
their canvas and one-cell collar automatically. Missing, stale, land-only, and
procedural islands retain generated-water presentation, so this acceptance set
intentionally covers Home plus four externally authored imports rather than the
procedural stand-ins.
