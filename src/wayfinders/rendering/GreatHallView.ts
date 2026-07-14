import type { NavigatorId } from "../lineage/NavigatorLineageSystem";
import type {
  GreatHallChronicle,
  GreatHallNavigatorEntry,
  GreatHallVoyage,
} from "../lineage/GreatHallChronicle";

export type GreatHallViewMode = "home" | "handover";

export interface GreatHallViewCallbacks {
  readonly closeHome: () => void;
  readonly continueHandover: () => void;
}

/** Shared GP-2.3 presentation for optional home browsing and required succession. */
export class GreatHallView {
  readonly dialog: HTMLDialogElement;

  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly totals: HTMLElement;
  private readonly navigatorList: HTMLOListElement;
  private readonly navigatorNav: HTMLElement;
  private readonly entryEyebrow: HTMLElement;
  private readonly entryTitle: HTMLElement;
  private readonly entryStatus: HTMLElement;
  private readonly entryFate: HTMLElement;
  private readonly voyageList: HTMLOListElement;
  private readonly handoverCopy: HTMLElement;
  private readonly primaryButton: HTMLButtonElement;
  private chronicle?: Readonly<GreatHallChronicle>;
  private selectedNavigatorId?: NavigatorId;
  private nextGeneration?: number;
  private modeValue?: GreatHallViewMode;

  constructor(
    host: HTMLElement,
    signal: AbortSignal,
    private readonly callbacks: Readonly<GreatHallViewCallbacks>,
  ) {
    const dialog = document.createElement("dialog");
    dialog.className = "great-hall";
    dialog.dataset.greatHall = "true";
    dialog.setAttribute("aria-labelledby", "great-hall-title");
    dialog.setAttribute("aria-describedby", "great-hall-description");
    dialog.innerHTML = `
      <section class="great-hall__panel">
        <header class="great-hall__header">
          <div>
            <p class="great-hall__eyebrow">The Great Hall</p>
            <h2 id="great-hall-title" data-great-hall-title>Lineage chronicle</h2>
            <p id="great-hall-description" class="great-hall__description" data-great-hall-description></p>
          </div>
          <button class="great-hall__close" data-great-hall-close type="button" aria-label="Return to the ship">×</button>
        </header>
        <dl class="great-hall__totals" data-great-hall-totals aria-label="Lineage totals"></dl>
        <div class="great-hall__body">
          <nav class="great-hall__navigator-nav" data-great-hall-nav aria-label="Navigator generations">
            <p>Generations</p>
            <ol data-great-hall-navigators></ol>
          </nav>
          <article class="great-hall__entry" data-great-hall-entry>
            <p class="great-hall__entry-eyebrow" data-great-hall-entry-eyebrow></p>
            <h3 data-great-hall-entry-title></h3>
            <p class="great-hall__entry-status" data-great-hall-entry-status></p>
            <p class="great-hall__entry-fate" data-great-hall-entry-fate></p>
            <ol class="great-hall__voyages" data-great-hall-voyages></ol>
          </article>
        </div>
        <p class="great-hall__handover" data-great-hall-handover></p>
        <footer class="great-hall__footer">
          <button data-great-hall-primary type="button">Return to ship</button>
        </footer>
      </section>`;
    host.append(dialog);

    this.dialog = dialog;
    this.title = requiredElement(dialog, "[data-great-hall-title]");
    this.description = requiredElement(dialog, "[data-great-hall-description]");
    this.closeButton = requiredElement(dialog, "[data-great-hall-close]");
    this.totals = requiredElement(dialog, "[data-great-hall-totals]");
    this.navigatorNav = requiredElement(dialog, "[data-great-hall-nav]");
    this.navigatorList = requiredElement(dialog, "[data-great-hall-navigators]");
    this.entryEyebrow = requiredElement(dialog, "[data-great-hall-entry-eyebrow]");
    this.entryTitle = requiredElement(dialog, "[data-great-hall-entry-title]");
    this.entryStatus = requiredElement(dialog, "[data-great-hall-entry-status]");
    this.entryFate = requiredElement(dialog, "[data-great-hall-entry-fate]");
    this.voyageList = requiredElement(dialog, "[data-great-hall-voyages]");
    this.handoverCopy = requiredElement(dialog, "[data-great-hall-handover]");
    this.primaryButton = requiredElement(dialog, "[data-great-hall-primary]");

    this.closeButton.addEventListener("click", () => this.requestHomeClose(), { signal });
    this.primaryButton.addEventListener("click", () => {
      if (this.modeValue === "handover") this.callbacks.continueHandover();
      else this.requestHomeClose();
    }, { signal });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (this.modeValue === "home") this.callbacks.closeHome();
    }, { signal });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (this.modeValue === "home") this.callbacks.closeHome();
    }, { signal });
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  get mode(): GreatHallViewMode | undefined {
    return this.modeValue;
  }

  get selectedGeneration(): number | undefined {
    return this.selectedEntry()?.generation;
  }

  showHome(
    chronicle: Readonly<GreatHallChronicle>,
    preferredNavigatorId?: NavigatorId,
  ): void {
    this.chronicle = chronicle;
    this.modeValue = "home";
    this.nextGeneration = undefined;
    this.selectedNavigatorId = this.resolveSelection(preferredNavigatorId);
    this.render();
    this.showDialog();
    this.focusSelectedNavigator();
  }

  showHandover(
    chronicle: Readonly<GreatHallChronicle>,
    outgoingNavigatorId: NavigatorId,
    nextGeneration: number,
  ): void {
    const outgoing = chronicle.navigators.find(({ navigatorId }) => navigatorId === outgoingNavigatorId);
    if (!outgoing || outgoing.state === "active") {
      throw new RangeError(`Great Hall handover requires terminal navigator ${outgoingNavigatorId}`);
    }
    this.chronicle = chronicle;
    this.modeValue = "handover";
    this.selectedNavigatorId = outgoingNavigatorId;
    this.nextGeneration = nextGeneration;
    this.render();
    this.showDialog();
    this.primaryButton.focus();
  }

  refresh(chronicle: Readonly<GreatHallChronicle>): void {
    if (!this.isOpen) return;
    this.chronicle = chronicle;
    this.selectedNavigatorId = this.resolveSelection(this.selectedNavigatorId);
    this.render();
  }

  selectGeneration(generation: number): boolean {
    if (this.modeValue !== "home" || !this.chronicle) return false;
    const entry = this.chronicle.navigators.find((navigator) => navigator.generation === generation);
    if (!entry) return false;
    this.selectedNavigatorId = entry.navigatorId;
    this.render();
    this.focusSelectedNavigator();
    return true;
  }

  hide(): boolean {
    const wasOpen = this.isOpen;
    if (typeof this.dialog.close === "function" && this.dialog.open) this.dialog.close();
    else this.dialog.removeAttribute("open");
    this.modeValue = undefined;
    this.chronicle = undefined;
    this.selectedNavigatorId = undefined;
    this.nextGeneration = undefined;
    delete this.dialog.dataset.mode;
    delete this.dialog.dataset.selectedGeneration;
    delete this.dialog.dataset.navigatorState;
    delete this.dialog.dataset.outcome;
    delete this.dialog.dataset.nextGeneration;
    return wasOpen;
  }

  destroy(): void {
    this.dialog.remove();
    this.modeValue = undefined;
    this.chronicle = undefined;
  }

  private render(): void {
    const chronicle = this.chronicle;
    const mode = this.modeValue;
    const entry = this.selectedEntry();
    if (!chronicle || !mode || !entry) throw new RangeError("Great Hall view has no selected chronicle entry");

    this.dialog.dataset.mode = mode;
    this.dialog.dataset.selectedGeneration = String(entry.generation);
    this.dialog.dataset.navigatorState = entry.state;
    this.dialog.dataset.outcome = entry.state === "completed" ? "tenure-completed" : entry.state === "lost" ? "lost-at-sea" : "active";
    if (this.nextGeneration === undefined) delete this.dialog.dataset.nextGeneration;
    else this.dialog.dataset.nextGeneration = String(this.nextGeneration);

    const homeMode = mode === "home";
    this.title.textContent = homeMode ? "Lineage chronicle" : "A navigator is remembered";
    this.description.textContent = homeMode
      ? "Only journeys and findings returned to the exact home dock are remembered here."
      : `Generation ${entry.generation}'s committed journeys enter the tribe's permanent memory.`;
    this.closeButton.hidden = !homeMode;
    this.totals.hidden = !homeMode;
    this.navigatorNav.hidden = !homeMode;
    this.renderTotals(chronicle);
    this.renderNavigatorNavigation(chronicle, entry);
    this.renderEntry(entry);

    this.handoverCopy.hidden = homeMode;
    this.handoverCopy.textContent = homeMode ? "" : handoverText(entry, this.nextGeneration);
    this.primaryButton.textContent = homeMode
      ? "Return to ship"
      : `Begin generation ${this.nextGeneration}`;
  }

  private renderTotals(chronicle: Readonly<GreatHallChronicle>): void {
    const { totals } = chronicle;
    const facts: ReadonlyArray<readonly [string, number, string]> = [
      ["navigators", totals.navigators, "Navigators"],
      ["returned-voyages", totals.returnedVoyages, "Safe journeys"],
      ["completed-navigators", totals.completedNavigators, "Tenures completed"],
      ["lost-navigators", totals.lostNavigators, "Lost at sea"],
      ["supported-route-tiles", totals.supportedRouteTiles, "Route tiles supported"],
      ["mapped-water-tiles", totals.mappedEnclosedWaterTiles, "Enclosed waters mapped"],
      ["discoveries", totals.discoveries, "Discoveries"],
      ["fishing-leads", totals.fishingLeads, "Fishing leads"],
      ["fishing-surveys", totals.fishingSurveys, "Fishing surveys"],
      ["confirmed-wrecks", totals.confirmedWreckFates, "Wrecks confirmed"],
    ];
    this.totals.replaceChildren(...facts.map(([key, value, label]) => {
      const wrapper = document.createElement("div");
      wrapper.dataset.total = key;
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = String(value);
      wrapper.append(term, detail);
      return wrapper;
    }));
  }

  private renderNavigatorNavigation(
    chronicle: Readonly<GreatHallChronicle>,
    selected: Readonly<GreatHallNavigatorEntry>,
  ): void {
    this.navigatorList.replaceChildren(...[...chronicle.navigators].reverse().map((entry) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.navigatorId = entry.navigatorId;
      button.dataset.generation = String(entry.generation);
      button.setAttribute("aria-pressed", String(entry.navigatorId === selected.navigatorId));
      const generation = document.createElement("strong");
      generation.textContent = `Generation ${entry.generation}`;
      const state = document.createElement("span");
      state.textContent = navigatorStateLabel(entry);
      button.append(generation, state);
      button.addEventListener("click", () => {
        if (this.modeValue !== "home") return;
        this.selectedNavigatorId = entry.navigatorId;
        this.render();
        this.focusSelectedNavigator();
      });
      item.append(button);
      return item;
    }));
  }

  private renderEntry(entry: Readonly<GreatHallNavigatorEntry>): void {
    this.entryEyebrow.textContent = `Generation ${entry.generation} navigator`;
    this.entryTitle.textContent = navigatorStateLabel(entry);
    this.entryStatus.textContent = navigatorProgressLabel(entry);
    this.entryFate.textContent = navigatorFateLabel(entry);
    this.entryFate.hidden = this.entryFate.textContent.length === 0;

    if (entry.voyages.length === 0) {
      const empty = document.createElement("li");
      empty.className = "great-hall__empty-voyages";
      empty.textContent = "No journeys have been returned yet.";
      this.voyageList.replaceChildren(empty);
      return;
    }
    this.voyageList.replaceChildren(...entry.voyages.map((voyage) => renderVoyage(voyage)));
  }

  private selectedEntry(): Readonly<GreatHallNavigatorEntry> | undefined {
    return this.chronicle?.navigators.find(({ navigatorId }) => navigatorId === this.selectedNavigatorId);
  }

  private resolveSelection(preferredNavigatorId?: NavigatorId): NavigatorId {
    const chronicle = this.chronicle;
    if (!chronicle) throw new RangeError("Cannot select a navigator without a Great Hall chronicle");
    const preferred = chronicle.navigators.find(({ navigatorId }) => navigatorId === preferredNavigatorId);
    return (preferred ?? chronicle.navigators[chronicle.navigators.length - 1]).navigatorId;
  }

  private showDialog(): void {
    if (this.dialog.open) return;
    if (typeof this.dialog.show === "function") this.dialog.show();
    else this.dialog.setAttribute("open", "");
  }

  private focusSelectedNavigator(): void {
    const selected = this.navigatorList.querySelector<HTMLButtonElement>("button[aria-pressed='true']");
    (selected ?? this.closeButton).focus();
  }

  private requestHomeClose(): void {
    if (this.modeValue === "home") this.callbacks.closeHome();
  }
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Great Hall markup is missing ${selector}`);
  return element;
}

function navigatorStateLabel(entry: Readonly<GreatHallNavigatorEntry>): string {
  if (entry.state === "active") return "In progress";
  if (entry.state === "completed") return "Four journeys completed";
  return "Lost at sea";
}

function navigatorProgressLabel(entry: Readonly<GreatHallNavigatorEntry>): string {
  if (entry.state === "active") {
    const nextVoyage = entry.completedVoyages + 1;
    return `${entry.completedVoyages} of ${entry.voyageLimit} journeys returned · Journey ${nextVoyage} awaits`;
  }
  if (entry.state === "completed") return `All ${entry.voyageLimit} journeys returned safely.`;
  return `Lost on journey ${entry.completedVoyages + 1} of ${entry.voyageLimit}.`;
}

function navigatorFateLabel(entry: Readonly<GreatHallNavigatorEntry>): string {
  if (entry.state !== "lost") return "";
  if (entry.wreckFate?.state !== "confirmed") return "Wreck not yet located.";
  return `Wreck located and fate confirmed by Generation ${entry.wreckFate.returnedByGeneration} `
    + `on journey ${entry.wreckFate.returnedOnVoyage}.`;
}

function renderVoyage(voyage: Readonly<GreatHallVoyage>): HTMLLIElement {
  const row = document.createElement("li");
  row.dataset.outcome = voyage.outcome;
  row.dataset.voyageNumber = String(voyage.voyageNumber);
  const heading = document.createElement("div");
  heading.className = "great-hall__voyage-heading";
  const label = document.createElement("strong");
  label.textContent = `Journey ${voyage.voyageNumber}`;
  const outcome = document.createElement("span");
  outcome.textContent = voyage.outcome === "returned" ? "Returned safely" : "Lost at sea";
  heading.append(label, outcome);
  const achievements = document.createElement("ul");
  achievements.className = "great-hall__achievements";
  const labels = voyage.outcome === "lost-at-sea"
    ? ["No findings from this journey were returned."]
    : voyage.achievements.length > 0
      ? voyage.achievements.map(({ label: achievement }) => achievement)
      : ["No new findings returned."];
  achievements.replaceChildren(...labels.map((achievement) => {
    const item = document.createElement("li");
    item.textContent = achievement;
    return item;
  }));
  row.append(heading, achievements);
  return row;
}

function handoverText(
  entry: Readonly<GreatHallNavigatorEntry>,
  nextGeneration: number | undefined,
): string {
  if (nextGeneration === undefined) return "";
  return entry.state === "completed"
    ? `Their four journeys are secured in the Great Hall. Time passes, and generation ${nextGeneration} takes the helm.`
    : `The tribe mourns and preserves their returned journeys. Time passes, and generation ${nextGeneration} takes the helm.`;
}
