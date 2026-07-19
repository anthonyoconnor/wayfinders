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

describe("CLD-2 cloud asset workspace", () => {
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

  it("renders selection, a paired-shadow preview and active-in-game authoring", () => {
    expect(scene).toContain('data-cloud-variant=');
    expect(scene).toContain('data-cloud-status=');
    expect(scene).toContain('data-cloud-preview');
    expect(scene).toContain("presentation.shadow.offsetPixels");
    expect(scene).toContain("presentation.shadow.scale.x");
    expect(scene).toContain("presentation.shadow.opacityMultiplier");
    expect(scene).toContain('data-cloud="active"');
    expect(scene).toContain('data-cloud-action="save"');
    expect(scene).toContain('data-cloud-action="delete"');
    expect(scene).toContain("Save changes");
    expect(scene).toContain("Delete cloud");
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
    expect(scene).toContain("this.browser?.remove()");
    expect(scene).toContain("this.stage?.remove()");
    expect(scene).toContain("slot.replaceChildren()");
  });

  it("defines a usable all-deleted empty state", () => {
    expect(scene).toContain("Every cloud has been deleted from the catalog.");
    expect(scene).toContain("No cloud assets remain");
    expect(scene).toContain("The runtime cloud layer stays empty");
  });
});

