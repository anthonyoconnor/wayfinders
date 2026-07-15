import { defineConfig, type TestProjectConfiguration } from "vitest/config";

const integrationTests = [
  "tests/discoveries.test.ts",
  "tests/expedition.test.ts",
  "tests/fishing-shoals.test.ts",
  "tests/game-simulation.test.ts",
  "tests/idol-locations-integration.test.ts",
  "tests/island-dossiers.test.ts",
  "tests/navigator-voyages.test.ts",
  "tests/survey-sites-integration.test.ts",
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
      project("quick", ["tests/**/*.test.ts"], [
        ...integrationTests,
        "tests/performance/**/*.test.ts",
      ]),
      project("integration", integrationTests),
      project("io", ["tests/**/*.test.mjs"]),
      project("performance", ["tests/performance/**/*.test.ts"]),
    ],
  },
});
