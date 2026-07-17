import Phaser from "phaser";
import {
  assetWorkspaceSceneKey,
  type WaterAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";

const WATER_STATIC_URL = new URL(
  "../../../../assets-src/gr1/water/runtime/water-static.png",
  import.meta.url,
).href;
const WATER_TRANSITIONS_URL = new URL(
  "../../../../assets-src/gr1/water/runtime/water-depth-transitions.png",
  import.meta.url,
).href;
const WATER_OVERLAYS_URL = new URL(
  "../../../../assets-src/gr1/water/runtime/water-overlays.png",
  import.meta.url,
).href;
const PLAYER_BOAT_URL = "/assets/gr1/images/player-boat.png";
const PLAYER_WAKE_URL = "/assets/gr1/images/player-wake.png";

const TILE_SIZE = 32;
const SHEET_MARGIN = 2;
const SHEET_PITCH = 36;
const STATIC_SHEET_WIDTH = 144;
const STATIC_SHEET_HEIGHT = 288;
const TRANSITION_SHEET_WIDTH = 1_692;
const TRANSITION_SHEET_HEIGHT = 144;
const OVERLAY_SHEET_WIDTH = 288;
const OVERLAY_SHEET_HEIGHT = 144;
const BLEND_WIDTH = 11;
const BLEND_HEIGHT = 7;
const WORLD_WIDTH = 14;
const WORLD_HEIGHT = 9;

const PROFILES = Object.freeze([
  { id: "abyss", label: "Abyss", note: "Quiet far water" },
  { id: "deep", label: "Deep", note: "Open-ocean foundation" },
  { id: "coastal", label: "Coastal", note: "Turquoise shelf" },
  { id: "lagoon", label: "Lagoon", note: "Calm protected water" },
  { id: "reef", label: "Reef", note: "Blocking reef read" },
  { id: "current", label: "Current", note: "Directional accent study" },
  { id: "rough", label: "Rough", note: "Exposed-water study" },
  { id: "brackish", label: "Brackish", note: "Future palette study" },
] as const);

type WaterProfileId = (typeof PROFILES)[number]["id"];
type BlendLayout = "straight" | "corner" | "diagonal" | "channel";

const TRANSITION_MASKS = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 23, 27,
  31, 38, 39, 46, 47, 55, 63, 76, 77, 78, 79, 95, 110, 111, 127, 137,
  139, 141, 143, 155, 159, 175, 191, 205, 207, 223, 239, 255,
]);

export class WaterPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private selectedProfile: WaterProfileId = "deep";
  private variant = 0;
  private layout: BlendLayout = "straight";
  private zoom = 1.5;
  private showOverlays = true;

  constructor(workspace: Readonly<WaterAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.mountWorkspace();
    this.render();
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "Water look prototype — static branch preview";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Water preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser water-preview-browser";
    this.browser.setAttribute("aria-label", "Water prototype controls");
    region.append(this.browser);

    this.stage = document.createElement("section");
    this.stage.className = "water-preview-stage";
    this.stage.setAttribute("aria-label", "Static water look prototype");
    region.append(this.stage);

    const signal = this.controlsAbort.signal;
    this.browser.addEventListener("click", this.onClick, { signal });
    this.browser.addEventListener("input", this.onInput, { signal });
    this.stage.addEventListener("click", this.onClick, { signal });
    slot.classList.add("tool-slot--connected", "water-preview-tools");
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-water-profile]")
      : null;
    const profile = target?.dataset.waterProfile as WaterProfileId | undefined;
    if (profile && PROFILES.some(({ id }) => id === profile)) {
      this.selectedProfile = profile;
      if (target?.dataset.waterVariant !== undefined) {
        this.variant = Math.min(3, Math.max(0, Math.trunc(Number(target.dataset.waterVariant) || 0)));
      }
      this.render();
    }
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    switch (target.dataset.waterControl) {
      case "variant":
        this.variant = Math.min(3, Math.max(0, Math.trunc(Number(target.value) || 0)));
        break;
      case "layout":
        this.layout = isBlendLayout(target.value) ? target.value : "straight";
        break;
      case "zoom":
        this.zoom = [1, 1.5, 2].includes(Number(target.value)) ? Number(target.value) : 1.5;
        break;
      case "overlays":
        if (!(target instanceof HTMLInputElement)) return;
        this.showOverlays = target.checked;
        break;
      default:
        return;
    }
    this.render();
  };

  private render(): void {
    this.renderBrowser();
    this.renderStage();
    this.renderWorkbench();
  }

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">WTR-1.0 branch</p><h2>Water</h2></div>
        <span class="water-preview-badge">Prototype</span>
      </header>
      <div class="water-preview-browser__body">
        <p class="water-preview-intro">Static comparisons for early direction feedback. Nothing here is registered in the game.</p>
        <section class="water-preview-control-group">
          <h3>Selected water</h3>
          <div class="water-preview-profile-list">
            ${PROFILES.map((profile, index) => `
              <button type="button" data-water-profile="${profile.id}" aria-pressed="${profile.id === this.selectedProfile}">
                ${this.tileSprite(index, this.variant, 1)}
                <span><strong>${profile.label}</strong><small>${profile.note}</small></span>
              </button>`).join("")}
          </div>
        </section>
        <section class="water-preview-control-group">
          <h3>Compare</h3>
          <label>Variant <select data-water-control="variant">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${value === this.variant ? "selected" : ""}>${value + 1}</option>`).join("")}</select></label>
          <label>Depth layout <select data-water-control="layout">
            <option value="straight" ${this.layout === "straight" ? "selected" : ""}>Straight shelf</option>
            <option value="corner" ${this.layout === "corner" ? "selected" : ""}>Corner</option>
            <option value="diagonal" ${this.layout === "diagonal" ? "selected" : ""}>Diagonal</option>
            <option value="channel" ${this.layout === "channel" ? "selected" : ""}>Deep channel</option>
          </select></label>
          <label>Preview scale <select data-water-control="zoom">
            <option value="1" ${this.zoom === 1 ? "selected" : ""}>1×</option>
            <option value="1.5" ${this.zoom === 1.5 ? "selected" : ""}>1.5×</option>
            <option value="2" ${this.zoom === 2 ? "selected" : ""}>2×</option>
          </select></label>
          <label class="water-preview-check"><input data-water-control="overlays" type="checkbox" ${this.showOverlays ? "checked" : ""}> Static glints and current</label>
        </section>
      </div>`;
  }

  private renderStage(): void {
    if (!this.stage) return;
    const selectedIndex = profileIndex(this.selectedProfile);
    this.stage.innerHTML = `
      <div class="water-preview-stage__inner">
        <header class="water-preview-hero">
          <div><p class="eyebrow">Early visual feedback</p><h2>How should Wayfinders water feel?</h2></div>
          <div class="water-preview-pills"><span>Static only</span><span>No islands</span><span>No game integration</span></div>
        </header>

        <section class="water-preview-panel water-preview-selected">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">Repeat check</p><h3>${PROFILES[selectedIndex]!.label} · variant ${this.variant + 1}</h3></div><span>3 × 3 tiles</span></div>
          <div class="water-preview-repeat">${Array.from({ length: 9 }, () => this.tileSprite(selectedIndex, this.variant, 2)).join("")}</div>
          <div class="water-preview-variant-strip" aria-label="${PROFILES[selectedIndex]!.label} variants">
            ${[0, 1, 2, 3].map((variant) => `<button type="button" data-water-profile="${this.selectedProfile}" data-water-variant="${variant}" title="Variant ${variant + 1}" aria-label="Use variant ${variant + 1}">${this.tileSprite(selectedIndex, variant, 2)}</button>`).join("")}
          </div>
        </section>

        <section class="water-preview-panel">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">Candidate sheet</p><h3>Static tile directions</h3></div><span>8 profiles · 4 variants</span></div>
          <div class="water-preview-gallery">
            ${PROFILES.map((profile, index) => `
              <article class="water-preview-card" data-selected="${profile.id === this.selectedProfile}">
                <button type="button" data-water-profile="${profile.id}"><strong>${profile.label}</strong><small>${profile.note}</small></button>
                <div>${[0, 1, 2, 3].map((variant) => this.tileSprite(index, variant, 2)).join("")}</div>
              </article>`).join("")}
          </div>
        </section>

        <section class="water-preview-panel">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">Depth study</p><h3>${layoutLabel(this.layout)}</h3></div><span>Deep → coastal</span></div>
          <div class="water-preview-blend-wrap">
            <div class="water-preview-blend" style="grid-template-columns:repeat(${BLEND_WIDTH}, ${TILE_SIZE * this.zoom}px)">
              ${this.blendCells(BLEND_WIDTH, BLEND_HEIGHT, this.layout, this.zoom)}
            </div>
            <div class="water-preview-legend"><span><i data-water="deep"></i>Deep</span><span><i data-water="coastal"></i>Coastal</span><span><i data-water="transition"></i>Blended edge</span></div>
          </div>
        </section>

        <section class="water-preview-panel">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">Game-scale impression</p><h3>Open water with the player boat</h3></div><span>Fixed visual fixture</span></div>
          <div class="water-preview-world-wrap">
            <div class="water-preview-world" style="grid-template-columns:repeat(${WORLD_WIDTH}, ${TILE_SIZE * this.zoom}px)">
              ${this.worldCells(this.zoom)}
              <img class="water-preview-wake" src="${PLAYER_WAKE_URL}" alt="">
              <img class="water-preview-boat" src="${PLAYER_BOAT_URL}" alt="Player boat">
            </div>
          </div>
        </section>
      </div>`;
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    slot.innerHTML = `
      <section class="water-preview-workbench">
        <header><div><p class="eyebrow">Feedback target</p><h3>Base water direction</h3></div><span>WTR-1.0</span></header>
        <p>Compare texture density, palette, repeated seams, and whether depth changes read clearly beside the current boat.</p>
        <dl>
          <div><dt>Profile</dt><dd>${PROFILES[profileIndex(this.selectedProfile)]!.label}</dd></div>
          <div><dt>Variant</dt><dd>${this.variant + 1}</dd></div>
          <div><dt>Blend</dt><dd>${layoutLabel(this.layout)}</dd></div>
          <div><dt>Motion</dt><dd>Static</dd></div>
        </dl>
        <section><h4>Deliberately deferred</h4><ul><li>Island and shoreline blending</li><li>Animation foundation</li><li>Runtime catalog and game renderer</li><li>Production validation and promotion</li></ul></section>
        <p class="water-preview-readonly">This branch preview can be revised or discarded after the preferred visual direction is recorded.</p>
      </section>`;
  }

  private tileSprite(profile: number, variant: number, scale: number): string {
    return `<span class="water-preview-tile" aria-hidden="true" style="${staticTileStyle(profile, variant, scale)}"></span>`;
  }

  private blendCells(width: number, height: number, layout: BlendLayout, scale: number): string {
    const isShallow = (x: number, y: number): boolean => layoutShallow(layout, x, y, width, height);
    const cells: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const style = isShallow(x, y)
          ? staticTileStyle(profileIndex("coastal"), (x + y) % 4, scale)
          : transitionOrDeepStyle(x, y, isShallow, scale);
        cells.push(`<span class="water-preview-blend-cell" aria-hidden="true" style="${style}"></span>`);
      }
    }
    return cells.join("");
  }

  private worldCells(scale: number): string {
    const cells: string[] = [];
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const profile = y < 2 ? profileIndex("abyss") : profileIndex("deep");
        const variant = (x * 3 + y * 5) % 4;
        const overlayRow = Math.abs((x - y * 2) % 11) <= 1 ? 2 : (x + y * 3) % 13 === 0 ? 0 : -1;
        cells.push(`<span class="water-preview-world-cell" aria-hidden="true" style="${staticTileStyle(profile, variant, scale)}">${this.showOverlays && overlayRow >= 0 ? `<i style="${overlayStyle(overlayRow, scale)}"></i>` : ""}</span>`);
      }
    }
    return cells.join("");
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.browser?.remove();
    this.browser = undefined;
    this.stage?.remove();
    this.stage = undefined;
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) {
      slot.replaceChildren();
      slot.classList.remove("tool-slot--connected", "water-preview-tools");
    }
  }
}

function profileIndex(id: WaterProfileId): number {
  return PROFILES.findIndex((profile) => profile.id === id);
}

function isBlendLayout(value: string): value is BlendLayout {
  return value === "straight" || value === "corner" || value === "diagonal" || value === "channel";
}

function layoutLabel(layout: BlendLayout): string {
  switch (layout) {
    case "straight": return "Straight shelf";
    case "corner": return "Corner transition";
    case "diagonal": return "Diagonal transition";
    case "channel": return "Deep channel";
  }
}

function layoutShallow(layout: BlendLayout, x: number, y: number, width: number, height: number): boolean {
  switch (layout) {
    case "straight": return x >= Math.ceil(width * 0.55);
    case "corner": return x >= Math.ceil(width * 0.52) && y >= Math.ceil(height * 0.42);
    case "diagonal": return x + y >= Math.ceil((width + height) * 0.58);
    case "channel": return x <= 2 || x >= width - 3;
  }
}

function staticTileStyle(profile: number, variant: number, scale: number): string {
  const width = TILE_SIZE * scale;
  const x = -(SHEET_MARGIN + variant * SHEET_PITCH) * scale;
  const y = -(SHEET_MARGIN + profile * SHEET_PITCH) * scale;
  return `width:${width}px;height:${width}px;background-image:url('${WATER_STATIC_URL}');background-size:${STATIC_SHEET_WIDTH * scale}px ${STATIC_SHEET_HEIGHT * scale}px;background-position:${x}px ${y}px`;
}

function transitionOrDeepStyle(
  x: number,
  y: number,
  isShallow: (x: number, y: number) => boolean,
  scale: number,
): string {
  let mask = 0;
  if (isShallow(x, y - 1)) mask |= 1;
  if (isShallow(x + 1, y)) mask |= 2;
  if (isShallow(x, y + 1)) mask |= 4;
  if (isShallow(x - 1, y)) mask |= 8;
  if (isShallow(x + 1, y - 1)) mask |= 16;
  if (isShallow(x + 1, y + 1)) mask |= 32;
  if (isShallow(x - 1, y + 1)) mask |= 64;
  if (isShallow(x - 1, y - 1)) mask |= 128;
  mask = canonicalMask(mask);
  const maskIndex = TRANSITION_MASKS.indexOf(mask);
  if (maskIndex <= 0) return staticTileStyle(profileIndex("deep"), (x * 3 + y) % 4, scale);
  const width = TILE_SIZE * scale;
  const sourceX = -(SHEET_MARGIN + maskIndex * SHEET_PITCH) * scale;
  const sourceY = -SHEET_MARGIN * scale;
  return `width:${width}px;height:${width}px;background-image:url('${WATER_TRANSITIONS_URL}');background-size:${TRANSITION_SHEET_WIDTH * scale}px ${TRANSITION_SHEET_HEIGHT * scale}px;background-position:${sourceX}px ${sourceY}px`;
}

function canonicalMask(mask: number): number {
  const north = (mask & 1) !== 0;
  const east = (mask & 2) !== 0;
  const south = (mask & 4) !== 0;
  const west = (mask & 8) !== 0;
  let canonical = mask & 15;
  if (north && east && (mask & 16)) canonical |= 16;
  if (east && south && (mask & 32)) canonical |= 32;
  if (south && west && (mask & 64)) canonical |= 64;
  if (west && north && (mask & 128)) canonical |= 128;
  return canonical;
}

function overlayStyle(row: number, scale: number): string {
  const width = TILE_SIZE * scale;
  const x = -SHEET_MARGIN * scale;
  const y = -(SHEET_MARGIN + row * SHEET_PITCH) * scale;
  return `width:${width}px;height:${width}px;background-image:url('${WATER_OVERLAYS_URL}');background-size:${OVERLAY_SHEET_WIDTH * scale}px ${OVERLAY_SHEET_HEIGHT * scale}px;background-position:${x}px ${y}px`;
}
