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

describe("architecture import boundaries", () => {
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
        "import Phaser from 'phaser';",
        "import type { FishingReadModel } from '../features/fishing';",
        "import { fishingView } from '../features/fishing/FishingPresentationAdapter';",
      ].join("\n"),
      "src/wayfinders/assets/FishingPreviewScene.ts": [
        "import Phaser from 'phaser';",
        "import '../rendering/FishingRenderer';",
      ].join("\n"),
      "src/wayfinders/assets/AssetTrialScene.ts": [
        "import { WorldGrid } from '../world/WorldGrid';",
        "import { MovementAuthority } from '../navigation/MovementAuthority';",
      ].join("\n"),
      "src/wayfinders/assets/audioPreview/AudioAssetWorkspaceScene.ts":
        "import { AudioPreviewPlayer } from './AudioPreviewPlayer';\n",
      "src/wayfinders/assets/audioPreview/AudioPreviewPlayer.ts":
        "export const transportDescription = 'No fetch() or new FormData() mutation transport';\n",
      "src/wayfinders/world/WorldGrid.ts": "export class WorldGrid {}\n",
      "src/wayfinders/navigation/MovementAuthority.ts": "export class MovementAuthority {}\n",
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

  it("rejects Phaser and rendering backedges from shared domain layers", async () => {
    const root = await fixture({
      "src/wayfinders/world/WorldGrid.ts": "import type Phaser from 'phaser';\n",
      "src/wayfinders/audio/AudioMixer.ts": "import Phaser from 'phaser';\n",
      "src/wayfinders/exploration/SharedSystem.ts": "import { SharedRenderer } from '../rendering/SharedRenderer';\n",
      "src/wayfinders/core/GameSimulation.ts": "export { SharedRenderer } from '../rendering/SharedRenderer';\n",
      "src/wayfinders/rendering/SharedRenderer.ts": "export const SharedRenderer = {};\n",
    });

    const violations = await checkFeatureBoundaries(root);
    expect(violations.map(({ code }) => code)).toEqual([
      "domain-no-phaser",
      "domain-no-rendering",
      "domain-no-rendering",
      "domain-no-phaser",
    ]);
    expect(violations.map(({ file }) => file)).toEqual([
      "src/wayfinders/audio/AudioMixer.ts",
      "src/wayfinders/core/GameSimulation.ts",
      "src/wayfinders/exploration/SharedSystem.ts",
      "src/wayfinders/world/WorldGrid.ts",
    ]);
  });

  it("keeps the isolated asset trial candidate-only and the Audio workspace play-only", async () => {
    const root = await fixture({
      "src/wayfinders/core/GameSimulation.ts": "export class GameSimulation {}\n",
      "src/wayfinders/assets/CloudAssetAuthoring.ts": "export const saveCloud = () => {};\n",
      "src/wayfinders/assets/AssetTrialScene.ts": [
        "import { GameSimulation } from '../core/GameSimulation';",
        "import '../../main';",
      ].join("\n"),
      "src/wayfinders/assets/audioPreview/AudioAssetWorkspaceScene.ts": [
        "import { saveCloud } from '../CloudAssetAuthoring';",
        "export const save = () => fetch('/__wayfinders/audio/save', { method: 'POST' });",
      ].join("\n"),
      "src/wayfinders/assets/audioPreview/MutationTransport.ts": [
        "export const request = () => new XMLHttpRequest();",
        "export const form = () => new FormData();",
        "export const beacon = () => navigator.sendBeacon('/__wayfinders/audio/save');",
      ].join("\n"),
    });

    const violations = await checkFeatureBoundaries(root);
    expect(violations).toHaveLength(7);
    expect(violations.map(({ code }) => code).sort()).toEqual([
      "asset-trial-no-gameplay-composition",
      "asset-trial-no-gameplay-composition",
      "audio-workspace-no-mutation",
      "audio-workspace-no-mutation",
      "audio-workspace-no-mutation",
      "audio-workspace-no-mutation",
      "audio-workspace-no-mutation",
    ]);
    expect(violations.filter(({ code }) => code === "asset-trial-no-gameplay-composition")
      .map(({ specifier }) => specifier).sort()).toEqual([
        "../../main",
        "../core/GameSimulation",
      ]);
    expect(violations.filter(({ code }) => code === "audio-workspace-no-mutation")
      .map(({ specifier }) => specifier).sort()).toEqual([
        "../CloudAssetAuthoring",
        "FormData",
        "XMLHttpRequest",
        "fetch()",
        "navigator.sendBeacon()",
      ]);
    expect(violations.map(formatFeatureBoundaryViolation).join("\n")).toContain(
      "The Audio asset workspace is play-only",
    );
  });
});
