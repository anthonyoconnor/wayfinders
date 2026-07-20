import Phaser from "phaser";
import {
  ACHIEVEMENT_ICON_CATALOG,
  ACHIEVEMENT_ICON_FRAME_COUNT,
  ACHIEVEMENT_ICON_FRAME_SIZE_PX,
  ACHIEVEMENT_ICON_FRAMES_PER_SECOND,
  ACHIEVEMENT_ICON_KINDS,
  ACHIEVEMENT_ICON_ROW_COUNT,
  ACHIEVEMENT_ICON_SHEET_URL,
  achievementIconRowPositionPercent,
} from "./AchievementIconCatalog";
import {
  assetWorkspaceSceneKey,
  type AchievementIconAssetWorkspaceModule,
} from "../workspaces/AssetWorkspace";

const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function playbackSpeedLabel(speed: PlaybackSpeed): string {
  return `${speed}×`;
}

/** Read-only review surface for every animated navigator-achievement icon. */
export class AchievementIconPreviewScene extends Phaser.Scene {
  private controlsAbort?: AbortController;
  private browser?: HTMLElement;
  private stage?: HTMLElement;
  private playbackSpeed: PlaybackSpeed = 1;
  private motionPaused = false;

  constructor(workspace: Readonly<AchievementIconAssetWorkspaceModule>) {
    super({ key: assetWorkspaceSceneKey(workspace.id) });
  }

  create(): void {
    this.add.rectangle(0, 0, 1_200, 800, 0x061923).setOrigin(0).setDepth(-1);
    this.mountWorkspace();
    this.render();
    const gameStatus = document.querySelector<HTMLElement>("#game-status");
    if (gameStatus) {
      gameStatus.textContent = `${ACHIEVEMENT_ICON_KINDS.length} animated achievement icons - view only`;
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroyBindings, this);
  }

  private mountWorkspace(): void {
    this.controlsAbort = new AbortController();
    const region = document.querySelector<HTMLElement>(".game-region");
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!region || !slot) throw new Error("Achievement icon preview requires the asset workspace shell");

    this.browser = document.createElement("aside");
    this.browser.className = "asset-library-browser achievement-icon-preview-browser";
    this.browser.setAttribute("aria-label", "Navigator achievement icon catalog");
    region.append(this.browser);

    this.stage = document.createElement("section");
    this.stage.className = "achievement-icon-preview-stage";
    this.stage.setAttribute("aria-label", "Animated navigator achievement icon preview");
    region.append(this.stage);

    slot.classList.add("tool-slot--connected", "achievement-icon-preview-tools");
    slot.addEventListener("click", this.onWorkbenchClick, { signal: this.controlsAbort.signal });
    slot.addEventListener("change", this.onWorkbenchChange, { signal: this.controlsAbort.signal });
  }

  private readonly onWorkbenchClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-icon-action="pause-play"]')
      : null;
    if (!target) return;
    this.motionPaused = !this.motionPaused;
    this.syncPlayback();
  };

  private readonly onWorkbenchChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.iconControl !== "speed") return;
    const speed = Number(target.value);
    if (speed !== 0.5 && speed !== 1 && speed !== 2) return;
    this.playbackSpeed = speed;
    this.syncPlayback();
  };

  private render(): void {
    this.renderBrowser();
    this.renderStage();
    this.renderWorkbench();
    this.syncPlayback();
  }

  private renderBrowser(): void {
    if (!this.browser) return;
    this.browser.innerHTML = `
      <header class="asset-library-header">
        <div><p class="eyebrow">Navigator achievements</p><h2>Icons</h2></div>
        <span>${ACHIEVEMENT_ICON_KINDS.length} loops</span>
      </header>
      <div class="achievement-icon-browser-body">
        <p>Every current achievement kind shares one checked-in sprite sheet and a synchronized loop.</p>
        <ol class="achievement-icon-browser-list">
          ${ACHIEVEMENT_ICON_KINDS.map((kind) => {
            const icon = ACHIEVEMENT_ICON_CATALOG[kind];
            return `<li><span aria-hidden="true">${String(icon.row + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(icon.shortLabel)}</strong><small><code>${escapeHtml(icon.kind)}</code></small></div></li>`;
          }).join("")}
        </ol>
      </div>`;
  }

  private renderStage(): void {
    if (!this.stage) return;
    this.stage.innerHTML = `
      <header class="achievement-icon-preview-heading">
        <div><p class="eyebrow">Full animated set</p><h2>Navigator achievement icons</h2></div>
        <p>All eight loops play together so silhouette, cadence, registration, and loop seams can be compared directly.</p>
      </header>
      <div class="achievement-icon-preview-grid" role="list" aria-label="Animated achievement icons">
        ${ACHIEVEMENT_ICON_KINDS.map((kind) => {
          const icon = ACHIEVEMENT_ICON_CATALOG[kind];
          const titleId = `achievement-icon-${kind}-title`;
          const descriptionId = `achievement-icon-${kind}-description`;
          const rowPosition = achievementIconRowPositionPercent(kind);
          return `<article
            class="achievement-icon-preview-card"
            data-achievement-icon="${escapeHtml(icon.kind)}"
            role="listitem"
            aria-labelledby="${titleId}"
            aria-describedby="${descriptionId}"
          >
            <div class="achievement-icon-preview-frame" aria-hidden="true">
              <span
                class="achievement-icon"
                data-achievement-icon-kind="${escapeHtml(icon.kind)}"
                style="--achievement-icon-row: ${icon.row}; --achievement-icon-row-position: ${rowPosition.toFixed(4)}%"
              ></span>
            </div>
            <div class="achievement-icon-preview-copy">
              <p class="eyebrow">Icon ${String(icon.row + 1).padStart(2, "0")}</p>
              <h3 id="${titleId}">${escapeHtml(icon.shortLabel)}</h3>
              <p id="${descriptionId}">${escapeHtml(icon.visualDescription)}</p>
              <code>${escapeHtml(icon.kind)}</code>
            </div>
          </article>`;
        }).join("")}
      </div>`;
  }

  private renderWorkbench(): void {
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    if (!slot) return;
    const sheetWidth = ACHIEVEMENT_ICON_FRAME_SIZE_PX * ACHIEVEMENT_ICON_FRAME_COUNT;
    const sheetHeight = ACHIEVEMENT_ICON_FRAME_SIZE_PX * ACHIEVEMENT_ICON_ROW_COUNT;
    slot.innerHTML = `<section class="asset-workbench achievement-icon-preview-workbench">
      <header><div><p class="eyebrow">Animation review</p><h3>Achievement sheet</h3></div><span>View only</span></header>
      <div class="achievement-icon-playback-controls" role="group" aria-label="Achievement icon playback">
        <button type="button" data-icon-action="pause-play" aria-pressed="false">Pause all loops</button>
        <label>Playback speed
          <select data-icon-control="speed">
            ${PLAYBACK_SPEEDS.map((speed) => `<option value="${speed}" ${speed === this.playbackSpeed ? "selected" : ""}>${playbackSpeedLabel(speed)}</option>`).join("")}
          </select>
        </label>
      </div>
      <output data-icon-output="status" role="status" aria-live="polite"></output>
      <dl class="achievement-icon-preview-metadata">
        <div><dt>Sprite sheet</dt><dd><code>${escapeHtml(ACHIEVEMENT_ICON_SHEET_URL)}</code></dd></div>
        <div><dt>Layout</dt><dd>${ACHIEVEMENT_ICON_ROW_COUNT} rows × ${ACHIEVEMENT_ICON_FRAME_COUNT} frames</dd></div>
        <div><dt>Frame</dt><dd>${ACHIEVEMENT_ICON_FRAME_SIZE_PX} × ${ACHIEVEMENT_ICON_FRAME_SIZE_PX} px</dd></div>
        <div><dt>Canvas</dt><dd>${sheetWidth} × ${sheetHeight} px</dd></div>
        <div><dt>Base cadence</dt><dd>${ACHIEVEMENT_ICON_FRAMES_PER_SECOND} fps</dd></div>
      </dl>
      <p>Pause or slow the synchronized set to compare frame registration and the final-to-first loop seam.</p>
      <p class="achievement-icon-preview-readonly">This workspace has no upload, editing, generation, or repository-write controls.</p>
    </section>`;
  }

  private syncPlayback(): void {
    const durationMs = ACHIEVEMENT_ICON_FRAME_COUNT
      / (ACHIEVEMENT_ICON_FRAMES_PER_SECOND * this.playbackSpeed)
      * 1_000;
    if (this.stage) {
      this.stage.dataset.animationPaused = String(this.motionPaused);
      this.stage.style.setProperty("--achievement-icon-animation-duration", `${durationMs.toFixed(3)}ms`);
    }
    const slot = document.querySelector<HTMLElement>("#scene-tools-slot");
    const button = slot?.querySelector<HTMLButtonElement>('[data-icon-action="pause-play"]');
    if (button) {
      button.setAttribute("aria-pressed", String(this.motionPaused));
      button.textContent = this.motionPaused ? "Play all loops" : "Pause all loops";
    }
    const speed = slot?.querySelector<HTMLSelectElement>('[data-icon-control="speed"]');
    if (speed) speed.value = String(this.playbackSpeed);
    const status = slot?.querySelector<HTMLOutputElement>('[data-icon-output="status"]');
    if (status) {
      status.value = this.motionPaused
        ? `All loops paused at ${playbackSpeedLabel(this.playbackSpeed)} speed.`
        : `All loops playing at ${playbackSpeedLabel(this.playbackSpeed)} speed.`;
    }
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
      slot.classList.remove("tool-slot--connected", "achievement-icon-preview-tools");
    }
  }
}
