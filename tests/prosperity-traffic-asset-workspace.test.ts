import { describe, expect, it } from "vitest";
import {
  PROSPERITY_TRAFFIC_ASSET_CATALOG,
  prosperityTrafficAssetById,
} from "../src/wayfinders/assets/prosperityTraffic/ProsperityTrafficAssetCatalog.ts";
import {
  PROSPERITY_TRAFFIC_FISHING_RUNTIME_LABEL,
  PROSPERITY_TRAFFIC_TRADE_RUNTIME_LABEL,
  prosperityTrafficAssetBrowserMarkup,
  prosperityTrafficAssetPreviewLayout,
  syncProsperityTrafficAssetBrowserSelection,
} from "../src/wayfinders/assets/prosperityTraffic/ProsperityTrafficAssetPreviewUi.ts";
import { PROSPERITY_TRAFFIC_ASSET_WORKSPACE } from "../src/wayfinders/assets/workspaces/ProsperityTrafficAssetWorkspace.ts";
import {
  PROSPERITY_TRAFFIC_FISHING_ALPHA,
  PROSPERITY_TRAFFIC_TRADE_ALPHA,
} from "../src/wayfinders/rendering/prosperity/index.ts";

describe("Prosperity ship-traffic asset workspace", () => {
  it("registers a view-only workspace with exactly the two runtime craft", () => {
    expect(PROSPERITY_TRAFFIC_ASSET_WORKSPACE).toEqual({
      id: "traffic",
      label: "Ship traffic",
      kind: "prosperity-traffic-preview",
    });
    expect(PROSPERITY_TRAFFIC_ASSET_CATALOG.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "fishing-workboat", kind: "fishing" },
      { id: "trade-canoe", kind: "trade" },
    ]);
    expect(new Set(PROSPERITY_TRAFFIC_ASSET_CATALOG.map(({ id }) => id)).size).toBe(2);
  });

  it("shares runtime opacity contracts and stable lookup identity", () => {
    expect(prosperityTrafficAssetById("fishing-workboat")).toMatchObject({
      kind: "fishing",
      runtimeAlpha: PROSPERITY_TRAFFIC_FISHING_ALPHA,
    });
    expect(prosperityTrafficAssetById("trade-canoe")).toMatchObject({
      kind: "trade",
      runtimeAlpha: PROSPERITY_TRAFFIC_TRADE_ALPHA,
    });
    expect(prosperityTrafficAssetById("concept-a")).toBeUndefined();
  });

  it("keeps native buttons in semantic list items and updates selection in place", () => {
    const markup = prosperityTrafficAssetBrowserMarkup("fishing-workboat");
    expect(markup).toContain('<ul class="traffic-preview-list">');
    expect(markup.match(/<li>\s*<button/gu)).toHaveLength(2);
    expect(markup).not.toContain('role="listitem"');
    expect(markup).toContain('data-traffic-asset="fishing-workboat"\n              aria-pressed="true"');

    const buttons = ["fishing-workboat", "trade-canoe"].map((trafficAsset) => {
      const attributes = new Map<string, string>();
      return {
        dataset: { trafficAsset },
        focused: trafficAsset === "trade-canoe",
        attributes,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      };
    });
    const focusedButton = buttons[1];

    syncProsperityTrafficAssetBrowserSelection(buttons, "trade-canoe");

    expect(buttons[0]!.attributes.get("aria-pressed")).toBe("false");
    expect(buttons[1]!.attributes.get("aria-pressed")).toBe("true");
    expect(buttons[1]).toBe(focusedButton);
    expect(focusedButton!.focused).toBe(true);
  });

  it("uses compact labels and staggers them only on narrow preview canvases", () => {
    expect(PROSPERITY_TRAFFIC_FISHING_RUNTIME_LABEL).toBe("Fishing · 1×");
    expect(PROSPERITY_TRAFFIC_TRADE_RUNTIME_LABEL).toBe("Trade · 1×");

    const narrow = prosperityTrafficAssetPreviewLayout(420, 600);
    const wide = prosperityTrafficAssetPreviewLayout(900, 600);
    expect(narrow.fishingTargetLabel.y).toBeLessThan(narrow.tradeTargetLabel.y);
    expect(wide.fishingTargetLabel.y).toBe(wide.tradeTargetLabel.y);
    expect(narrow.fishingTarget.x).toBeCloseTo(142.8);
    expect(narrow.tradeTarget.x).toBeCloseTo(277.2);
  });
});
