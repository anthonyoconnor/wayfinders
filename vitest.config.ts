import { defineConfig, type TestProjectConfiguration } from "vitest/config";

// Keep this lane intentionally small. It is the default agent feedback loop,
// so additions should be deterministic contracts that use tiny fixtures and
// finish in well under one second per file.
const quickTests = [
  "tests/active-chunk-set.test.ts",
  "tests/bucketed-cost-search.test.ts",
  "tests/navigation-collision-edges.test.ts",
  "tests/navigation-topology-cache.test.ts",
  "tests/presentation-lifetime.test.ts",
  "tests/viewport-chunk-region.test.ts",
  "tests/world-analysis-index.test.ts",
  "tests/world-manifest.test.ts",
  "tests/world-spatial-index.test.ts",
  "tests/world-topology.test.ts",
];

// These suites validate checked-in repository artifacts. Keeping them in the
// I/O lane prevents unrelated in-progress asset work from breaking domain-only
// feedback while retaining them in the full correctness gate.
const repositoryAssetTests = [
  "tests/asset-library-catalog.test.ts",
  "tests/great-hall-preview-assets.test.ts",
  "tests/production-island-trial-acceptance.test.ts",
];

// Prototype-world construction and cross-feature journeys belong here. Keep
// the list explicit: building a complete simulation should be a deliberate
// test choice rather than the default for a new contract.
const integrationTests = [
  "tests/authored-map-game-simulation.test.ts",
  "tests/authored-map-source-loader.test.ts",
  "tests/authored-home-island.test.ts",
  "tests/config-world-movement.test.ts",
  "tests/discoveries.test.ts",
  "tests/expedition.test.ts",
  "tests/fishing-shoals.test.ts",
  "tests/forward-guidance.test.ts",
  "tests/game-simulation-spatial.test.ts",
  "tests/game-simulation.test.ts",
  "tests/idol-locations-integration.test.ts",
  "tests/island-dossiers.test.ts",
  "tests/islands.test.ts",
  "tests/navigator-voyages.test.ts",
  "tests/periodic-game-simulation-journeys.test.ts",
  "tests/procedural-source-signature.test.ts",
  "tests/simulation-clock.test.ts",
  "tests/survey-sites-integration.test.ts",
  "tests/survey-sites.test.ts",
  "tests/world-generation-pipeline.test.ts",
  "tests/wreck-surveys.test.ts",
];

const project = (
  name: string,
  include: string[],
  exclude: string[] = [],
): TestProjectConfiguration => ({
  extends: true,
  test: {
    name,
    include,
    exclude,
  },
});

export default defineConfig({
  test: {
    projects: [
      project("quick", quickTests),
      project("contract", ["tests/**/*.test.ts"], [
        ...quickTests,
        ...integrationTests,
        ...repositoryAssetTests,
        "tests/performance/**/*.test.ts",
      ]),
      project("integration", integrationTests),
      project("io", ["tests/**/*.test.mjs", ...repositoryAssetTests]),
      {
        extends: true,
        test: {
          name: "performance",
          include: ["tests/performance/**/*.test.ts"],
        },
      },
    ],
  },
});
