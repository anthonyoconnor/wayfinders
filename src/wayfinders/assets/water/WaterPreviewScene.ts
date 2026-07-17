import Phaser from "phaser";
import {
  assetWorkspaceSceneKey,
  type WaterAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";

const WATER_STATIC_URL = new URL(
  "../../../../assets-src/gr1/water/runtime/water-static.png",
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
const WORLD_GRID_SIZE = 96;

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

export class WaterPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private selectedProfile: WaterProfileId = "deep";
  private variant = 0;
  private worldCellSize = 4;
  private showOverlays = true;
  private renderRevision = 0;

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
      case "world-scale":
        this.worldCellSize = [4, 8, 12].includes(Number(target.value)) ? Number(target.value) : 4;
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
          <label>World scale <select data-water-control="world-scale">
            <option value="4" ${this.worldCellSize === 4 ? "selected" : ""}>Overview</option>
            <option value="8" ${this.worldCellSize === 8 ? "selected" : ""}>Medium</option>
            <option value="12" ${this.worldCellSize === 12 ? "selected" : ""}>Detail</option>
          </select></label>
          <label class="water-preview-check"><input data-water-control="overlays" type="checkbox" ${this.showOverlays ? "checked" : ""}> Currents, rough water, and glints</label>
        </section>
      </div>`;
  }

  private renderStage(): void {
    if (!this.stage) return;
    const selectedIndex = profileIndex(this.selectedProfile);
    const revision = ++this.renderRevision;
    const worldPixels = WORLD_GRID_SIZE * this.worldCellSize;
    this.stage.innerHTML = `
      <div class="water-preview-stage__inner">
        <header class="water-preview-hero">
          <div><p class="eyebrow">Early visual feedback</p><h2>How should Wayfinders water feel?</h2></div>
          <div class="water-preview-pills"><span>Static only</span><span>No islands</span><span>No game integration</span></div>
        </header>

        <section class="water-preview-panel water-preview-world-study">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">96 × 96 world study</p><h3>All water treatments in context</h3></div><span>Multi-cell static blends</span></div>
          <p class="water-preview-world-note">A full prototype-scale water world: abyss and deep ocean, coastal shelves, calm lagoons, reef fields, a current ribbon, rough water, and a future brackish study. Regions are intentionally broad so the transitions can be judged as a world composition rather than one enlarged tile edge.</p>
          <div class="water-preview-world-wrap">
            <canvas class="water-preview-world-map" data-water-world width="${worldPixels}" height="${worldPixels}" aria-label="World-scale map showing every water treatment"></canvas>
          </div>
          <div class="water-preview-world-legend" aria-label="World water legend">
            ${PROFILES.map((profile) => `<span><i data-water="${profile.id}"></i>${profile.label}${profile.id === "brackish" ? " · future" : profile.id === "current" || profile.id === "rough" ? " · visual" : ""}</span>`).join("")}
          </div>
        </section>

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

      </div>`;
    void this.renderWorldCanvas(revision);
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    slot.innerHTML = `
      <section class="water-preview-workbench">
        <header><div><p class="eyebrow">Feedback target</p><h3>Base water direction</h3></div><span>WTR-1.0</span></header>
        <p>Compare the full-world distribution, multi-cell profile handoffs, texture density, and whether every treatment has a clear role.</p>
        <dl>
          <div><dt>Profile</dt><dd>${PROFILES[profileIndex(this.selectedProfile)]!.label}</dd></div>
          <div><dt>Variant</dt><dd>${this.variant + 1}</dd></div>
          <div><dt>World</dt><dd>96 × 96</dd></div>
          <div><dt>Blend</dt><dd>Multi-cell crossfade</dd></div>
          <div><dt>Motion</dt><dd>Static</dd></div>
        </dl>
        <section><h4>Deliberately deferred</h4><ul><li>Island and shoreline blending</li><li>Animation foundation</li><li>Runtime catalog and game renderer</li><li>Production validation and promotion</li></ul></section>
        <p class="water-preview-readonly">This branch preview can be revised or discarded after the preferred visual direction is recorded.</p>
      </section>`;
  }

  private tileSprite(profile: number, variant: number, scale: number): string {
    return `<span class="water-preview-tile" aria-hidden="true" style="${staticTileStyle(profile, variant, scale)}"></span>`;
  }

  private async renderWorldCanvas(revision: number): Promise<void> {
    const canvas = this.stage?.querySelector<HTMLCanvasElement>("[data-water-world]");
    if (!canvas) return;
    const [staticSheet, overlaySheet, boat, wake] = await Promise.all([
      loadPreviewImage(WATER_STATIC_URL),
      loadPreviewImage(WATER_OVERLAYS_URL),
      loadPreviewImage(PLAYER_BOAT_URL),
      loadPreviewImage(PLAYER_WAKE_URL),
    ]);
    if (revision !== this.renderRevision || !canvas.isConnected) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const cell = this.worldCellSize;
    context.fillStyle = "#082f40";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < WORLD_GRID_SIZE; y++) {
      for (let x = 0; x < WORLD_GRID_SIZE; x++) {
        const variant = coordinateVariant(x, y);
        const px = x * cell;
        const py = y * cell;

        drawProfileTile(context, staticSheet, "deep", variant, px, py, cell, 1);
        const abyssAlpha = clamp01((48 - x - y + Math.sin(y * 0.22) * 5) / 22);
        drawProfileTile(context, staticSheet, "abyss", variant, px, py, cell, abyssAlpha);

        const shelfDistance = Math.min(
          ellipseDistance(x, y, 69, 62, 30, 24),
          ellipseDistance(x, y, 28, 72, 18, 14),
        ) + Math.sin(x * 0.27 + y * 0.19) * 0.055;
        const coastalAlpha = 1 - smoothstep(-0.2, 0.22, shelfDistance);
        const lagoonAlpha = 1 - smoothstep(-0.72, -0.38, shelfDistance);
        drawProfileTile(context, staticSheet, "coastal", variant, px, py, cell, coastalAlpha);
        drawProfileTile(context, staticSheet, "lagoon", variant, px, py, cell, lagoonAlpha);

        const brackishDistance = ellipseDistance(x, y, 17, 84, 13, 8);
        const brackishAlpha = 1 - smoothstep(-0.2, 0.18, brackishDistance);
        drawProfileTile(context, staticSheet, "brackish", variant, px, py, cell, brackishAlpha);

        const reefAlpha = reefIntensity(x, y);
        drawProfileTile(context, staticSheet, "reef", variant, px, py, cell, reefAlpha);

        if (this.showOverlays) {
          const currentY = 38 + Math.sin(x * 0.12) * 5;
          const currentAlpha = 1 - smoothstep(0.7, 3.2, Math.abs(y - currentY));
          drawProfileTile(context, staticSheet, "current", variant, px, py, cell, currentAlpha * 0.22);
          drawOverlayTile(context, overlaySheet, 2, variant, px, py, cell, currentAlpha * 0.88);

          const roughDistance = ellipseDistance(x, y, 75, 19, 18, 9);
          const roughAlpha = 1 - smoothstep(-0.25, 0.18, roughDistance);
          drawProfileTile(context, staticSheet, "rough", variant, px, py, cell, roughAlpha * 0.34);
          drawOverlayTile(context, overlaySheet, 3, variant, px, py, cell, roughAlpha * 0.82);

          if (coordinateHash(x, y) % 29 === 0) {
            drawOverlayTile(context, overlaySheet, 0, variant, px, py, cell, 0.72);
          }
        }
      }
    }

    drawWorldLabel(context, "ABYSS", 8, 10, cell);
    drawWorldLabel(context, "DEEP OCEAN", 41, 17, cell);
    drawWorldLabel(context, "ROUGH · VISUAL", 75, 13, cell);
    drawWorldLabel(context, "CURRENT · VISUAL", 47, 37, cell);
    drawWorldLabel(context, "COASTAL SHELF", 69, 48, cell);
    drawWorldLabel(context, "LAGOON", 72, 64, cell);
    drawWorldLabel(context, "REEF", 58, 55, cell);
    drawWorldLabel(context, "BRACKISH · FUTURE", 17, 84, cell);

    const boatSize = cell * 4;
    const boatX = cell * 44;
    const boatY = cell * 52;
    context.globalAlpha = 0.82;
    context.drawImage(wake, boatX - cell * 3.3, boatY - cell * 2, cell * 6, boatSize);
    context.globalAlpha = 1;
    context.drawImage(boat, boatX - cell * 2, boatY - cell * 2, boatSize, boatSize);
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

function staticTileStyle(profile: number, variant: number, scale: number): string {
  const width = TILE_SIZE * scale;
  const x = -(SHEET_MARGIN + variant * SHEET_PITCH) * scale;
  const y = -(SHEET_MARGIN + profile * SHEET_PITCH) * scale;
  return `width:${width}px;height:${width}px;background-image:url('${WATER_STATIC_URL}');background-size:${STATIC_SHEET_WIDTH * scale}px ${STATIC_SHEET_HEIGHT * scale}px;background-position:${x}px ${y}px`;
}

const previewImages = new Map<string, Promise<HTMLImageElement>>();

function loadPreviewImage(url: string): Promise<HTMLImageElement> {
  const existing = previewImages.get(url);
  if (existing) return existing;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Could not load water preview image ${url}`)), { once: true });
    image.src = url;
  });
  previewImages.set(url, pending);
  return pending;
}

function drawProfileTile(
  context: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  profile: WaterProfileId,
  variant: number,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  context.globalAlpha = clamp01(alpha);
  context.drawImage(
    sheet,
    SHEET_MARGIN + variant * SHEET_PITCH,
    SHEET_MARGIN + profileIndex(profile) * SHEET_PITCH,
    TILE_SIZE,
    TILE_SIZE,
    x,
    y,
    size,
    size,
  );
  context.globalAlpha = 1;
}

function drawOverlayTile(
  context: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  row: number,
  variant: number,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  context.globalAlpha = clamp01(alpha);
  context.drawImage(
    sheet,
    SHEET_MARGIN + (variant % 4) * SHEET_PITCH,
    SHEET_MARGIN + row * SHEET_PITCH,
    TILE_SIZE,
    TILE_SIZE,
    x,
    y,
    size,
    size,
  );
  context.globalAlpha = 1;
}

function coordinateVariant(x: number, y: number): number {
  return coordinateHash(x, y) % 4;
}

function coordinateHash(x: number, y: number): number {
  let value = Math.imul(x + 17, 0x45d9f3b) ^ Math.imul(y + 31, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function ellipseDistance(x: number, y: number, centerX: number, centerY: number, radiusX: number, radiusY: number): number {
  return Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY) - 1;
}

function reefIntensity(x: number, y: number): number {
  const clusters = [
    [59, 52, 5],
    [79, 55, 4],
    [60, 75, 5],
    [34, 68, 4],
  ] as const;
  const distance = Math.min(...clusters.map(([cx, cy, radius]) => Math.hypot(x - cx, y - cy) / radius));
  return (1 - smoothstep(0.48, 1.08, distance)) * 0.92;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function drawWorldLabel(context: CanvasRenderingContext2D, label: string, tileX: number, tileY: number, cell: number): void {
  const fontSize = Math.max(9, Math.round(cell * 0.78));
  context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.textBaseline = "middle";
  const metrics = context.measureText(label);
  const x = tileX * cell;
  const y = tileY * cell;
  context.fillStyle = "rgba(3, 19, 25, 0.82)";
  context.fillRect(x - 4, y - fontSize, metrics.width + 8, fontSize * 1.8);
  context.fillStyle = "#d9f1e7";
  context.fillText(label, x, y);
}
