export type {
  AudioPlaybackLifecycleEvent,
  AudioPlaybackPort,
  AudioPlaybackVoice,
  AudioPlaybackVoiceConfig,
} from "./AudioPlaybackPort";

export {
  phaserAudioCacheKey,
  preloadGameAudioCatalog,
  queueGameAudioCatalog,
} from "./GameAudioPreload";
export type { GameAudioLoader } from "./GameAudioPreload";

export {
  createPhaserAudioPlaybackPort,
  PhaserAudioPlaybackPort,
} from "./PhaserAudioPlaybackPort";

export { GameAudioController } from "./GameAudioController";
export type {
  GameAudioCategorySnapshot,
  GameAudioControllerOptions,
  GameAudioDiagnostics,
  GameAudioOwnedVoiceSnapshot,
  GameAudioPlayRejectionReason,
  GameAudioPlayRequest,
  GameAudioPlayResult,
  GameAudioSnapshot,
  GameAudioUnlockState,
} from "./GameAudioController";

export {
  GameAudioControlsBinding,
  gameAudioControlsModel,
  mountGameAudioControls,
  mountUnavailableGameAudioControls,
} from "./GameAudioControls";
export type {
  GameAudioControlActions,
  GameAudioControls,
  GameAudioControlsModel,
  GameAudioControlsTarget,
  GameAudioControlsView,
} from "./GameAudioControls";

export {
  OCEAN_AMBIENCE_VOICE_ID,
  SailingAmbienceController,
  WAKE_AMBIENCE_VOICE_ID,
} from "./SailingAmbienceController";
export type {
  SailingAmbienceAudioSnapshot,
  SailingAmbienceAudioTarget,
  SailingAmbienceDiagnostics,
} from "./SailingAmbienceController";
