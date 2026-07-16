import Phaser from "phaser";
import { assetWorkspaceSceneKey, type GreatHallAssetWorkspaceModule } from "../workspaces/AssetWorkspace";
import {
  GREAT_HALL_ERA_SIZE,
  GREAT_HALL_PREVIEW_MAX_GENERATIONS,
  buildGreatHallPreviewModel,
  type GreatHallPreviewAchievement,
  type GreatHallPreviewMode,
  type GreatHallPreviewNavigator,
  type GreatHallPreviewVoyage,
} from "./GreatHallPreviewModel";

type GreatHallPreviewViewport = "desktop" | "narrow";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stateLabel(state: Readonly<GreatHallPreviewNavigator>["state"]): string {
  if (state === "lost-unlocated") return "Lost — fate unlocated";
  if (state === "lost-confirmed") return "Lost — fate confirmed";
  return state === "active" ? "Active navigator" : "Completed tenure";
}

function portraitMarkup(
  navigator: Readonly<GreatHallPreviewNavigator>,
  selectedGeneration: number,
): string {
  const selected = navigator.generation === selectedGeneration;
  return `
    <button
      class="gh-portrait gh-portrait--${navigator.state}"
      type="button"
      data-gh-generation="${navigator.generation}"
      aria-pressed="${selected}"
      aria-label="Generation ${navigator.generation}, ${escapeHtml(stateLabel(navigator.state))}"
    >
      <span class="gh-portrait__image">
        <img src="${navigator.portraitUrl}" alt="" draggable="false" loading="lazy" decoding="async">
      </span>
      <span class="gh-portrait__generation">${navigator.generation}</span>
      <span class="gh-portrait__voyages" aria-hidden="true">
        ${navigator.voyages.map((voyage) => `<i data-state="${voyage.state}"></i>`).join("")}
      </span>
    </button>`;
}

function achievementMarkup(achievement: Readonly<GreatHallPreviewAchievement>): string {
  return `<button
    class="gh-achievement gh-achievement--${achievement.kind}"
    type="button"
    data-gh-achievement="${escapeHtml(achievement.label)}"
    aria-label="${escapeHtml(achievement.label)}"
  ><span class="gh-symbol gh-symbol--${achievement.kind}" aria-hidden="true"></span></button>`;
}

function voyageMarkup(voyageRecord: Readonly<GreatHallPreviewVoyage>): string {
  const stateCopy = voyageRecord.state === "returned"
    ? voyageRecord.achievements.length === 0 ? "Returned without findings" : "Returned with findings"
    : voyageRecord.state === "lost" ? "Lost at sea"
      : voyageRecord.state === "awaiting" ? "Next voyage awaits"
        : voyageRecord.state === "unsailed" ? "Not yet sailed" : "Closed after loss";
  return `
    <section class="gh-voyage gh-voyage--${voyageRecord.state}" aria-label="Voyage ${voyageRecord.position}: ${stateCopy}">
      <span class="gh-voyage__number">${voyageRecord.position}</span>
      <span class="gh-voyage__canoe" aria-hidden="true"></span>
      <span class="gh-voyage__achievements">
        ${voyageRecord.achievements.map(achievementMarkup).join("")}
      </span>
      <span class="gh-voyage__state">${stateCopy}</span>
    </section>`;
}

export class GreatHallPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private navigatorCount = GREAT_HALL_PREVIEW_MAX_GENERATIONS;
  private selectedGeneration = GREAT_HALL_PREVIEW_MAX_GENERATIONS;
  private mode: GreatHallPreviewMode = "home";
  private viewport: GreatHallPreviewViewport = "desktop";
  private selectedAchievement = "Select an achievement symbol to see its exact record.";

  constructor(workspace: Readonly<GreatHallAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.mountWorkspace();
    this.render();
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) gameStatus.textContent = "Great Hall approval preview — view only";
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort?.abort();
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Great Hall preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser great-hall-preview-browser";
    this.browser.setAttribute("aria-label", "Great Hall preview scenarios");
    region.append(this.browser);

    this.stage = document.createElement("section");
    this.stage.className = "great-hall-preview-stage";
    this.stage.setAttribute("aria-label", "Great Hall player-scale preview");
    region.append(this.stage);

    slot.classList.add("tool-slot--connected", "great-hall-preview-tools");
    slot.addEventListener("click", this.onClick, { signal: this.controlsAbort.signal });
    slot.addEventListener("input", this.onInput, { signal: this.controlsAbort.signal });
    this.browser.addEventListener("click", this.onClick, { signal: this.controlsAbort.signal });
    this.browser.addEventListener("input", this.onInput, { signal: this.controlsAbort.signal });
    this.stage.addEventListener("click", this.onClick, { signal: this.controlsAbort.signal });
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-gh-action], [data-gh-mode], [data-gh-generation], [data-gh-achievement]") : null;
    if (!target) return;
    const generation = Number(target.dataset.ghGeneration);
    if (Number.isInteger(generation) && generation >= 1 && generation <= this.navigatorCount) {
      this.selectedGeneration = generation;
      this.selectedAchievement = "Select an achievement symbol to see its exact record.";
      this.render();
      return;
    }
    const mode = target.dataset.ghMode as GreatHallPreviewMode | undefined;
    if (mode === "home" || mode === "handover" || mode === "completion") {
      this.mode = mode;
      this.render();
      return;
    }
    const achievement = target.dataset.ghAchievement;
    if (achievement) {
      this.selectedAchievement = achievement;
      this.renderWorkbench();
      return;
    }
    if (target.dataset.ghAction === "previous-era") this.changeEra(-1);
    if (target.dataset.ghAction === "next-era") this.changeEra(1);
    if (target.dataset.ghAction === "current") {
      this.selectedGeneration = this.navigatorCount;
      this.render();
    }
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.ghControl === "navigator-count") {
      this.navigatorCount = Math.min(
        GREAT_HALL_PREVIEW_MAX_GENERATIONS,
        Math.max(1, Math.trunc(Number(target.value) || 1)),
      );
      this.selectedGeneration = Math.min(this.selectedGeneration, this.navigatorCount);
      this.render();
    }
    if (target.dataset.ghControl === "viewport") {
      this.viewport = target.value === "narrow" ? "narrow" : "desktop";
      this.render();
    }
  };

  private changeEra(direction: -1 | 1): void {
    const model = buildGreatHallPreviewModel({
      navigatorCount: this.navigatorCount,
      selectedGeneration: this.selectedGeneration,
      mode: this.mode,
    });
    const nextEra = Math.min(model.eraCount - 1, Math.max(0, model.eraIndex + direction));
    if (nextEra === model.eraIndex) return;
    this.selectedGeneration = nextEra * GREAT_HALL_ERA_SIZE + 1;
    this.render();
  }

  private render(): void {
    this.renderBrowser();
    this.renderStage();
    this.renderWorkbench();
  }

  private model() {
    return buildGreatHallPreviewModel({
      navigatorCount: this.navigatorCount,
      selectedGeneration: this.selectedGeneration,
      mode: this.mode,
    });
  }

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">Approval fixture</p><h2>Great Hall</h2></div>
        <span class="gh-preview-only">View only</span>
      </header>
      <div class="gh-preview-browser__body">
        <label class="gh-preview-count">
          <span>Navigators</span>
          <input data-gh-control="navigator-count" type="range" min="1" max="20" step="1" value="${this.navigatorCount}">
          <output>${this.navigatorCount}</output>
        </label>
        <div class="gh-preview-scenarios" role="group" aria-label="Great Hall mode">
          ${(["home", "handover", "completion"] as const).map((mode) => `
            <button type="button" data-gh-mode="${mode}" aria-pressed="${this.mode === mode}">
              ${mode === "home" ? "Home chronicle" : mode === "handover" ? "Handover" : "Completion"}
            </button>`).join("")}
        </div>
        <section class="gh-preview-note">
          <h3>Fixed preview roster</h3>
          <p>The count reveals the first entries from twenty predefined navigators. Portraits and achievements are never generated here.</p>
        </section>
        <section class="gh-preview-note">
          <h3>Review focus</h3>
          <ul>
            <li>History and home-island fit</li>
            <li>Portrait prominence</li>
            <li>Symbol readability</li>
            <li>Era navigation</li>
            <li>Minimal-text hierarchy</li>
          </ul>
        </section>
      </div>`;
  }

  private renderStage(): void {
    if (!this.stage) return;
    const model = this.model();
    const selected = model.selectedNavigator;
    const modeCopy = model.mode === "home"
      ? "Ancestor chronicle"
      : model.mode === "handover" ? "The next navigator awaits the chart" : "The idol paths are remembered";
    this.stage.dataset.viewport = this.viewport;
    this.stage.innerHTML = `
      <div class="gh-preview-viewport">
        <article class="gh-hall gh-hall--${model.mode}">
          <header class="gh-hall__header">
            <span class="gh-hall__shell" aria-hidden="true">◉</span>
            <div><span>THE GREAT HALL</span><small>${modeCopy}</small></div>
            <span class="gh-hall__shell" aria-hidden="true">◉</span>
          </header>
          <section class="gh-counting-cord" aria-label="Lineage totals">
            <span aria-label="Idol locations ${model.totals.idolLocations} of ${model.totals.idolTotal}"><i class="gh-tally-symbol gh-tally-symbol--01"></i><b>${model.totals.idolLocations}/${model.totals.idolTotal}</b></span>
            <span aria-label="${model.totals.navigators} navigators"><i class="gh-tally-symbol gh-tally-symbol--02"></i><b>${model.totals.navigators}</b></span>
            <span aria-label="${model.totals.returnedVoyages} safe journeys"><i class="gh-tally-symbol gh-tally-symbol--03"></i><b>${model.totals.returnedVoyages}</b></span>
            <span aria-label="${model.totals.completedNavigators} completed tenures"><i class="gh-tally-symbol gh-tally-symbol--04"></i><b>${model.totals.completedNavigators}</b></span>
            <span aria-label="${model.totals.lostNavigators} lost navigators"><i class="gh-tally-symbol gh-tally-symbol--05"></i><b>${model.totals.lostNavigators}</b></span>
            <span aria-label="${model.totals.confirmedWrecks} confirmed wrecks"><i class="gh-tally-symbol gh-tally-symbol--14"></i><b>${model.totals.confirmedWrecks}</b></span>
          </section>
          <div class="gh-hall__body">
            <section class="gh-era-wall" aria-label="Generations ${model.eraStart} through ${model.eraEnd}">
              <div class="gh-era-wall__portraits">
                ${model.visibleNavigators.map((navigator) => portraitMarkup(navigator, selected.generation)).join("")}
              </div>
              <nav class="gh-era-rail" aria-label="Era navigation">
                <button type="button" data-gh-action="previous-era" aria-label="Previous era" ${model.eraIndex === 0 ? "disabled" : ""}>◀</button>
                <span class="gh-era-rail__knots" aria-hidden="true">
                  ${Array.from({ length: GREAT_HALL_ERA_SIZE }, (_, index) => `<i class="${model.eraStart + index === selected.generation ? "is-current" : ""}"></i>`).join("")}
                </span>
                <b>${model.eraStart}–${model.eraEnd}</b>
                <button type="button" data-gh-action="next-era" aria-label="Next era" ${model.eraIndex >= model.eraCount - 1 ? "disabled" : ""}>▶</button>
                <button type="button" data-gh-action="current">Current</button>
              </nav>
            </section>
            <section class="gh-memorial gh-memorial--${selected.state}" aria-label="Selected generation ${selected.generation}">
              <div class="gh-memorial__portrait">
                <img src="${selected.portraitUrl}" alt="Navigator generation ${selected.generation}" decoding="async">
                <span>${selected.generation}</span>
              </div>
              <div class="gh-memorial__copy">
                <strong>${stateLabel(selected.state)}</strong>
                ${selected.confirmedByGeneration ? `<small>Fate confirmed by generation ${selected.confirmedByGeneration}</small>` : ""}
              </div>
              <div class="gh-voyage-list">
                ${selected.voyages.map(voyageMarkup).join("")}
              </div>
            </section>
          </div>
          ${model.mode === "handover" ? `<footer class="gh-ceremony">The chart passes to the next navigator.</footer>` : ""}
          ${model.mode === "completion" ? `<footer class="gh-ceremony gh-ceremony--complete">All three idol paths return to the Hall.</footer>` : ""}
        </article>
      </div>`;
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    const model = this.model();
    const selected = model.selectedNavigator;
    slot.innerHTML = `
      <section class="gh-preview-workbench">
        <header>
          <div><p class="eyebrow">Selected memorial</p><h3>Generation ${selected.generation}</h3></div>
          <span>${stateLabel(selected.state)}</span>
        </header>
        <label>Preview width
          <select data-gh-control="viewport">
            <option value="desktop" ${this.viewport === "desktop" ? "selected" : ""}>Desktop</option>
            <option value="narrow" ${this.viewport === "narrow" ? "selected" : ""}>Narrow</option>
          </select>
        </label>
        <dl>
          <div><dt>Era</dt><dd>${model.eraIndex + 1} / ${model.eraCount}</dd></div>
          <div><dt>Voyages returned</dt><dd>${selected.voyages.filter(({ state }) => state === "returned").length} / 4</dd></div>
          <div><dt>Portrait asset</dt><dd><code>${selected.portraitUrl.split("/").at(-1)}</code></dd></div>
        </dl>
        <section class="gh-preview-detail" aria-live="polite">
          <h4>Exact achievement detail</h4>
          <p>${escapeHtml(this.selectedAchievement)}</p>
        </section>
        <section class="gh-preview-legend">
          <h4>Symbol glossary</h4>
          <div>
            <span><i class="gh-symbol gh-symbol--supported-route"></i>Supported route</span><span><i class="gh-symbol gh-symbol--mapped-water"></i>Mapped lagoon</span>
            <span><i class="gh-symbol gh-symbol--island-lead"></i>Island lead</span><span><i class="gh-symbol gh-symbol--island-dossier"></i>Island dossier</span>
            <span><i class="gh-symbol gh-symbol--survey-lead"></i>Site lead</span><span><i class="gh-symbol gh-symbol--survey-report"></i>Site report</span>
            <span><i class="gh-symbol gh-symbol--fishing-lead"></i>Fishing lead</span><span><i class="gh-symbol gh-symbol--fishing-survey"></i>Fishing survey</span>
            <span><i class="gh-symbol gh-symbol--wreck-report"></i>Wreck fate</span><span><i class="gh-symbol gh-symbol--idol-location"></i>Idol location</span>
          </div>
        </section>
        <details class="gh-preview-reference">
          <summary>Achievement art sheet</summary>
          <img src="/assets/gr5/great-hall/achievement-token-set.png" alt="Ten fixed Great Hall achievement token designs" loading="lazy" decoding="async">
        </details>
        <details class="gh-preview-reference">
          <summary>Lineage tally art sheet</summary>
          <img src="/assets/gr5/great-hall/lineage-counting-cord.png" alt="Fourteen fixed Great Hall lineage tally designs" loading="lazy" decoding="async">
        </details>
        <p class="gh-preview-readonly">View-only approval surface. Edit image files in the project and reload to see revisions.</p>
      </section>`;
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.controlsAbort = undefined;
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
