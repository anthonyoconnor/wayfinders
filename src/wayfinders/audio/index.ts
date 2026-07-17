export {
  AUDIO_CATEGORIES,
  AUDIO_CATALOG_SCHEMA_VERSION,
  AUDIO_CATALOG_URL,
  AUDIO_LIBRARY_ID,
  audioAssetById,
  loadAudioCatalog,
  resolveAudioAssetUrl,
  tryLoadAudioCatalog,
  validateAudioCatalog,
} from "./AudioCatalog";
export type {
  AudioAssetDefinition,
  AudioCatalog,
  AudioCatalogFetcher,
  AudioCatalogFetchResponse,
  AudioCatalogLoadResult,
  AudioCategory,
  AudioCategoryDefinition,
} from "./AudioCatalog";

export {
  AUDIO_TOTAL_VOICE_LIMIT,
  AudioMixer,
} from "./AudioMixer";
export type {
  AudioMixerMutation,
  AudioMixerOptions,
  AudioMixerSnapshot,
  AudioVoiceDecision,
  AudioVoiceRecord,
  AudioVoiceRejectionReason,
  AudioVoiceRequest,
} from "./AudioMixer";

export {
  SAILING_AMBIENCE_GAIN_EPSILON,
  SAILING_AMBIENCE_OCEAN_GAIN,
  SAILING_AMBIENCE_WAKE_ATTACK_SECONDS,
  SAILING_AMBIENCE_WAKE_RELEASE_SECONDS,
  SAILING_AMBIENCE_WAKE_START_SPEED,
  SAILING_AMBIENCE_WAKE_STOP_SPEED,
  SailingAmbienceState,
} from "./SailingAmbience";
export type {
  SailingAmbienceInput,
  SailingAmbienceStateSnapshot,
} from "./SailingAmbience";

export {
  AUDIO_CUE_SOURCES,
  AudioCuePolicy,
} from "./AudioCuePolicy";
export type {
  ActiveAudioCueVoice,
  AudioCueDecision,
  AudioCueFamily,
  AudioCueIntention,
  AudioCueReplacement,
  AudioCueSource,
  AudioCueSuppressionReason,
  AudioUiCueAction,
} from "./AudioCuePolicy";
