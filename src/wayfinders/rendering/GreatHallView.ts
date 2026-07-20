import type { NavigatorId } from "../lineage/NavigatorLineageSystem";
import type { GreatHallChronicle } from "../lineage/GreatHallChronicle";
import { adaptGreatHallChronicle } from "./greatHall/GreatHallPresentationAdapter";
import { GreatHallRenderer } from "./greatHall/GreatHallRenderer";
import type { GreatHallPresentationMode } from "./greatHall/GreatHallPresentationModel";

export type GreatHallViewMode = GreatHallPresentationMode;

export interface GreatHallViewCallbacks {
  readonly closeHome: () => void;
  readonly continueHandover: () => void;
  readonly continueCompletedWorld: () => void;
  readonly startNewGame: () => void;
}

/** Game host for the shared graphical Hall renderer and existing lifecycle actions. */
export class GreatHallView {
  readonly dialog: HTMLDialogElement;

  private readonly closeButton: HTMLButtonElement;
  private readonly primaryButton: HTMLButtonElement;
  private readonly newGameButton: HTMLButtonElement;
  private readonly renderer: GreatHallRenderer;
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
    dialog.setAttribute("aria-label", "The Great Hall lineage chronicle");
    dialog.innerHTML = `<section class="great-hall__panel">
      <button class="great-hall__close" data-great-hall-close type="button" aria-label="Return to the ship">×</button>
      <div class="great-hall__shared-renderer" data-great-hall-renderer></div>
      <footer class="great-hall__footer">
        <button class="great-hall__new-game" data-great-hall-new-game type="button">Start new game</button>
        <button data-great-hall-primary type="button">Return to ship</button>
      </footer>
    </section>`;
    host.append(dialog);
    this.dialog = dialog;
    this.closeButton = requiredElement(dialog, "[data-great-hall-close]");
    this.primaryButton = requiredElement(dialog, "[data-great-hall-primary]");
    this.newGameButton = requiredElement(dialog, "[data-great-hall-new-game]");
    this.renderer = new GreatHallRenderer(requiredElement(dialog, "[data-great-hall-renderer]"), {
      selectionChanged: (generation) => {
        this.selectedNavigatorId = this.chronicle?.navigators.find((entry) => entry.generation === generation)?.navigatorId;
        this.syncDiagnosticsData();
      },
    });

    this.closeButton.addEventListener("click", () => this.requestHomeClose(), { signal });
    this.primaryButton.addEventListener("click", () => {
      if (this.modeValue === "handover") this.callbacks.continueHandover();
      else if (this.modeValue === "completion") this.callbacks.continueCompletedWorld();
      else this.requestHomeClose();
    }, { signal });
    this.newGameButton.addEventListener("click", () => {
      if (this.modeValue === "completion") this.callbacks.startNewGame();
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

  get isOpen(): boolean { return this.dialog.open; }
  get mode(): GreatHallViewMode | undefined { return this.modeValue; }
  get selectedGeneration(): number | undefined { return this.modeValue ? this.renderer.selected : undefined; }

  showHome(chronicle: Readonly<GreatHallChronicle>, preferredNavigatorId?: NavigatorId, loggedVoyage?: number): void {
    this.show(chronicle, "home", preferredNavigatorId);
    if (loggedVoyage !== undefined) this.renderer.showVoyageLogging(this.renderer.selected, loggedVoyage);
    this.renderer.focusSelection();
  }

  showHandover(
    chronicle: Readonly<GreatHallChronicle>,
    outgoingNavigatorId: NavigatorId,
    nextGeneration: number,
    loggedVoyage?: number,
  ): void {
    const outgoing = chronicle.navigators.find(({ navigatorId }) => navigatorId === outgoingNavigatorId);
    if (!outgoing || outgoing.state === "active") {
      throw new RangeError(`Great Hall handover requires terminal navigator ${outgoingNavigatorId}`);
    }
    this.nextGeneration = nextGeneration;
    this.show(chronicle, "handover", outgoingNavigatorId);
    if (loggedVoyage !== undefined) this.renderer.showVoyageLogging(outgoing.generation, loggedVoyage);
    this.primaryButton.focus();
  }

  showCompletion(chronicle: Readonly<GreatHallChronicle>, findingNavigatorId: NavigatorId, loggedVoyage?: number): void {
    if (!chronicle.idolProgress.complete) {
      throw new RangeError("Great Hall completion requires every idol location to be returned");
    }
    if (!chronicle.navigators.some(({ navigatorId }) => navigatorId === findingNavigatorId)) {
      throw new RangeError(`Great Hall completion requires finding navigator ${findingNavigatorId}`);
    }
    this.show(chronicle, "completion", findingNavigatorId);
    if (loggedVoyage !== undefined) this.renderer.showVoyageLogging(this.renderer.selected, loggedVoyage);
    this.primaryButton.focus();
  }

  refresh(chronicle: Readonly<GreatHallChronicle>): void {
    if (!this.isOpen || !this.modeValue) return;
    this.chronicle = chronicle;
    if (!chronicle.navigators.some(({ navigatorId }) => navigatorId === this.selectedNavigatorId)) {
      this.selectedNavigatorId = chronicle.navigators.at(-1)?.navigatorId;
    }
    this.updateRenderer();
  }

  selectGeneration(generation: number): boolean {
    return this.isOpen && this.renderer.selectGeneration(generation, true);
  }

  hide(): boolean {
    const wasOpen = this.isOpen;
    if (typeof this.dialog.close === "function" && this.dialog.open) this.dialog.close();
    else this.dialog.removeAttribute("open");
    this.modeValue = undefined;
    this.chronicle = undefined;
    this.selectedNavigatorId = undefined;
    this.nextGeneration = undefined;
    for (const key of ["mode", "selectedGeneration", "navigatorState", "outcome", "nextGeneration", "idolProgress"]) {
      delete this.dialog.dataset[key];
    }
    return wasOpen;
  }

  destroy(): void {
    this.renderer.destroy();
    this.dialog.remove();
    this.modeValue = undefined;
    this.chronicle = undefined;
  }

  private show(
    chronicle: Readonly<GreatHallChronicle>,
    mode: GreatHallViewMode,
    preferredNavigatorId?: NavigatorId,
  ): void {
    this.chronicle = chronicle;
    this.modeValue = mode;
    this.selectedNavigatorId = chronicle.navigators.find(({ navigatorId }) => navigatorId === preferredNavigatorId)?.navigatorId
      ?? chronicle.navigators.at(-1)?.navigatorId;
    if (mode !== "handover") this.nextGeneration = undefined;
    this.updateRenderer();
    this.showDialog();
  }

  private updateRenderer(): void {
    if (!this.chronicle || !this.modeValue) return;
    this.renderer.update(adaptGreatHallChronicle(this.chronicle, {
      mode: this.modeValue,
      selectedNavigatorId: this.selectedNavigatorId,
      nextGeneration: this.nextGeneration,
    }));
    const home = this.modeValue === "home";
    const completion = this.modeValue === "completion";
    this.closeButton.hidden = !home;
    this.newGameButton.hidden = !completion;
    this.primaryButton.textContent = home ? "Return to ship"
      : this.modeValue === "handover" ? `Begin generation ${this.nextGeneration}` : "Continue exploring";
    this.syncDiagnosticsData();
  }

  private syncDiagnosticsData(): void {
    const entry = this.chronicle?.navigators.find(({ navigatorId }) => navigatorId === this.selectedNavigatorId);
    if (!entry || !this.chronicle || !this.modeValue) return;
    this.dialog.dataset.mode = this.modeValue;
    this.dialog.dataset.selectedGeneration = String(entry.generation);
    this.dialog.dataset.navigatorState = entry.state;
    this.dialog.dataset.outcome = entry.state === "completed" ? "tenure-completed" : entry.state === "lost" ? "lost-at-sea" : "active";
    this.dialog.dataset.idolProgress = `${this.chronicle.idolProgress.found}/${this.chronicle.idolProgress.total}`;
    if (this.nextGeneration === undefined) delete this.dialog.dataset.nextGeneration;
    else this.dialog.dataset.nextGeneration = String(this.nextGeneration);
  }

  private showDialog(): void {
    if (this.dialog.open) return;
    if (typeof this.dialog.show === "function") this.dialog.show();
    else this.dialog.setAttribute("open", "");
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
