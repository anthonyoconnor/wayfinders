import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkFeatureBoundaries,
  formatFeatureBoundaryViolation,
} from "../scripts/check-feature-boundaries.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-feature-boundaries-"));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return root;
}

describe("feature import boundaries", () => {
  it("allows public feature indexes, contracts, and presentation adapters", async () => {
    const root = await fixture({
      "src/wayfinders/features/fishing/index.ts": "export type { FishingReadModel } from './FishingContracts';\n",
      "src/wayfinders/features/fishing/FishingContracts.ts": "export interface FishingReadModel {}\n",
      "src/wayfinders/features/fishing/FishingPresentationAdapter.ts": "export const fishingView = {};\n",
      "src/wayfinders/features/surveys/SurveySystem.ts": [
        "import type { FishingReadModel } from '../fishing';",
        "import type { FishingReadModel as Contract } from '../fishing/FishingContracts';",
      ].join("\n"),
      "src/wayfinders/rendering/FishingRenderer.ts": [
        "import type { FishingReadModel } from '../features/fishing';",
        "import { fishingView } from '../features/fishing/FishingPresentationAdapter';",
      ].join("\n"),
    });

    expect(await checkFeatureBoundaries(root)).toEqual([]);
  });

  it("rejects Phaser and rendering dependencies owned by a feature", async () => {
    const root = await fixture({
      "src/wayfinders/features/fishing/FishingSystem.ts": [
        "import Phaser from 'phaser';",
        "import { FishingRenderer } from '../../rendering/FishingRenderer';",
      ].join("\n"),
    });

    const violations = await checkFeatureBoundaries(root);
    expect(violations.map(({ code }) => code)).toEqual(["feature-no-phaser", "feature-no-rendering"]);
    expect(formatFeatureBoundaryViolation(violations[0])).toContain("Feature \"fishing\" cannot import Phaser");
  });

  it("rejects private imports from rendering and from another feature", async () => {
    const root = await fixture({
      "src/wayfinders/features/fishing/FishingState.ts": "export const shoals = [];\n",
      "src/wayfinders/features/fishing/FishingSystem.ts": "export const updateFishing = () => {};\n",
      "src/wayfinders/features/surveys/SurveySystem.ts": "import { shoals } from '../fishing/FishingState';\n",
      "src/wayfinders/rendering/FishingRenderer.ts": "import { updateFishing } from '../features/fishing/FishingSystem';\n",
    });

    const violations = await checkFeatureBoundaries(root);
    expect(violations).toHaveLength(2);
    expect(violations.every(({ code }) => code === "feature-private-import")).toBe(true);
    expect(violations.map(({ message }) => message).join("\n")).toContain(
      "Feature \"surveys\" cannot import private modules from feature \"fishing\"",
    );
    expect(violations.map(({ message }) => message).join("\n")).toContain(
      "Rendering/presentation cannot import private modules from feature \"fishing\"",
    );
  });

  it("limits feature ownership rules to feature packages", async () => {
    const root = await fixture({
      "src/wayfinders/exploration/SharedSystem.ts": "import Phaser from 'phaser';\n",
      "src/wayfinders/rendering/SharedRenderer.ts": "import { shared } from '../exploration/SharedSystem';\n",
    });

    expect(await checkFeatureBoundaries(root)).toEqual([]);
  });
});
