# World analysis

`WorldAnalysisIndex` is the immutable derived-facts boundary between logical
world rasterization and feature seeding. Build it once after terrain/island
cells are final, then inject it into catalogs that need passability, coastline,
island, component, or bounded local candidate queries.

The build performs one row-major read of `WorldGrid`. Coastline runs,
connectivity, and query indexes are derived from the captured arrays. Query
diagnostics report the indexed candidate set examined so tests can prevent a
new feature from quietly introducing another full-world scan.

Generation can inject `GridGraph.isNavigationNodePassable` as `isPassable` when
ship-clearance connectivity is required. The default uses the logical cell's
coarse movement passability, which is convenient for content placement tests.
