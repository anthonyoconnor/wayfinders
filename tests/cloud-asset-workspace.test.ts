import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLOUD_ASSET_PACKAGE,
  cloudAssetVariantEntries,
} from "../src/wayfinders/assets/CloudAssetCatalog";

const scene = readFileSync(
  new URL("../src/wayfinders/assets/cloudPreview/CloudAssetWorkspaceScene.ts", import.meta.url),
  "utf8",
);

describe("CLD-3 cloud asset workspace", () => {
  it("lists every stored frame in stable atlas order with saved availability", () => {
    expect(cloudAssetVariantEntries().map(({ id, frame, activeInGame }) => ({
      id,
      frame,
      activeInGame,
    }))).toEqual([
      { id: "long-broken-wisp", frame: 0, activeInGame: true },
      { id: "compact-uneven-cluster", frame: 1, activeInGame: true },
      { id: "split-trailing-wisps", frame: 2, activeInGame: true },
      { id: "shallow-crescent-bank", frame: 3, activeInGame: true },
    ]);
    expect(CLOUD_ASSET_PACKAGE.variants).toHaveLength(CLOUD_ASSET_PACKAGE.image.frameCount);
  });

  it("renders selection, a live world atmosphere preview and active-in-game authoring", () => {
    expect(scene).toContain('data-cloud-variant=');
    expect(scene).toContain('data-cloud-status=');
    expect(scene).toContain('data-cloud-world-preview');
    expect(scene).toContain('data-cloud-preview-control="seed"');
    expect(scene).toContain('data-cloud-preview-control="speed"');
    expect(scene).toContain('data-cloud-preview-control="guides"');
    expect(scene).toContain('data-cloud-preview-action="reroll"');
    expect(scene).toContain('data-cloud-preview-action="pause"');
    expect(scene).toContain("resolveCloudWorldPreviewDescriptors");
    expect(scene).toContain("requestAnimationFrame(this.animatePreview)");
    expect(scene).toContain('data-cloud="active"');
    expect(scene).toContain('data-cloud-action="save"');
    expect(scene).toContain('data-cloud-action="reset"');
    expect(scene).toContain('data-cloud-action="delete"');
    expect(scene).toContain("Save changes");
    expect(scene).toContain("Reset settings");
    expect(scene).toContain("Delete cloud");
  });

  it("exposes live controls for layout, size, positions, movement, opening clouds, and shadows", () => {
    for (const path of [
      "candidatesPerChunk",
      "chunkDensity",
      "scale.minimum",
      "scale.maximum",
      "opacity.minimum",
      "opacity.maximum",
      "driftAmplitudePixels.minimum",
      "driftAmplitudePixels.maximum",
      "driftPeriodSeconds.minimum",
      "driftPeriodSeconds.maximum",
      "openingClouds.scale.minimum",
      "openingClouds.driftAmplitudePixels.maximum",
      "openingClouds.driftPeriodSeconds.maximum",
      "shadow.offsetPixels.x",
      "shadow.offsetPixels.y",
      "shadow.scale.x",
      "shadow.scale.y",
      "shadow.opacityMultiplier",
    ]) {
      expect(scene).toContain(path);
    }
    expect(scene).toContain('openingClouds.offsetPixels.${index}.x');
    expect(scene).toContain('openingClouds.offsetPixels.${index}.y');
    expect(scene).toContain("validateCloudAssetAuthoringSettings(draft)");
    expect(scene).toContain("this.drawWorldPreview()");
    expect(scene).toContain("settings: this.settingsDraft");
  });

  it("uses guarded same-origin routes, confirms deletion, reloads, and tears down owned DOM", () => {
    expect(scene).toContain('"/__wayfinders/assets/clouds/save"');
    expect(scene).toContain('"/__wayfinders/assets/clouds/delete"');
    expect(scene).toContain('method: "POST"');
    expect(scene).toContain('"Content-Type": "application/json"');
    expect(scene).toContain("window.confirm");
    expect(scene).toContain("runtimeRevision: CLOUD_ASSET_PACKAGE.runtimeRevision");
    expect(scene).toContain("window.sessionStorage.setItem");
    expect(scene).toContain("window.location.reload()");
    expect(scene).toContain("this.controlsAbort?.abort()");
    expect(scene).toContain("cancelAnimationFrame(this.animationFrame)");
    expect(scene).toContain("this.previewCanvas?.destroy()");
    expect(scene).toContain("this.browser?.remove()");
    expect(scene).toContain("this.stage?.remove()");
    expect(scene).toContain("slot.replaceChildren()");
  });

  it("defines a usable all-deleted empty state", () => {
    expect(scene).toContain("Every cloud has been deleted from the catalog.");
    expect(scene).toContain("No cloud assets remain");
    expect(scene).toContain("generated world intentionally has no cloud or shadow views");
  });
});
