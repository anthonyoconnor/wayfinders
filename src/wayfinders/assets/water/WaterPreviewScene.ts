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
const HOME_ISLAND_URL = "/assets/gr1/images/home-island.png";
const HORSESHOE_ISLAND_URL = new URL(
  "../../../../assets-src/gr3/candidates/production-island-horseshoe/base.png",
  import.meta.url,
).href;
const RIVER_DELTA_ISLAND_URL = new URL(
  "../../../../assets-src/gr3/candidates/production-island-river-delta-inhabited/base.png",
  import.meta.url,
).href;

const TILE_SIZE = 32;
const SHEET_MARGIN = 2;
const SHEET_PITCH = 36;
const STATIC_SHEET_WIDTH = 144;
const STATIC_SHEET_HEIGHT = 288;
const WORLD_GRID_SIZE = 96;
const WORLD_CELL_SIZES = Object.freeze([4, 8, 12, 16, 24, 32]);

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
type ShoalStrength = "lean" | "steady" | "rich";

interface IslandPlacement {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ShoalPlacement {
  readonly id: string;
  readonly profile: WaterProfileId;
  readonly strength: ShoalStrength;
  readonly x: number;
  readonly y: number;
}

interface ShoalStrengthVisual {
  readonly strength: ShoalStrength;
  readonly label: string;
  readonly note: string;
  readonly url: string;
  readonly intensity: number;
  readonly pulseSpeed: number;
}

interface ShorePoint {
  readonly x: number;
  readonly y: number;
  readonly nx: number;
  readonly ny: number;
  readonly exposure: number;
  readonly phase: number;
}

interface WaterWorldModel {
  readonly land: Uint8Array;
  readonly distanceFromLand: Float32Array;
  readonly shore: readonly ShorePoint[];
}

const ISLANDS: readonly IslandPlacement[] = Object.freeze([
  { id: "home", label: "Home Island", url: HOME_ISLAND_URL, x: 56, y: 58, width: 23, height: 23 },
  { id: "horseshoe", label: "Horseshoe", url: HORSESHOE_ISLAND_URL, x: 17, y: 59, width: 22, height: 22 },
  { id: "river-delta", label: "River Delta", url: RIVER_DELTA_ISLAND_URL, x: 62, y: 27, width: 22, height: 22 },
]);

const SHOAL_STRENGTHS: readonly ShoalStrengthVisual[] = Object.freeze([
  {
    strength: "lean",
    label: "Lean fishing ground",
    note: "Sparse glints · faint surface breaks",
    url: new URL("../../../../assets-src/gr1/water/prototype/shoals/shoal-lean.png", import.meta.url).href,
    intensity: 0.48,
    pulseSpeed: 0.55,
  },
  {
    strength: "steady",
    label: "Steady fishing ground",
    note: "Regular ripples · moderate activity",
    url: new URL("../../../../assets-src/gr1/water/prototype/shoals/shoal-steady.png", import.meta.url).href,
    intensity: 0.72,
    pulseSpeed: 0.78,
  },
  {
    strength: "rich",
    label: "Rich fishing ground",
    note: "Bright churn · strong surface breaks",
    url: new URL("../../../../assets-src/gr1/water/prototype/shoals/shoal-rich.png", import.meta.url).href,
    intensity: 0.92,
    pulseSpeed: 1.05,
  },
]);

const SHOALS: readonly ShoalPlacement[] = Object.freeze([
  { id: "abyss-lean", profile: "abyss", strength: "lean", x: 11, y: 13 },
  { id: "deep-steady", profile: "deep", strength: "steady", x: 39, y: 16 },
  { id: "coastal-rich", profile: "coastal", strength: "rich", x: 83, y: 66 },
  { id: "lagoon-lean", profile: "lagoon", strength: "lean", x: 45, y: 84 },
  { id: "reef-steady", profile: "reef", strength: "steady", x: 48, y: 69 },
  { id: "current-rich", profile: "current", strength: "rich", x: 34, y: 39 },
  { id: "rough-steady", profile: "rough", strength: "steady", x: 78, y: 15 },
  { id: "brackish-lean", profile: "brackish", strength: "lean", x: 12, y: 86 },
]);

export class WaterPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private toolsPanel?: HTMLElement;
  private selectedProfile: WaterProfileId = "deep";
  private variant = 0;
  private worldCellSize = 4;
  private showOverlays = true;
  private motionPaused = false;
  private renderRevision = 0;
  private animationFrame?: number;

  constructor(workspace: Readonly<WaterAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.mountWorkspace();
    this.render();
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "Animated water, islands, and shoals — asset-viewer prototype";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    const toolsPanel = document.querySelector<HTMLElement>("#developer-tools-panel");
    if (!region || !slot || !toolsPanel) throw new Error("Water preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser water-preview-browser";
    this.browser.setAttribute("aria-label", "Water prototype controls");
    region.append(this.browser);

    this.stage = document.createElement("section");
    this.stage.className = "water-preview-stage";
    this.stage.setAttribute("aria-label", "Animated water look prototype");
    region.append(this.stage);

    const signal = this.controlsAbort.signal;
    this.browser.addEventListener("click", this.onClick, { signal });
    this.browser.addEventListener("input", this.onInput, { signal });
    this.stage.addEventListener("click", this.onClick, { signal });
    slot.replaceChildren();
    toolsPanel.hidden = true;
    this.toolsPanel = toolsPanel;
    document.documentElement.classList.add("water-preview-active");
  }

  private readonly onClick = (event: Event): void => {
    const motionTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-water-motion]")
      : null;
    if (motionTarget) {
      this.motionPaused = !this.motionPaused;
      this.render();
      return;
    }

    const zoomTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-water-zoom]")
      : null;
    const zoomAction = zoomTarget?.dataset.waterZoom;
    if (zoomAction) {
      const currentIndex = WORLD_CELL_SIZES.indexOf(this.worldCellSize);
      if (zoomAction === "in") {
        this.worldCellSize = WORLD_CELL_SIZES[Math.min(WORLD_CELL_SIZES.length - 1, currentIndex + 1)]!;
      } else if (zoomAction === "out") {
        this.worldCellSize = WORLD_CELL_SIZES[Math.max(0, currentIndex - 1)]!;
      } else if (zoomAction === "fit") {
        this.worldCellSize = WORLD_CELL_SIZES[0]!;
      } else if (zoomAction === "game") {
        this.worldCellSize = TILE_SIZE;
      } else {
        return;
      }
      this.render();
      return;
    }

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
        this.worldCellSize = WORLD_CELL_SIZES.includes(Number(target.value)) ? Number(target.value) : 4;
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
  }

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">WTR-1.0–1.5 branch</p><h2>Water</h2></div>
        <span class="water-preview-badge">Prototype</span>
      </header>
      <div class="water-preview-browser__body">
        <p class="water-preview-intro">A branch-only playground for animated water, island transitions, shoreline waves, and fishing shoals. Nothing here is registered in the game.</p>
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
            <option value="4" ${this.worldCellSize === 4 ? "selected" : ""}>Fit overview · 13%</option>
            <option value="8" ${this.worldCellSize === 8 ? "selected" : ""}>Quarter scale · 25%</option>
            <option value="12" ${this.worldCellSize === 12 ? "selected" : ""}>Inspect · 38%</option>
            <option value="16" ${this.worldCellSize === 16 ? "selected" : ""}>Half scale · 50%</option>
            <option value="24" ${this.worldCellSize === 24 ? "selected" : ""}>Close detail · 75%</option>
            <option value="32" ${this.worldCellSize === 32 ? "selected" : ""}>Game scale · 100%</option>
          </select></label>
          <label class="water-preview-check"><input data-water-control="overlays" type="checkbox" ${this.showOverlays ? "checked" : ""}> Currents, rough water, and glints</label>
        </section>
      </div>`;
  }

  private renderStage(): void {
    if (!this.stage) return;
    const previousViewport = this.captureWorldViewport();
    const selectedIndex = profileIndex(this.selectedProfile);
    const revision = ++this.renderRevision;
    const worldPixels = WORLD_GRID_SIZE * this.worldCellSize;
    const zoomPercent = Math.round((this.worldCellSize / TILE_SIZE) * 100);
    const zoomIndex = WORLD_CELL_SIZES.indexOf(this.worldCellSize);
    this.stage.innerHTML = `
      <div class="water-preview-stage__inner">
        <header class="water-preview-hero">
          <div><p class="eyebrow">Early visual feedback</p><h2>How should Wayfinders water feel?</h2></div>
          <div class="water-preview-pills"><span>Animated</span><span>3 islands</span><span>3 shoal strengths</span><span>No game integration</span></div>
        </header>

        <section class="water-preview-panel water-preview-world-study">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">96 × 96 world study</p><h3>Water, islands, and shoals in context</h3></div><span>WTR-1.0–1.5 prototype</span></div>
          <p class="water-preview-world-note">A game-sized visual study with irregular island-driven shallows, exposed and sheltered shoreline waves, wind, currents, rough water, and lean, steady, and rich fishing grounds. Shoals use abstract surface disturbance at the same 96×64 scale as the existing game cue—never visible fish.</p>
          <div class="water-preview-zoom" role="group" aria-label="Water world zoom controls">
            <button type="button" data-water-zoom="out" aria-label="Zoom out" ${zoomIndex === 0 ? "disabled" : ""}>−</button>
            <output aria-live="polite">${zoomPercent}%${this.worldCellSize === TILE_SIZE ? " · game scale" : ""}</output>
            <button type="button" data-water-zoom="in" aria-label="Zoom in" ${zoomIndex === WORLD_CELL_SIZES.length - 1 ? "disabled" : ""}>+</button>
            <button type="button" data-water-zoom="fit">Fit</button>
            <button type="button" data-water-zoom="game">1:1 Game</button>
            <button type="button" data-water-motion aria-pressed="${this.motionPaused}">${this.motionPaused ? "Play motion" : "Pause motion"}</button>
          </div>
          <div class="water-preview-world-wrap">
            <div class="water-preview-world-stack" style="width:${worldPixels}px;height:${worldPixels}px">
              <canvas class="water-preview-world-map" data-water-world width="${worldPixels}" height="${worldPixels}" aria-label="World-scale map showing every water treatment, islands, and fishing shoals"></canvas>
              <canvas class="water-preview-world-motion" data-water-world-motion width="${worldPixels}" height="${worldPixels}" aria-hidden="true"></canvas>
            </div>
          </div>
          <div class="water-preview-world-legend" aria-label="World water legend">
            ${PROFILES.map((profile) => `<span><i data-water="${profile.id}"></i>${profile.label}${profile.id === "brackish" ? " · future" : profile.id === "current" || profile.id === "rough" ? " · visual" : ""}</span>`).join("")}
          </div>
        </section>

        <section class="water-preview-panel">
          <div class="water-preview-panel__heading"><div><p class="eyebrow">Fishing shoals</p><h3>Three gameplay strengths</h3></div><span>96×64 surface cues · no visible fish</span></div>
          <div class="water-preview-shoal-gallery">
            ${SHOAL_STRENGTHS.map((shoal) => `
              <article class="water-preview-shoal-card">
                <div data-shoal-strength="${shoal.strength}"><img src="${shoal.url}" alt="${shoal.label} surface disturbance"></div>
                <strong>${shoal.label}</strong><small>${shoal.note}</small>
              </article>`).join("")}
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
    this.restoreWorldViewport(previousViewport);
    void this.renderWorldCanvas(revision);
  }

  private tileSprite(profile: number, variant: number, scale: number): string {
    return `<span class="water-preview-tile" aria-hidden="true" style="${staticTileStyle(profile, variant, scale)}"></span>`;
  }

  private captureWorldViewport(): { readonly x: number; readonly y: number } | undefined {
    const wrap = this.stage?.querySelector<HTMLElement>(".water-preview-world-wrap");
    if (!wrap || wrap.scrollWidth <= 0 || wrap.scrollHeight <= 0) return undefined;
    return {
      x: (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth,
      y: (wrap.scrollTop + wrap.clientHeight / 2) / wrap.scrollHeight,
    };
  }

  private restoreWorldViewport(viewport: { readonly x: number; readonly y: number } | undefined): void {
    if (!viewport) return;
    const wrap = this.stage?.querySelector<HTMLElement>(".water-preview-world-wrap");
    if (!wrap) return;
    wrap.scrollLeft = viewport.x * wrap.scrollWidth - wrap.clientWidth / 2;
    wrap.scrollTop = viewport.y * wrap.scrollHeight - wrap.clientHeight / 2;
  }

  private async renderWorldCanvas(revision: number): Promise<void> {
    const canvas = this.stage?.querySelector<HTMLCanvasElement>("[data-water-world]");
    const motionCanvas = this.stage?.querySelector<HTMLCanvasElement>("[data-water-world-motion]");
    if (!canvas || !motionCanvas) return;
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    const [staticSheet, overlaySheet, boat, wake, ...prototypeImages] = await Promise.all([
      loadPreviewImage(WATER_STATIC_URL),
      loadPreviewImage(WATER_OVERLAYS_URL),
      loadPreviewImage(PLAYER_BOAT_URL),
      loadPreviewImage(PLAYER_WAKE_URL),
      ...ISLANDS.map(({ url }) => loadPreviewImage(url)),
      ...SHOAL_STRENGTHS.map(({ url }) => loadPreviewImage(url)),
    ]);
    if (revision !== this.renderRevision || !canvas.isConnected || !motionCanvas.isConnected) return;
    const context = canvas.getContext("2d");
    const motionContext = motionCanvas.getContext("2d");
    if (!context || !motionContext) return;
    const islandImages = prototypeImages.slice(0, ISLANDS.length);
    const shoalImages = prototypeImages.slice(ISLANDS.length);
    const model = buildWorldModel(islandImages);
    context.imageSmoothingEnabled = false;
    motionContext.imageSmoothingEnabled = false;
    const cell = this.worldCellSize;
    drawStaticWorld(context, staticSheet, boat, wake, islandImages, model, cell, this.showOverlays);

    const startedAt = performance.now();
    let lastRenderedAt = Number.NEGATIVE_INFINITY;
    const frameInterval = cell >= 24 ? 100 : 72;
    const renderMotion = (now: number): void => {
      if (revision !== this.renderRevision || !motionCanvas.isConnected) return;
      if (now - lastRenderedAt < frameInterval) {
        if (!this.motionPaused) this.animationFrame = requestAnimationFrame(renderMotion);
        return;
      }
      lastRenderedAt = now;
      drawWorldMotion(
        motionContext,
        overlaySheet,
        shoalImages,
        model,
        cell,
        this.showOverlays,
        (now - startedAt) / 1_000,
      );
      if (!this.motionPaused) this.animationFrame = requestAnimationFrame(renderMotion);
    };
    renderMotion(startedAt);
  }

  private destroyBindings(): void {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.controlsAbort?.abort();
    this.browser?.remove();
    this.browser = undefined;
    this.stage?.remove();
    this.stage = undefined;
    if (this.toolsPanel) this.toolsPanel.hidden = false;
    this.toolsPanel = undefined;
    document.documentElement.classList.remove("water-preview-active");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) {
      slot.replaceChildren();
    }
  }
}

function buildWorldModel(islandImages: readonly HTMLImageElement[]): WaterWorldModel {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = WORLD_GRID_SIZE;
  maskCanvas.height = WORLD_GRID_SIZE;
  const context = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Water prototype could not create its island mask");
  context.imageSmoothingEnabled = true;
  ISLANDS.forEach((island, index) => {
    const image = islandImages[index];
    if (image) context.drawImage(image, island.x, island.y, island.width, island.height);
  });
  const pixels = context.getImageData(0, 0, WORLD_GRID_SIZE, WORLD_GRID_SIZE).data;
  const land = new Uint8Array(WORLD_GRID_SIZE * WORLD_GRID_SIZE);
  const landCells: Array<readonly [number, number]> = [];
  for (let y = 0; y < WORLD_GRID_SIZE; y++) {
    for (let x = 0; x < WORLD_GRID_SIZE; x++) {
      const index = y * WORLD_GRID_SIZE + x;
      if (pixels[index * 4 + 3]! < 42) continue;
      land[index] = 1;
      landCells.push([x, y]);
    }
  }

  const distanceFromLand = new Float32Array(land.length);
  for (let y = 0; y < WORLD_GRID_SIZE; y++) {
    for (let x = 0; x < WORLD_GRID_SIZE; x++) {
      const index = y * WORLD_GRID_SIZE + x;
      if (land[index]) continue;
      let nearestSquared = Number.POSITIVE_INFINITY;
      for (const [landX, landY] of landCells) {
        const dx = x - landX;
        const dy = y - landY;
        nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
      }
      distanceFromLand[index] = Math.sqrt(nearestSquared);
    }
  }

  const shore: ShorePoint[] = [];
  const windX = 0.9;
  const windY = 0.42;
  for (let y = 1; y < WORLD_GRID_SIZE - 1; y++) {
    for (let x = 1; x < WORLD_GRID_SIZE - 1; x++) {
      if (land[y * WORLD_GRID_SIZE + x]) continue;
      let inwardX = 0;
      let inwardY = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || !land[(y + dy) * WORLD_GRID_SIZE + x + dx]) continue;
          inwardX += dx;
          inwardY += dy;
        }
      }
      const length = Math.hypot(inwardX, inwardY);
      if (length === 0) continue;
      const nx = -inwardX / length;
      const ny = -inwardY / length;
      const exposure = clamp01(0.4 + (nx * windX + ny * windY) * 0.45);
      const hash = coordinateHash(x, y);
      if (hash % 5 === 0 && exposure < 0.55) continue;
      shore.push({ x, y, nx, ny, exposure, phase: (hash % 628) / 100 });
    }
  }
  return { land, distanceFromLand, shore };
}

function drawStaticWorld(
  context: CanvasRenderingContext2D,
  staticSheet: HTMLImageElement,
  boat: HTMLImageElement,
  wake: HTMLImageElement,
  islandImages: readonly HTMLImageElement[],
  model: WaterWorldModel,
  cell: number,
  showOverlays: boolean,
): void {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.fillStyle = "#082f40";
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  for (let y = 0; y < WORLD_GRID_SIZE; y++) {
    for (let x = 0; x < WORLD_GRID_SIZE; x++) {
      const variant = coordinateVariant(x, y);
      drawProfileTile(context, staticSheet, "deep", variant, x * cell, y * cell, cell, 1);
    }
  }

  const irregularityAt = (x: number, y: number): number => Math.sin(x * 0.33 + y * 0.19) * 1.15
    + Math.sin(x * 0.11 - y * 0.41) * 0.8
    + ((coordinateHash(x, y) % 100) / 100 - 0.5) * 0.7;
  drawProfileField(context, staticSheet, "abyss", cell, (x, y) => clamp01((49 - x - y + Math.sin(y * 0.2) * 5) / 21));
  drawProfileField(context, staticSheet, "coastal", cell, (x, y) => {
    const distance = model.distanceFromLand[y * WORLD_GRID_SIZE + x]!;
    const irregularity = irregularityAt(x, y);
    return 1 - smoothstep(4.2 + irregularity, 10.2 + irregularity, distance);
  });
  drawProfileField(context, staticSheet, "lagoon", cell, (x, y) => {
    const distance = model.distanceFromLand[y * WORLD_GRID_SIZE + x]!;
    return 1 - smoothstep(0.7, 3.6 + irregularityAt(x, y) * 0.35, distance);
  });
  drawProfileField(context, staticSheet, "brackish", cell, (x, y) => (
    1 - smoothstep(-0.3, 0.28, ellipseDistance(x, y, 14, 87, 16, 9))
  ));
  drawProfileField(context, staticSheet, "reef", cell, reefIntensity);
  if (showOverlays) {
    drawProfileField(context, staticSheet, "current", cell, (x, y) => {
      const currentY = 39 + Math.sin(x * 0.12) * 5;
      return (1 - smoothstep(0.5, 3.5, Math.abs(y - currentY))) * 0.3;
    });
    drawProfileField(context, staticSheet, "rough", cell, (x, y) => (
      (1 - smoothstep(-0.28, 0.22, ellipseDistance(x, y, 77, 18, 18, 10))) * 0.48
    ));
  }

  ISLANDS.forEach((island, index) => {
    const image = islandImages[index];
    if (!image) return;
    context.drawImage(image, island.x * cell, island.y * cell, island.width * cell, island.height * cell);
  });

  const boatSize = cell * 4;
  const boatX = cell * 44;
  const boatY = cell * 52;
  context.globalAlpha = 0.82;
  context.drawImage(wake, boatX - cell * 3.3, boatY - cell * 2, cell * 6, boatSize);
  context.globalAlpha = 1;
  context.drawImage(boat, boatX - cell * 2, boatY - cell * 2, boatSize, boatSize);
}

function drawProfileField(
  context: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  profile: WaterProfileId,
  cell: number,
  alphaAt: (x: number, y: number) => number,
): void {
  const layer = document.createElement("canvas");
  layer.width = context.canvas.width;
  layer.height = context.canvas.height;
  const layerContext = layer.getContext("2d");
  if (!layerContext) return;
  layerContext.imageSmoothingEnabled = false;

  const mask = document.createElement("canvas");
  mask.width = WORLD_GRID_SIZE;
  mask.height = WORLD_GRID_SIZE;
  const maskContext = mask.getContext("2d");
  if (!maskContext) return;
  const maskImage = maskContext.createImageData(WORLD_GRID_SIZE, WORLD_GRID_SIZE);
  for (let y = 0; y < WORLD_GRID_SIZE; y++) {
    for (let x = 0; x < WORLD_GRID_SIZE; x++) {
      const alpha = clamp01(alphaAt(x, y));
      if (alpha > 0.01) {
        drawProfileTile(layerContext, sheet, profile, coordinateVariant(x, y), x * cell, y * cell, cell, 1);
      }
      const pixel = (y * WORLD_GRID_SIZE + x) * 4;
      maskImage.data[pixel] = 255;
      maskImage.data[pixel + 1] = 255;
      maskImage.data[pixel + 2] = 255;
      maskImage.data[pixel + 3] = Math.round(alpha * 255);
    }
  }
  maskContext.putImageData(maskImage, 0, 0);
  layerContext.globalCompositeOperation = "destination-in";
  layerContext.imageSmoothingEnabled = true;
  layerContext.drawImage(mask, 0, 0, layer.width, layer.height);
  layerContext.globalCompositeOperation = "source-over";
  context.drawImage(layer, 0, 0);
  layer.width = 0;
  layer.height = 0;
  mask.width = 0;
  mask.height = 0;
}

function drawWorldMotion(
  context: CanvasRenderingContext2D,
  overlaySheet: HTMLImageElement,
  shoalImages: readonly HTMLImageElement[],
  model: WaterWorldModel,
  cell: number,
  showOverlays: boolean,
  seconds: number,
): void {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  const frame = Math.floor(seconds * 7) % 8;
  if (showOverlays) {
    drawWind(context, model, cell, seconds);
    for (let x = 1; x < WORLD_GRID_SIZE; x += 2) {
      const y = Math.round(39 + Math.sin(x * 0.12) * 5 + Math.sin(seconds * 1.2 + x * 0.18));
      if (model.land[y * WORLD_GRID_SIZE + x]) continue;
      drawOverlayFrame(context, overlaySheet, 2, (frame + x) % 8, x * cell, y * cell, cell, 0.72);
    }
    for (let y = 8; y < 29; y += 2) {
      for (let x = 60; x < 95; x += 3) {
        const intensity = 1 - smoothstep(-0.18, 0.18, ellipseDistance(x, y, 77, 18, 18, 10));
        if (intensity <= 0 || coordinateHash(x, y) % 3 === 0) continue;
        drawOverlayFrame(context, overlaySheet, 3, (frame + coordinateVariant(x, y)) % 8, x * cell, y * cell, cell, intensity * 0.76);
      }
    }
    for (const point of model.shore) drawShoreWave(context, point, cell, seconds);
    for (let index = 0; index < 34; index++) {
      const x = coordinateHash(index, 17) % WORLD_GRID_SIZE;
      const y = coordinateHash(index, 29) % WORLD_GRID_SIZE;
      if (model.land[y * WORLD_GRID_SIZE + x]) continue;
      const pulse = 0.35 + Math.sin(seconds * 2 + index * 1.7) * 0.25;
      drawOverlayFrame(context, overlaySheet, 0, (frame + index) % 8, x * cell, y * cell, cell, pulse);
    }
  }

  SHOALS.forEach((shoal, index) => {
    const strengthIndex = shoalStrengthIndex(shoal.strength);
    const image = shoalImages[strengthIndex];
    const visual = SHOAL_STRENGTHS[strengthIndex];
    if (!image || !visual) return;
    drawShoal(context, image, shoal, visual, cell, seconds, index);
  });
}

function drawWind(context: CanvasRenderingContext2D, model: WaterWorldModel, cell: number, seconds: number): void {
  context.save();
  context.lineCap = "round";
  context.strokeStyle = "rgba(181, 233, 225, 0.24)";
  context.lineWidth = Math.max(1, cell * 0.07);
  for (let index = 0; index < 74; index++) {
    const baseX = coordinateHash(index, 41) % WORLD_GRID_SIZE;
    const baseY = coordinateHash(index, 73) % WORLD_GRID_SIZE;
    const x = (baseX + seconds * (1.4 + (index % 4) * 0.18)) % WORLD_GRID_SIZE;
    const y = (baseY + seconds * 0.55) % WORLD_GRID_SIZE;
    const sampleX = Math.floor(x);
    const sampleY = Math.floor(y);
    if (model.land[sampleY * WORLD_GRID_SIZE + sampleX]) continue;
    const length = 0.7 + (index % 5) * 0.18;
    context.globalAlpha = 0.35 + (index % 4) * 0.12;
    context.beginPath();
    context.moveTo(x * cell, y * cell);
    context.lineTo((x + length) * cell, (y + length * 0.28) * cell);
    context.stroke();
  }
  context.restore();
}

function drawShoreWave(context: CanvasRenderingContext2D, point: ShorePoint, cell: number, seconds: number): void {
  const pulse = (Math.sin(seconds * (1.7 + point.exposure * 0.8) + point.phase) + 1) / 2;
  if (pulse < 0.28) return;
  const tangentX = -point.ny;
  const tangentY = point.nx;
  const length = cell * (0.28 + point.exposure * 0.4);
  const centerX = (point.x + 0.5 + point.nx * (0.05 + pulse * 0.12)) * cell;
  const centerY = (point.y + 0.5 + point.ny * (0.05 + pulse * 0.12)) * cell;
  context.save();
  context.strokeStyle = `rgba(224, 247, 226, ${0.18 + pulse * (0.28 + point.exposure * 0.32)})`;
  context.lineWidth = Math.max(1, cell * (0.08 + point.exposure * 0.035));
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(centerX - tangentX * length * 0.5, centerY - tangentY * length * 0.5);
  context.quadraticCurveTo(
    centerX + point.nx * cell * 0.1,
    centerY + point.ny * cell * 0.1,
    centerX + tangentX * length * 0.5,
    centerY + tangentY * length * 0.5,
  );
  context.stroke();
  context.restore();
}

function drawShoal(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  shoal: ShoalPlacement,
  visual: ShoalStrengthVisual,
  cell: number,
  seconds: number,
  index: number,
): void {
  const phase = seconds * visual.pulseSpeed + index * 0.73;
  const width = cell * 3;
  const height = cell * 2;
  const x = (shoal.x + Math.sin(phase) * 0.045) * cell;
  const y = (shoal.y + Math.cos(phase * 0.74) * 0.035) * cell;
  const shimmer = 1 + Math.sin(phase * 1.35) * 0.015;
  const strengthRank = shoal.strength === "lean" ? 1 : shoal.strength === "steady" ? 2 : 3;
  context.save();
  context.translate(x, y);
  context.globalAlpha = 0.58 + visual.intensity * 0.34 + Math.sin(phase * 1.4) * 0.035;
  context.drawImage(image, -width * shimmer / 2, -height * shimmer / 2, width * shimmer, height * shimmer);
  context.lineCap = "round";
  context.lineWidth = Math.max(1, cell * 0.045);
  for (let ripple = 0; ripple < strengthRank; ripple++) {
    const progress = (seconds * visual.pulseSpeed * 0.42 + index * 0.19 + ripple / strengthRank) % 1;
    const alpha = (1 - progress) * visual.intensity * 0.22;
    context.strokeStyle = `rgba(197, 245, 242, ${alpha})`;
    context.beginPath();
    context.ellipse(
      (ripple - (strengthRank - 1) / 2) * width * 0.16,
      Math.sin(index + ripple) * height * 0.08,
      width * (0.07 + progress * 0.14),
      height * (0.06 + progress * 0.12),
      0,
      0.18,
      Math.PI * 1.5,
    );
    context.stroke();
  }
  context.restore();
}

function profileIndex(id: WaterProfileId): number {
  return PROFILES.findIndex((profile) => profile.id === id);
}

function shoalStrengthIndex(strength: ShoalStrength): number {
  return SHOAL_STRENGTHS.findIndex((visual) => visual.strength === strength);
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

function drawOverlayFrame(
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
    SHEET_MARGIN + (variant % 8) * SHEET_PITCH,
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
