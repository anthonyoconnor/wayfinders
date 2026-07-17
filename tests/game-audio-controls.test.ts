import { describe, expect, it } from "vitest";
import { AudioMixer, validateAudioCatalog } from "../src/wayfinders/audio";
import type { AudioPlaybackLifecycleEvent } from "../src/wayfinders/rendering/audio/AudioPlaybackPort";
import { GameAudioController } from "../src/wayfinders/rendering/audio/GameAudioController";
import {
  GameAudioControlsBinding,
  type GameAudioControlActions,
  type GameAudioControlsModel,
  type GameAudioControlsView,
} from "../src/wayfinders/rendering/audio/GameAudioControls";
import type { AudioPlaybackPort } from "../src/wayfinders/rendering/audio/AudioPlaybackPort";

class ControlsPlaybackPort implements AudioPlaybackPort {
  readonly available = true;
  locked = true;
  readonly suspended = false;
  private listener?: (event: AudioPlaybackLifecycleEvent) => void;

  hasAsset(): boolean { return false; }
  createVoice(): undefined { return undefined; }
  requestUnlock(): void { /* completed explicitly by the fixture */ }
  subscribe(listener: (event: AudioPlaybackLifecycleEvent) => void): () => void {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }
  completeUnlock(): void {
    this.locked = false;
    this.listener?.("unlocked");
  }
  destroy(): void { this.listener = undefined; }
}

class FakeControlsView implements GameAudioControlsView {
  actions?: Readonly<GameAudioControlActions>;
  readonly models: Readonly<GameAudioControlsModel>[] = [];
  destroyCalls = 0;

  bind(actions: Readonly<GameAudioControlActions>): void {
    this.actions = actions;
  }

  render(model: Readonly<GameAudioControlsModel>): void {
    this.models.push(model);
  }

  destroy(): void {
    this.destroyCalls++;
  }
}

describe("AUD-1 game audio controls binding", () => {
  it("binds exact master/category values, mute, and explicit unlock", () => {
    const catalog = validateAudioCatalog({
      schemaVersion: 1,
      libraryId: "wayfinders.audio.v1",
      masterVolume: 0.8,
      categories: {
        music: { displayName: "Music", defaultVolume: 0.42, voiceLimit: 2 },
        ambience: { displayName: "Ambience", defaultVolume: 0.275, voiceLimit: 3 },
        sfx: { displayName: "Sound effects", defaultVolume: 0.75, voiceLimit: 8 },
        ui: { displayName: "Interface", defaultVolume: 0.6, voiceLimit: 2 },
      },
      assets: [
        { id: "music.home", displayName: "Home", category: "music", file: "./v1/music/home.wav", loop: true, baseVolume: 1, description: "Home" },
        { id: "ambience.ocean", displayName: "Ocean", category: "ambience", file: "./v1/ambience/ocean.wav", loop: true, baseVolume: 1, description: "Ocean" },
        { id: "sfx.discovery", displayName: "Discovery", category: "sfx", file: "./v1/sfx/discovery.wav", loop: false, baseVolume: 1, description: "Discovery" },
        { id: "ui.confirm", displayName: "Confirm", category: "ui", file: "./v1/ui/confirm.wav", loop: false, baseVolume: 1, description: "Confirm" },
      ],
    });
    const port = new ControlsPlaybackPort();
    const controller = new GameAudioController({
      catalog,
      mixer: new AudioMixer(catalog),
      playback: port,
    });
    const view = new FakeControlsView();
    const uiActions: string[] = [];
    const binding = new GameAudioControlsBinding(
      controller,
      view,
      (action) => uiActions.push(action),
    );

    expect(view.models.at(-1)).toMatchObject({
      unlockState: "locked",
      muted: false,
      masterVolume: 0.8,
      controlsDisabled: false,
    });
    expect(view.models.at(-1)!.categories.map(({ id, displayName, volume }) => ({
      id,
      displayName,
      volume,
    }))).toEqual([
      { id: "music", displayName: "Music", volume: 0.42 },
      { id: "ambience", displayName: "Ambience", volume: 0.275 },
      { id: "sfx", displayName: "Sound effects", volume: 0.75 },
      { id: "ui", displayName: "Interface", volume: 0.6 },
    ]);

    view.actions!.setMasterVolume(0.35);
    view.actions!.setCategoryVolume("sfx", 0.25);
    view.actions!.setMuted(true);
    view.actions!.emitUiAction("cancel");
    expect(view.models.at(-1)).toMatchObject({ masterVolume: 0.35, muted: true });
    expect(view.models.at(-1)!.categories.find(({ id }) => id === "sfx")!.volume).toBe(0.25);
    expect(uiActions).toEqual(["toggle", "cancel"]);

    view.actions!.enableSound();
    expect(uiActions).toEqual(["toggle", "cancel", "toggle"]);
    expect(view.models.at(-1)!.unlockState).toBe("unlocking");
    port.completeUnlock();
    expect(view.models.at(-1)).toMatchObject({
      unlockState: "unlocked",
      status: "Sound is enabled and muted.",
    });

    const renderCount = view.models.length;
    binding.destroy();
    binding.destroy();
    controller.setMuted(false);
    expect(view.destroyCalls).toBe(1);
    expect(view.models).toHaveLength(renderCount);
  });
});
