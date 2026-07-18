import {
  GREAT_HALL_ERA_SIZE,
  type GreatHallPresentationAchievement,
  type GreatHallPresentationModel,
  type GreatHallPresentationNavigator,
  type GreatHallPresentationVoyage,
} from "./GreatHallPresentationModel";
import { achievementIconRowPositionPercent } from "../../assets/achievementIcons";

export interface GreatHallRendererCallbacks {
  readonly selectionChanged?: (generation: number) => void;
}

/** Shared semantic HTML renderer used by both the game dialog and the asset workspace. */
export class GreatHallRenderer {
  private model?: Readonly<GreatHallPresentationModel>;
  private selectedGeneration = 1;
  private selectedAchievement = "Select an achievement symbol to read its exact returned record.";
  private readonly abort = new AbortController();

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: Readonly<GreatHallRendererCallbacks> = {},
  ) {
    root.addEventListener("click", this.onClick, { signal: this.abort.signal });
    root.addEventListener("change", this.onChange, { signal: this.abort.signal });
    root.addEventListener("keydown", this.onKeyDown, { signal: this.abort.signal });
  }

  get selected(): number {
    return this.selectedGeneration;
  }

  update(model: Readonly<GreatHallPresentationModel>): void {
    this.model = model;
    this.selectedGeneration = model.selectedGeneration;
    this.selectedAchievement = "Select an achievement symbol to read its exact returned record.";
    this.render();
  }

  selectGeneration(generation: number, focus = false): boolean {
    if (!this.canBrowse() || !this.model?.navigators.some((entry) => entry.generation === generation)) return false;
    this.selectedGeneration = generation;
    this.selectedAchievement = "Select an achievement symbol to read its exact returned record.";
    this.render();
    this.callbacks.selectionChanged?.(generation);
    if (focus) this.focusSelection();
    return true;
  }

  focusSelection(): void {
    this.root.querySelector<HTMLButtonElement>("[data-gh-generation][aria-pressed='true']")?.focus();
  }

  destroy(): void {
    this.abort.abort();
    this.root.replaceChildren();
    this.model = undefined;
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-gh-action], [data-gh-generation]")
      : null;
    if (!target) return;
    const generation = Number(target.dataset.ghGeneration);
    if (Number.isInteger(generation)) {
      this.selectGeneration(generation, true);
      return;
    }
    if (target.dataset.ghAction === "previous-era") this.changeEra(-1);
    if (target.dataset.ghAction === "next-era") this.changeEra(1);
    if (target.dataset.ghAction === "current" && this.model) {
      this.selectGeneration(this.model.currentGeneration, true);
    }
  };

  private readonly onChange = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.dataset.ghDirectGeneration !== undefined) {
      this.selectGeneration(Number(target.value), true);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.canBrowse() || !this.model) return;
    const portrait = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-gh-generation]")
      : null;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      this.changeEra(event.key === "PageUp" ? -1 : 1);
      return;
    }
    if (!portrait) return;
    const current = Number(portrait.dataset.ghGeneration);
    const columns = this.root.getBoundingClientRect().width < 540 ? 2 : 4;
    const delta = event.key === "ArrowLeft" ? -1
      : event.key === "ArrowRight" ? 1
        : event.key === "ArrowUp" ? -columns
          : event.key === "ArrowDown" ? columns : 0;
    const target = event.key === "Home" ? 1
      : event.key === "End" ? this.model.currentGeneration
        : current + delta;
    if (delta !== 0 || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      this.selectGeneration(Math.min(this.model.currentGeneration, Math.max(1, target)), true);
    }
  };

  private changeEra(direction: -1 | 1): void {
    if (!this.model || !this.canBrowse()) return;
    const eraIndex = Math.floor((this.selectedGeneration - 1) / GREAT_HALL_ERA_SIZE);
    const eraCount = Math.ceil(this.model.navigators.length / GREAT_HALL_ERA_SIZE);
    const nextEra = Math.min(eraCount - 1, Math.max(0, eraIndex + direction));
    if (nextEra !== eraIndex) this.selectGeneration(nextEra * GREAT_HALL_ERA_SIZE + 1, true);
  }

  private canBrowse(): boolean {
    return this.model?.mode !== "handover";
  }

  private render(): void {
    const model = this.model;
    if (!model) return;
    const selected = model.navigators[this.selectedGeneration - 1]!;
    const eraIndex = Math.floor((selected.generation - 1) / GREAT_HALL_ERA_SIZE);
    const eraCount = Math.ceil(model.navigators.length / GREAT_HALL_ERA_SIZE);
    const eraStart = eraIndex * GREAT_HALL_ERA_SIZE + 1;
    const eraEnd = Math.min(model.navigators.length, eraStart + GREAT_HALL_ERA_SIZE - 1);
    const visible = model.navigators.slice(eraStart - 1, eraEnd);
    const placeholders = Array.from({ length: GREAT_HALL_ERA_SIZE - visible.length }, emptyPortraitMarkup).join("");
    this.root.innerHTML = `
      <article class="gh-hall gh-hall--${model.mode}" data-gh-mode="${model.mode}">
        <div class="gh-hall__body">
          <section class="gh-era-wall" aria-label="Generations ${eraStart} through ${eraEnd}">
            <div class="gh-era-wall__portraits">
              ${visible.map((navigator) => portraitMarkup(navigator, selected.generation, this.canBrowse())).join("")}
              ${placeholders}
            </div>
            <nav class="gh-era-rail" aria-label="Era navigation">
              <button type="button" data-gh-action="previous-era" aria-label="Previous era" ${!this.canBrowse() || eraIndex === 0 ? "disabled" : ""}>◀</button>
              <span class="gh-era-rail__knots" aria-hidden="true">${Array.from({ length: GREAT_HALL_ERA_SIZE }, (_, index) => `<i class="${eraStart + index === selected.generation ? "is-current" : ""}"></i>`).join("")}</span>
              <b>Era ${eraIndex + 1}/${eraCount}</b>
              <button type="button" data-gh-action="next-era" aria-label="Next era" ${!this.canBrowse() || eraIndex >= eraCount - 1 ? "disabled" : ""}>▶</button>
              <button type="button" data-gh-action="current" ${!this.canBrowse() ? "disabled" : ""}>Current</button>
              <label class="gh-era-rail__direct">Generation
                <select data-gh-direct-generation ${!this.canBrowse() ? "disabled" : ""}>${model.navigators.map(({ generation }) => `<option value="${generation}" ${generation === selected.generation ? "selected" : ""}>${generation}</option>`).join("")}</select>
              </label>
            </nav>
          </section>
          <section class="gh-memorial gh-memorial--${selected.state}" aria-label="Selected generation ${selected.generation}, ${escapeHtml(stateLabel(selected))}">
            <div class="gh-memorial__portrait"><img src="${selected.portraitUrl}" alt="Navigator generation ${selected.generation}" decoding="async"></div>
            <div class="gh-voyage-list">${selected.voyages.map(voyageMarkup).join("")}</div>
          </section>
        </div>
        ${ceremonyMarkup(model, selected)}
        <section class="gh-achievement-detail" data-gh-achievement-detail aria-live="polite"><h4>Returned record</h4><p>${escapeHtml(this.selectedAchievement)}</p></section>
      </article>`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-gh-achievement]")) {
      button.addEventListener("click", () => {
        this.selectedAchievement = button.dataset.ghAchievement
          ?? "Select an achievement symbol to read its exact returned record.";
        this.renderDetail();
      }, { signal: this.abort.signal });
    }
  }

  private renderDetail(): void {
    const detail = this.root.querySelector<HTMLElement>("[data-gh-achievement-detail] p");
    if (detail) detail.textContent = this.selectedAchievement;
  }
}

function portraitMarkup(
  navigator: Readonly<GreatHallPresentationNavigator>,
  selectedGeneration: number,
  enabled: boolean,
): string {
  return `<button class="gh-portrait gh-portrait--${navigator.state}" type="button" data-gh-generation="${navigator.generation}" aria-pressed="${navigator.generation === selectedGeneration}" aria-label="Generation ${navigator.generation}, ${escapeHtml(stateLabel(navigator))}" ${enabled ? "" : "disabled"}>
    <span class="gh-portrait__image"><img src="${navigator.portraitUrl}" alt="" draggable="false" loading="lazy" decoding="async"></span>
    <span class="gh-portrait__voyages" aria-hidden="true">${navigator.voyages.map(({ state }) => `<i data-state="${state}"></i>`).join("")}</span>
  </button>`;
}

function emptyPortraitMarkup(): string {
  return `<span class="gh-portrait-placeholder" aria-hidden="true"><span></span></span>`;
}

function voyageMarkup(voyage: Readonly<GreatHallPresentationVoyage>): string {
  const stateCopy = voyage.state === "returned"
    ? voyage.achievements.length > 0 ? "Returned with findings" : "Returned without new findings"
    : voyage.state === "lost" ? "Lost at sea"
      : voyage.state === "awaiting" ? "Next voyage awaits"
        : voyage.state === "unsailed" ? "Not yet sailed" : "Closed after loss";
  return `<section class="gh-voyage gh-voyage--${voyage.state}" aria-label="Voyage ${voyage.position}: ${stateCopy}">
    <img class="gh-voyage__icon" src="/assets/gr1/images/player-boat.png" alt="" aria-hidden="true" draggable="false">
    <span class="gh-voyage__achievements">${voyage.achievements.map(achievementMarkup).join("")}</span>
  </section>`;
}

function achievementMarkup(achievement: Readonly<GreatHallPresentationAchievement>): string {
  const label = escapeHtml(achievement.label);
  const rowPosition = achievementIconRowPositionPercent(achievement.kind);
  return `<button class="gh-achievement gh-achievement--${achievement.kind}" type="button" data-gh-achievement="${label}" aria-label="${label}"><span class="achievement-icon gh-symbol" data-achievement-icon-kind="${achievement.kind}" style="--achievement-icon-row-position:${rowPosition}%" aria-hidden="true"></span></button>`;
}

function stateLabel(navigator: Readonly<GreatHallPresentationNavigator>): string {
  if (navigator.state === "active") return "Active navigator";
  if (navigator.state === "completed") return "Four voyages completed";
  if (navigator.state === "lost-unlocated") return "Lost at sea, wreck unlocated";
  return `Lost at sea, wreck confirmed by generation ${navigator.confirmedByGeneration}`;
}

function ceremonyMarkup(
  model: Readonly<GreatHallPresentationModel>,
  selected: Readonly<GreatHallPresentationNavigator>,
): string {
  if (model.mode === "handover") {
    const ending = selected.state === "completed" ? "Their four voyages are secured." : "Their returned voyages are preserved.";
    return `<footer class="gh-ceremony">${ending} The chart passes to generation ${model.nextGeneration}.</footer>`;
  }
  if (model.mode === "completion") {
    return `<footer class="gh-ceremony gh-ceremony--complete">All ${model.idolProgress.total} idol paths are remembered in the Hall.</footer>`;
  }
  return "";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
