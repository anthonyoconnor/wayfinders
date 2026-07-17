import Phaser from "phaser";
import {
  AudioPreviewPlayer,
  createBrowserAudioPreviewMedia,
  formatAudioPreviewTime,
  type AudioPreviewAsset,
  type AudioPreviewMediaFactory,
  type AudioPreviewState,
} from "./AudioPreviewPlayer";
import {
  groupAudioWorkspaceAssets,
  type AudioWorkspaceCatalog,
  type AudioWorkspaceCatalogSource,
  type AudioWorkspaceGroup,
} from "../workspaces/AudioWorkspaceCatalog";
import {
  assetWorkspaceSceneKey,
  type AudioAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function playbackStatusText(state: Readonly<AudioPreviewState>): string {
  switch (state.status) {
    case "loading": return "Loading stored file metadata";
    case "ready": return "Ready to play";
    case "playing": return state.asset.loop ? "Playing loop" : "Playing one-shot";
    case "paused": return "Paused";
    case "stopped": return "Stopped";
    case "error": return "Playback unavailable";
  }
}

/** Play-only DOM workspace. It owns no repository or HTTP mutation seam. */
export class AudioAssetWorkspaceScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private player?: AudioPreviewPlayer;
  private catalog?: Readonly<AudioWorkspaceCatalog>;
  private groups: readonly Readonly<AudioWorkspaceGroup>[] = [];
  private selectedAssetId?: string;

  constructor(
    workspace: Readonly<AudioAssetWorkspaceModule>,
    private readonly catalogSource: Readonly<AudioWorkspaceCatalogSource>,
    private readonly createMedia: AudioPreviewMediaFactory = createBrowserAudioPreviewMedia,
  ) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.mountWorkspace();
    const catalog = this.catalogSource.catalog;
    if (!catalog) {
      this.renderLoadFailure(this.catalogSource.error ?? "The audio catalog is unavailable.");
    } else {
      try {
        this.groups = groupAudioWorkspaceAssets(catalog);
        if (catalog.assets.length === 0) throw new RangeError("The audio catalog contains no assets.");
        this.catalog = catalog;
        this.selectedAssetId = catalog.assets.some((asset) => asset.id === this.selectedAssetId)
          ? this.selectedAssetId
          : catalog.assets[0]!.id;
        this.renderBrowser();
        this.renderPreviewShell();
        this.renderWorkbench();
        this.player = new AudioPreviewPlayer((state) => this.updatePlaybackState(state), this.createMedia);
        this.player.select(this.selectedAsset()!);
        this.reportShellStatus("Audio library - play-only stored-file preview");
      } catch (error) {
        this.renderLoadFailure(error instanceof Error ? error.message : "The audio catalog is invalid.");
      }
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Audio preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser audio-library-browser";
    this.browser.setAttribute("aria-label", "Stored sound library");
    region.append(this.browser);

    this.stage = document.createElement("section");
    this.stage.className = "audio-preview-stage";
    this.stage.setAttribute("aria-label", "Selected audio preview");
    region.append(this.stage);

    slot.classList.add("tool-slot--connected", "audio-preview-tools");
    this.browser.addEventListener("click", this.onBrowserClick, { signal: this.controlsAbort.signal });
    this.stage.addEventListener("click", this.onStageClick, { signal: this.controlsAbort.signal });
  }

  private readonly onBrowserClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-audio-asset]")
      : null;
    const assetId = target?.dataset.audioAsset;
    if (!assetId || assetId === this.selectedAssetId) return;
    const asset = this.catalog?.assets.find((candidate) => candidate.id === assetId);
    if (!asset) return;
    this.selectedAssetId = asset.id;
    this.updateSelectedButtons();
    this.renderPreviewShell();
    this.renderWorkbench();
    this.player?.select(asset);
  };

  private readonly onStageClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-audio-action]")
      : null;
    switch (target?.dataset.audioAction) {
      case "play":
        void this.player?.playFromStart();
        break;
      case "pause-resume":
        void this.player?.pauseOrResume();
        break;
      case "stop":
        this.player?.stop();
        break;
    }
  };

  private renderBrowser(): void {
    if (!this.browser || !this.catalog) return;
    this.browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">Stored sound library</p><h2>Audio</h2></div>
        <span>Play only</span>
      </header>
      <div class="asset-library-groups audio-library-groups">
        ${this.groups.map((group) => this.groupMarkup(group)).join("")}
      </div>`;
  }

  private groupMarkup(group: Readonly<AudioWorkspaceGroup>): string {
    return `<section class="asset-library-group audio-library-group" aria-labelledby="audio-category-${escapeHtml(group.category.id)}">
      <header><h3 id="audio-category-${escapeHtml(group.category.id)}">${escapeHtml(group.category.displayName)}</h3><span>${group.assets.length}</span></header>
      <div class="asset-library-list">
        ${group.assets.map((asset) => `<button
          type="button"
          class="audio-library-item"
          data-audio-asset="${escapeHtml(asset.id)}"
          aria-pressed="${asset.id === this.selectedAssetId}"
        >
          <span class="audio-library-item__glyph" aria-hidden="true">${asset.loop ? "L" : ">"}</span>
          <span class="asset-library-item-copy"><strong>${escapeHtml(asset.displayName)}</strong><small>${escapeHtml(asset.description)}</small></span>
          <span class="asset-library-status">${asset.loop ? "Loop" : "One-shot"}</span>
        </button>`).join("")}
      </div>
    </section>`;
  }

  private renderPreviewShell(): void {
    const asset = this.selectedAsset();
    if (!this.stage || !asset) return;
    this.stage.innerHTML = `<article class="audio-preview-card">
      <header>
        <div><p class="eyebrow">Selected stored file</p><h2>${escapeHtml(asset.displayName)}</h2></div>
        <span class="audio-preview-kind">${asset.loop ? "Continuous loop" : "One-shot sound"}</span>
      </header>
      <p class="audio-preview-description">${escapeHtml(asset.description)}</p>
      <dl class="audio-preview-facts">
        <div><dt>Category</dt><dd>${escapeHtml(this.categoryName(asset.category))}</dd></div>
        <div><dt>Loop status</dt><dd>${asset.loop ? "Loops continuously" : "Stops at the end"}</dd></div>
        <div><dt>Browser duration</dt><dd data-audio-output="duration">Detecting...</dd></div>
      </dl>
      <div class="audio-preview-progress">
        <progress data-audio-output="progress" max="1" value="0" aria-label="Playback progress"><span>0%</span></progress>
        <output data-audio-output="time">0:00 / --:--</output>
      </div>
      <div class="audio-preview-actions" role="group" aria-label="Preview playback">
        <button type="button" data-audio-action="play">Play from start</button>
        <button type="button" data-audio-action="pause-resume" disabled>Pause</button>
        <button type="button" data-audio-action="stop" disabled>Stop</button>
      </div>
      <p class="audio-preview-status" data-audio-output="status" role="status" aria-live="polite">Loading stored file metadata</p>
      <p class="audio-preview-error" data-audio-output="error" role="alert" hidden></p>
    </article>`;
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    const asset = this.selectedAsset();
    if (!slot || !asset || !this.catalog) return;
    slot.innerHTML = `<section class="asset-workbench audio-preview-workbench">
      <header><div><p class="eyebrow">Selected catalog entry</p><h3>${escapeHtml(asset.displayName)}</h3></div><span>Read only</span></header>
      <dl class="audio-preview-metadata">
        <div><dt>Stable ID</dt><dd><code>${escapeHtml(asset.id)}</code></dd></div>
        <div><dt>Library</dt><dd><code>${escapeHtml(this.catalog.libraryId)}</code></dd></div>
        <div><dt>Stored file</dt><dd><code>${escapeHtml(asset.sourceUrl)}</code></dd></div>
      </dl>
      <p>Playback uses the checked-in file as stored. Replacing its bytes at this path preserves the runtime binding.</p>
      <p class="audio-preview-readonly">This workspace has no creation, upload, editing, mixing, metadata, or repository actions.</p>
    </section>`;
  }

  private renderLoadFailure(message: string): void {
    if (this.browser) {
      this.browser.innerHTML = `<header class="asset-library-header"><div><p class="eyebrow">Stored sound library</p><h2>Audio</h2></div><span>Unavailable</span></header>
        <section class="audio-library-failure" role="alert"><h3>Catalog unavailable</h3><p>${escapeHtml(message)}</p><p>Other asset workspaces remain available.</p></section>`;
    }
    if (this.stage) {
      this.stage.innerHTML = `<article class="audio-preview-card audio-preview-card--error"><p class="eyebrow">Play-only preview</p><h2>Audio could not be loaded</h2><p>${escapeHtml(message)}</p></article>`;
    }
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) slot.innerHTML = `<section class="asset-workbench audio-preview-workbench"><header><h3>Audio catalog</h3><span>Read only</span></header><p role="alert">${escapeHtml(message)}</p></section>`;
    this.reportShellStatus(`Audio catalog unavailable: ${message}`);
  }

  private updatePlaybackState(state: Readonly<AudioPreviewState>): void {
    if (!this.stage || state.asset.id !== this.selectedAssetId) return;
    const duration = state.durationSeconds;
    const current = Math.min(state.currentTimeSeconds, duration ?? state.currentTimeSeconds);
    const progress = this.stage.querySelector<HTMLProgressElement>('[data-audio-output="progress"]');
    if (progress) {
      progress.max = duration && duration > 0 ? duration : 1;
      progress.value = current;
    }
    const durationOutput = this.stage.querySelector<HTMLElement>('[data-audio-output="duration"]');
    if (durationOutput) durationOutput.textContent = duration === undefined
      ? "Waiting for browser metadata"
      : formatAudioPreviewTime(duration);
    const timeOutput = this.stage.querySelector<HTMLOutputElement>('[data-audio-output="time"]');
    if (timeOutput) timeOutput.value = `${formatAudioPreviewTime(current)} / ${formatAudioPreviewTime(duration)}`;
    const statusOutput = this.stage.querySelector<HTMLElement>('[data-audio-output="status"]');
    const statusText = playbackStatusText(state);
    if (statusOutput && statusOutput.textContent !== statusText) statusOutput.textContent = statusText;
    const errorOutput = this.stage.querySelector<HTMLElement>('[data-audio-output="error"]');
    if (errorOutput) {
      errorOutput.hidden = !state.error;
      const errorText = state.error ?? "";
      if (errorOutput.textContent !== errorText) errorOutput.textContent = errorText;
    }
    const pauseResume = this.stage.querySelector<HTMLButtonElement>('[data-audio-action="pause-resume"]');
    if (pauseResume) {
      pauseResume.disabled = state.status !== "playing" && state.status !== "paused";
      pauseResume.textContent = state.status === "paused" ? "Resume" : "Pause";
    }
    const stop = this.stage.querySelector<HTMLButtonElement>('[data-audio-action="stop"]');
    if (stop) stop.disabled = state.status !== "playing" && state.status !== "paused";
  }

  private updateSelectedButtons(): void {
    for (const button of this.browser?.querySelectorAll<HTMLElement>("[data-audio-asset]") ?? []) {
      const selected = button.dataset.audioAsset === this.selectedAssetId;
      button.setAttribute("aria-pressed", String(selected));
      button.dataset.active = String(selected);
    }
  }

  private categoryName(categoryId: string): string {
    return this.catalog?.categories.find((category) => category.id === categoryId)?.displayName ?? categoryId;
  }

  private selectedAsset(): Readonly<AudioPreviewAsset> | undefined {
    return this.catalog?.assets.find((asset) => asset.id === this.selectedAssetId);
  }

  private reportShellStatus(message: string): void {
    const status = document.querySelector<HTMLElement>("#game-status");
    if (status) status.textContent = message;
  }

  private destroyBindings(): void {
    this.controlsAbort?.abort();
    this.controlsAbort = undefined;
    this.player?.destroy();
    this.player = undefined;
    this.browser?.remove();
    this.browser = undefined;
    this.stage?.remove();
    this.stage = undefined;
    this.catalog = undefined;
    this.groups = [];
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (slot) {
      slot.replaceChildren();
      slot.classList.remove("tool-slot--connected", "audio-preview-tools");
    }
  }
}
