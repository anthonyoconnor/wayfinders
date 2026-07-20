import Phaser from "phaser";
import { assetWorkspaceSceneKey, type GreatHallAssetWorkspaceModule } from "../workspaces/AssetWorkspace";
import { GREAT_HALL_MAX_GENERATIONS, type GreatHallPresentationMode } from "../../rendering/greatHall/GreatHallPresentationModel";
import { GreatHallRenderer } from "../../rendering/greatHall/GreatHallRenderer";
import { buildGreatHallFixture } from "./GreatHallFixture";
import {
  buildGreatHallPreviewWorkbenchMarkup,
  type GreatHallPreviewViewport,
} from "./GreatHallPreviewWorkbench";

export class GreatHallPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private hallRenderer?: GreatHallRenderer;
  private navigatorCount = GREAT_HALL_MAX_GENERATIONS;
  private selectedGeneration = GREAT_HALL_MAX_GENERATIONS;
  private mode: GreatHallPresentationMode = "home";
  private viewport: GreatHallPreviewViewport = "desktop";

  constructor(workspace: Readonly<GreatHallAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.mountWorkspace();
    this.render();
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "Great Hall shared-renderer fixture — view only";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Great Hall preview requires the asset workspace shell");
    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser great-hall-preview-browser";
    this.browser.setAttribute("aria-label", "Great Hall fixture scenarios");
    region.append(this.browser);
    this.stage = document.createElement("section");
    this.stage.className = "great-hall-preview-stage";
    this.stage.setAttribute("aria-label", "Great Hall shared presentation preview");
    region.append(this.stage);
    this.hallRenderer = new GreatHallRenderer(this.stage, {
      selectionChanged: (generation) => {
        this.selectedGeneration = generation;
        this.renderWorkbench();
      },
    });
    slot.classList.add("tool-slot--connected", "great-hall-preview-tools");
    slot.addEventListener("input", this.onInput, { signal: this.controlsAbort.signal });
    this.browser.addEventListener("click", this.onClick, { signal: this.controlsAbort.signal });
    this.browser.addEventListener("input", this.onInput, { signal: this.controlsAbort.signal });
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-gh-mode]") : null;
    const mode = target?.dataset.ghMode as GreatHallPresentationMode | undefined;
    if (mode === "home" || mode === "handover" || mode === "completion") {
      this.mode = mode;
      this.render();
    }
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.ghControl === "navigator-count") {
      this.navigatorCount = Math.min(GREAT_HALL_MAX_GENERATIONS, Math.max(1, Math.trunc(Number(target.value) || 1)));
      this.selectedGeneration = Math.min(this.selectedGeneration, this.navigatorCount);
      this.render();
    }
    if (target.dataset.ghControl === "viewport") {
      this.viewport = target.value === "narrow" ? "narrow" : "desktop";
      this.render();
    }
  };

  private model() {
    return buildGreatHallFixture({
      navigatorCount: this.navigatorCount,
      selectedGeneration: this.selectedGeneration,
      mode: this.mode,
    });
  }

  private render(): void {
    this.renderBrowser();
    if (this.stage) this.stage.dataset.viewport = this.viewport;
    this.hallRenderer?.update(this.model());
    this.renderWorkbench();
  }

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = `
      <header class="asset-library-header"><div><p class="eyebrow">Validated V1 fixture</p><h2>Great Hall</h2></div><span class="gh-preview-only">View only</span></header>
      <div class="gh-preview-browser__body">
        <label class="gh-preview-count"><span>Navigators</span><input data-gh-control="navigator-count" type="range" min="1" max="20" step="1" value="${this.navigatorCount}"><output>${this.navigatorCount}</output></label>
        <div class="gh-preview-scenarios" role="group" aria-label="Great Hall mode">
          ${(["home", "handover", "completion"] as const).map((mode) => `<button type="button" data-gh-mode="${mode}" aria-pressed="${this.mode === mode}">${mode === "home" ? "Home chronicle" : mode === "handover" ? "Handover" : "Completion"}</button>`).join("")}
        </div>
        <section class="gh-preview-note"><h3>Shared presentation path</h3><p>This checked-in JSON fixture is validated, varied in memory, and passed to the same renderer used by the game.</p></section>
      </div>`;
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    const model = this.model();
    slot.innerHTML = buildGreatHallPreviewWorkbenchMarkup(model, this.viewport);
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.hallRenderer?.destroy();
    this.hallRenderer = undefined;
    this.browser?.remove();
    this.browser = undefined;
    this.stage?.remove();
    this.stage = undefined;
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) {
      slot.replaceChildren();
      slot.classList.remove("tool-slot--connected", "great-hall-preview-tools");
    }
  }
}
