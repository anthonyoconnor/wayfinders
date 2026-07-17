import {
  AUDIO_CATEGORIES,
  type AudioCategory,
  type AudioUiCueAction,
} from "../../audio";
import type { GameAudioSnapshot, GameAudioUnlockState } from "./GameAudioController";

export interface GameAudioControlsTarget {
  getSnapshot(): Readonly<GameAudioSnapshot>;
  subscribe(listener: (snapshot: Readonly<GameAudioSnapshot>) => void): () => void;
  enableSound(): void;
  setMuted(muted: boolean): void;
  setMasterVolume(volume: number): void;
  setCategoryVolume(category: AudioCategory, volume: number): void;
}

export interface GameAudioControlActions {
  readonly enableSound: () => void;
  readonly setMuted: (muted: boolean) => void;
  readonly setMasterVolume: (volume: number) => void;
  readonly setCategoryVolume: (category: AudioCategory, volume: number) => void;
  readonly emitUiAction: (action: AudioUiCueAction) => void;
}

export interface GameAudioControlsModel {
  readonly unlockState: GameAudioUnlockState;
  readonly status: string;
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly controlsDisabled: boolean;
  readonly categories: readonly Readonly<{
    id: AudioCategory;
    displayName: string;
    volume: number;
  }>[];
}

export interface GameAudioControlsView {
  bind(actions: Readonly<GameAudioControlActions>): void;
  render(model: Readonly<GameAudioControlsModel>): void;
  destroy(): void;
}

export interface GameAudioControls {
  destroy(): void;
}

/** Keeps DOM mechanics separate from the controller and is deterministic under a fake view. */
export class GameAudioControlsBinding implements GameAudioControls {
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    target: GameAudioControlsTarget,
    private readonly view: GameAudioControlsView,
    onUiAction: (action: AudioUiCueAction) => void = () => undefined,
  ) {
    view.bind({
      enableSound: () => {
        target.enableSound();
        onUiAction("toggle");
      },
      setMuted: (muted) => {
        target.setMuted(muted);
        onUiAction("toggle");
      },
      setMasterVolume: (volume) => target.setMasterVolume(volume),
      setCategoryVolume: (category, volume) => target.setCategoryVolume(category, volume),
      emitUiAction: onUiAction,
    });
    view.render(gameAudioControlsModel(target.getSnapshot()));
    this.unsubscribe = target.subscribe((snapshot) => {
      if (!this.destroyed) view.render(gameAudioControlsModel(snapshot));
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.view.destroy();
  }
}

export function gameAudioControlsModel(
  snapshot: Readonly<GameAudioSnapshot>,
): Readonly<GameAudioControlsModel> {
  return Object.freeze({
    unlockState: snapshot.unlockState,
    status: audioStatus(snapshot),
    muted: snapshot.muted,
    masterVolume: snapshot.masterVolume,
    controlsDisabled: snapshot.unlockState === "unavailable" || snapshot.unlockState === "destroyed",
    categories: Object.freeze(AUDIO_CATEGORIES.map((category) => Object.freeze({
      id: category,
      displayName: snapshot.categories[category].displayName,
      volume: snapshot.categories[category].volume,
    }))),
  });
}

export function mountGameAudioControls(
  root: HTMLElement,
  target: GameAudioControlsTarget,
  onUiAction?: (action: AudioUiCueAction) => void,
): GameAudioControls {
  return new GameAudioControlsBinding(target, new DomGameAudioControlsView(root), onUiAction);
}

/**
 * Catalog load failure happens before a controller can be constructed. Keep a
 * visible, non-blocking game-only status surface for that silent fallback.
 */
export function mountUnavailableGameAudioControls(
  root: HTMLElement,
  message = "Sound files could not be loaded. The game remains fully playable without audio.",
): GameAudioControls {
  assertNoAudioControls(root);
  const document = root.ownerDocument;
  const abort = new AbortController();
  const container = document.createElement("section");
  container.className = "game-audio-controls";
  container.dataset.gameAudioControls = "unavailable";

  const toggle = document.createElement("button");
  toggle.className = "game-audio-controls__toggle";
  toggle.type = "button";
  toggle.textContent = "Sound";
  toggle.setAttribute("aria-controls", "game-audio-panel");
  toggle.setAttribute("aria-expanded", "false");

  const panel = document.createElement("section");
  panel.id = "game-audio-panel";
  panel.className = "game-audio-controls__panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Sound controls");

  const status = document.createElement("p");
  status.className = "game-audio-controls__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = message;
  panel.append(status);
  container.append(toggle, panel);
  root.append(container);

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
  }, { signal: abort.signal });

  let destroyed = false;
  return Object.freeze({
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      container.remove();
    },
  });
}

class DomGameAudioControlsView implements GameAudioControlsView {
  private readonly abort = new AbortController();
  private readonly container: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly enable: HTMLButtonElement;
  private readonly mute: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly master: HTMLInputElement;
  private readonly masterOutput: HTMLOutputElement;
  private readonly categoryInputs = new Map<AudioCategory, HTMLInputElement>();
  private readonly categoryOutputs = new Map<AudioCategory, HTMLOutputElement>();
  private readonly categoryLabels = new Map<AudioCategory, HTMLElement>();
  private actions?: Readonly<GameAudioControlActions>;
  private muted = false;
  private destroyed = false;

  constructor(root: HTMLElement) {
    assertNoAudioControls(root);
    const document = root.ownerDocument;
    const container = document.createElement("section");
    container.className = "game-audio-controls";
    container.dataset.gameAudioControls = "available";
    container.innerHTML = `
      <button class="game-audio-controls__toggle" type="button" aria-controls="game-audio-panel" aria-expanded="false">Sound</button>
      <section id="game-audio-panel" class="game-audio-controls__panel" aria-label="Sound controls" hidden>
        <p class="game-audio-controls__status" role="status" aria-live="polite"></p>
        <div class="game-audio-controls__actions">
          <button type="button" data-game-audio-enable>Enable sound</button>
          <button type="button" data-game-audio-mute aria-pressed="false">Mute all sound</button>
        </div>
        <fieldset class="game-audio-controls__levels">
          <legend>Volume levels</legend>
          <label>
            <span>Master</span>
            <input type="range" min="0" max="1" step="0.01" data-game-audio-master>
            <output data-game-audio-master-output></output>
          </label>
          ${AUDIO_CATEGORIES.map((category) => `
            <label>
              <span data-game-audio-category-label="${category}"></span>
              <input type="range" min="0" max="1" step="0.01" data-game-audio-category="${category}">
              <output data-game-audio-category-output="${category}"></output>
            </label>
          `).join("")}
        </fieldset>
      </section>
    `;
    root.append(container);

    this.container = container;
    this.panel = requiredElement(container, "#game-audio-panel");
    this.toggle = requiredElement(container, ".game-audio-controls__toggle");
    this.enable = requiredElement(container, "[data-game-audio-enable]");
    this.mute = requiredElement(container, "[data-game-audio-mute]");
    this.status = requiredElement(container, ".game-audio-controls__status");
    this.master = requiredElement(container, "[data-game-audio-master]");
    this.masterOutput = requiredElement(container, "[data-game-audio-master-output]");
    for (const category of AUDIO_CATEGORIES) {
      this.categoryInputs.set(
        category,
        requiredElement(container, `[data-game-audio-category="${category}"]`),
      );
      this.categoryOutputs.set(
        category,
        requiredElement(container, `[data-game-audio-category-output="${category}"]`),
      );
      this.categoryLabels.set(
        category,
        requiredElement(container, `[data-game-audio-category-label="${category}"]`),
      );
    }
  }

  bind(actions: Readonly<GameAudioControlActions>): void {
    if (this.actions) throw new Error("Game audio controls are already bound");
    this.actions = actions;
    const signal = this.abort.signal;
    this.toggle.addEventListener("click", () => {
      this.setOpen(this.panel.hidden);
      actions.emitUiAction("toggle");
    }, { signal });
    this.container.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || this.panel.hidden) return;
      event.preventDefault();
      this.setOpen(false);
      this.toggle.focus();
      actions.emitUiAction("cancel");
    }, { signal });
    this.enable.addEventListener("click", actions.enableSound, { signal });
    this.mute.addEventListener("click", () => actions.setMuted(!this.muted), { signal });
    this.master.addEventListener("input", () => actions.setMasterVolume(this.master.valueAsNumber), { signal });
    this.master.addEventListener("change", () => actions.emitUiAction("toggle"), { signal });
    for (const category of AUDIO_CATEGORIES) {
      const input = this.categoryInputs.get(category)!;
      input.addEventListener("input", () => actions.setCategoryVolume(category, input.valueAsNumber), { signal });
      input.addEventListener("change", () => actions.emitUiAction("toggle"), { signal });
    }
  }

  render(model: Readonly<GameAudioControlsModel>): void {
    if (this.destroyed) return;
    this.muted = model.muted;
    if (this.status.textContent !== model.status) this.status.textContent = model.status;
    this.enable.hidden = model.unlockState === "unlocked"
      || model.unlockState === "unavailable"
      || model.unlockState === "destroyed";
    this.enable.disabled = model.unlockState === "unlocking";
    this.enable.textContent = model.unlockState === "unlocking" ? "Enabling sound…" : "Enable sound";
    this.mute.disabled = model.controlsDisabled;
    this.mute.textContent = model.muted ? "Unmute all sound" : "Mute all sound";
    this.mute.setAttribute("aria-pressed", String(model.muted));
    setRangeValue(this.master, this.masterOutput, model.masterVolume, model.controlsDisabled);
    for (const category of model.categories) {
      this.categoryLabels.get(category.id)!.textContent = category.displayName;
      setRangeValue(
        this.categoryInputs.get(category.id)!,
        this.categoryOutputs.get(category.id)!,
        category.volume,
        model.controlsDisabled,
      );
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.container.remove();
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
  }
}

function audioStatus(snapshot: Readonly<GameAudioSnapshot>): string {
  if (snapshot.unlockState === "destroyed") return "Sound controls are no longer connected.";
  if (snapshot.unlockState === "unavailable") {
    return "Sound is unavailable in this browser. The game remains fully playable without audio.";
  }
  if (snapshot.unlockState === "unlocking") return "Enabling sound…";
  if (snapshot.unlockState === "locked") {
    return snapshot.browserLocked
      ? "Sound is locked until you enable it."
      : "Sound is ready. Enable it when you want to listen.";
  }
  if (snapshot.suspended) return "Sound is enabled and paused while the game is out of focus.";
  return snapshot.muted ? "Sound is enabled and muted." : "Sound is enabled.";
}

function setRangeValue(
  input: HTMLInputElement,
  output: HTMLOutputElement,
  value: number,
  disabled: boolean,
): void {
  const percent = Math.round(value * 100);
  input.value = String(value);
  input.disabled = disabled;
  input.setAttribute("aria-valuetext", `${percent} percent`);
  output.value = `${percent}%`;
}

function requiredElement<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Game audio controls are missing ${selector}`);
  return element;
}

function assertNoAudioControls(root: HTMLElement): void {
  if (root.querySelector("[data-game-audio-controls]")) {
    throw new Error("Game audio controls are already mounted in this root");
  }
}
