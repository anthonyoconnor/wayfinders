import {
  PROSPERITY_TRAFFIC_ASSET_CATALOG,
  type ProsperityTrafficAssetId,
} from "./ProsperityTrafficAssetCatalog";

export const PROSPERITY_TRAFFIC_FISHING_RUNTIME_LABEL = "Fishing · 1×";
export const PROSPERITY_TRAFFIC_TRADE_RUNTIME_LABEL = "Trade · 1×";

interface TrafficAssetSelectionButton {
  readonly dataset: Readonly<{ trafficAsset?: string }>;
  setAttribute(name: string, value: string): void;
}

export interface ProsperityTrafficAssetPreviewLayout {
  readonly inspectionScale: number;
  readonly selected: Readonly<{ x: number; y: number }>;
  readonly title: Readonly<{ x: number; y: number }>;
  readonly subtitle: Readonly<{ x: number; y: number }>;
  readonly fishingTarget: Readonly<{ x: number; y: number }>;
  readonly tradeTarget: Readonly<{ x: number; y: number }>;
  readonly fishingTargetLabel: Readonly<{ x: number; y: number }>;
  readonly tradeTargetLabel: Readonly<{ x: number; y: number }>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Stable catalog markup; selection changes update these buttons in place. */
export function prosperityTrafficAssetBrowserMarkup(
  selectedId: ProsperityTrafficAssetId,
): string {
  return `
    <header class="asset-library-header">
      <div><p class="eyebrow">Prosperity traffic</p><h2>Ship traffic</h2></div>
      <span>${PROSPERITY_TRAFFIC_ASSET_CATALOG.length} assets</span>
    </header>
    <div class="traffic-preview-browser__body">
      <p>The real code-native craft used by returned fishing and community-island routes.</p>
      <ul class="traffic-preview-list">
        ${PROSPERITY_TRAFFIC_ASSET_CATALOG.map((asset) => `
          <li>
            <button
              type="button"
              data-traffic-asset="${asset.id}"
              aria-pressed="${asset.id === selectedId}"
            >
              <span class="traffic-preview-glyph" data-traffic-kind="${asset.kind}" aria-hidden="true"></span>
              <span><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.role)}</small></span>
            </button>
          </li>
        `).join("")}
      </ul>
      <p class="traffic-preview-reference-note">Direction A concept studies remain reference-only; this tab renders the shipped presentation geometry.</p>
    </div>`;
}

/** Updates only selection attributes, preserving every button node and current focus. */
export function syncProsperityTrafficAssetBrowserSelection(
  buttons: Iterable<Readonly<TrafficAssetSelectionButton>>,
  selectedId: ProsperityTrafficAssetId,
): void {
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.trafficAsset === selectedId));
  }
}

/** Canvas-relative positions with staggered compact captions on narrow stages. */
export function prosperityTrafficAssetPreviewLayout(
  width: number,
  height: number,
): Readonly<ProsperityTrafficAssetPreviewLayout> {
  const narrow = width < 560;
  const labelY = height * 0.82;
  return Object.freeze({
    inspectionScale: Math.max(2.6, Math.min(4, Math.min(width / 220, height / 150))),
    selected: Object.freeze({ x: width * 0.5, y: height * 0.35 }),
    title: Object.freeze({ x: width * 0.5, y: height * 0.13 }),
    subtitle: Object.freeze({ x: width * 0.5, y: height * 0.19 }),
    fishingTarget: Object.freeze({ x: width * 0.34, y: height * 0.73 }),
    tradeTarget: Object.freeze({ x: width * 0.66, y: height * 0.73 }),
    fishingTargetLabel: Object.freeze({
      x: width * 0.34,
      y: labelY - (narrow ? 10 : 0),
    }),
    tradeTargetLabel: Object.freeze({
      x: width * 0.66,
      y: labelY + (narrow ? 10 : 0),
    }),
  });
}
