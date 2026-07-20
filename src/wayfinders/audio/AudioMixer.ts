import {
  AUDIO_CATEGORIES,
  audioAssetById,
  type AudioAssetDefinition,
  type AudioCatalog,
  type AudioCategory,
} from "./AudioCatalog";

export const AUDIO_TOTAL_VOICE_LIMIT = 15;

export interface AudioVoiceRequest {
  readonly voiceId: string;
  readonly assetId: string;
  readonly priority: number;
}

export interface AudioVoiceRecord extends AudioVoiceRequest {
  readonly category: AudioCategory;
  /** Monotonic registration order used for deterministic replacement. */
  readonly sequence: number;
}

export interface AudioMixerSnapshot {
  readonly revision: number;
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly categoryVolumes: Readonly<Record<AudioCategory, number>>;
  readonly categoryVoiceLimits: Readonly<Record<AudioCategory, number>>;
  readonly totalVoiceLimit: number;
  readonly activeVoiceCount: number;
  readonly activeVoicesByCategory: Readonly<Record<AudioCategory, number>>;
  readonly activeVoices: readonly Readonly<AudioVoiceRecord>[];
}

export interface AudioMixerMutation {
  readonly kind: "none" | "changed";
  readonly previousRevision: number;
  readonly revision: number;
}

export type AudioVoiceRejectionReason =
  | "duplicate-voice-id"
  | "category-limit"
  | "total-limit";

export type AudioVoiceDecision =
  | Readonly<{
    kind: "accepted";
    voice: Readonly<AudioVoiceRecord>;
    mutation: Readonly<AudioMixerMutation>;
  }>
  | Readonly<{
    kind: "replaced";
    voice: Readonly<AudioVoiceRecord>;
    replacedVoice: Readonly<AudioVoiceRecord>;
    replacedVoiceId: string;
    mutation: Readonly<AudioMixerMutation>;
  }>
  | Readonly<{
    kind: "rejected";
    reason: AudioVoiceRejectionReason;
    mutation: Readonly<AudioMixerMutation>;
  }>;

export interface AudioMixerOptions {
  readonly muted?: boolean;
  readonly masterVolume: number;
  readonly categoryVolumes: Readonly<Record<AudioCategory, number>>;
  readonly totalVoiceLimit?: number;
}

/**
 * Renderer-neutral in-memory game mixer and bounded voice ledger.
 *
 * It owns policy state only. Playback instances remain owned by the rendering
 * adapter, which applies accepted/replaced decisions and releases ended voices.
 */
export class AudioMixer {
  private readonly catalog: Readonly<AudioCatalog>;
  private readonly assetsById: ReadonlyMap<string, Readonly<AudioAssetDefinition>>;
  private readonly categoryVoiceLimits: Readonly<Record<AudioCategory, number>>;
  private readonly totalVoiceLimit: number;
  private readonly activeVoices = new Map<string, Readonly<AudioVoiceRecord>>();

  private muted = false;
  private masterVolume: number;
  private categoryVolumes: Record<AudioCategory, number>;
  private revision = 0;
  private nextVoiceSequence = 1;
  private snapshotCache: Readonly<AudioMixerSnapshot> | undefined;

  constructor(catalog: Readonly<AudioCatalog>, options: Readonly<AudioMixerOptions>) {
    this.catalog = catalog;
    this.assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
    this.muted = options.muted ?? false;
    if (typeof this.muted !== "boolean") throw new TypeError("muted must be a boolean");
    this.masterVolume = initialGain(options.masterVolume, "masterVolume");
    this.categoryVolumes = categoryNumberRecord((category) => initialGain(
      options.categoryVolumes[category],
      `categoryVolumes.${category}`,
    ));
    this.categoryVoiceLimits = Object.freeze(
      categoryNumberRecord((category) => catalog.categories[category].voiceLimit),
    );
    this.totalVoiceLimit = positiveIntegerAtMost(
      options.totalVoiceLimit ?? AUDIO_TOTAL_VOICE_LIMIT,
      "totalVoiceLimit",
      AUDIO_TOTAL_VOICE_LIMIT,
    );
  }

  getSnapshot(): Readonly<AudioMixerSnapshot> {
    if (this.snapshotCache) return this.snapshotCache;
    const activeVoices = Object.freeze([...this.activeVoices.values()].sort(
      (left, right) => left.sequence - right.sequence,
    ));
    const activeVoicesByCategory = categoryNumberRecord(() => 0);
    for (const voice of activeVoices) activeVoicesByCategory[voice.category]++;
    this.snapshotCache = Object.freeze({
      revision: this.revision,
      muted: this.muted,
      masterVolume: this.masterVolume,
      categoryVolumes: Object.freeze({ ...this.categoryVolumes }),
      categoryVoiceLimits: this.categoryVoiceLimits,
      totalVoiceLimit: this.totalVoiceLimit,
      activeVoiceCount: activeVoices.length,
      activeVoicesByCategory: Object.freeze(activeVoicesByCategory),
      activeVoices,
    });
    return this.snapshotCache;
  }

  setMuted(muted: boolean): Readonly<AudioMixerMutation> {
    if (typeof muted !== "boolean") throw new TypeError("muted must be a boolean");
    if (this.muted === muted) return noMutation(this.revision);
    const previousRevision = this.beginMutation();
    this.muted = muted;
    return changedMutation(previousRevision, this.revision);
  }

  setMasterVolume(volume: number): Readonly<AudioMixerMutation> {
    const next = clampedGain(volume, "masterVolume");
    if (Object.is(this.masterVolume, next)) return noMutation(this.revision);
    const previousRevision = this.beginMutation();
    this.masterVolume = next;
    return changedMutation(previousRevision, this.revision);
  }

  setCategoryVolume(category: AudioCategory, volume: number): Readonly<AudioMixerMutation> {
    assertCategory(category);
    const next = clampedGain(volume, `categoryVolumes.${category}`);
    if (Object.is(this.categoryVolumes[category], next)) return noMutation(this.revision);
    const previousRevision = this.beginMutation();
    this.categoryVolumes[category] = next;
    return changedMutation(previousRevision, this.revision);
  }

  effectiveGain(assetId: string, transitionGain = 1): number {
    const asset = this.assetsById.get(assetId) ?? audioAssetById(this.catalog, assetId);
    const transition = clampedGain(transitionGain, "transitionGain");
    if (this.muted) return 0;
    return this.masterVolume
      * this.categoryVolumes[asset.category]
      * asset.baseVolume
      * transition;
  }

  requestVoice(request: Readonly<AudioVoiceRequest>): AudioVoiceDecision {
    const voiceId = voiceIdentifier(request.voiceId);
    if (this.activeVoices.has(voiceId)) {
      return Object.freeze({
        kind: "rejected",
        reason: "duplicate-voice-id",
        mutation: noMutation(this.revision),
      });
    }
    const asset = this.assetsById.get(request.assetId) ?? audioAssetById(this.catalog, request.assetId);
    const priority = voicePriority(request.priority);
    const categoryVoices = [...this.activeVoices.values()].filter(
      ({ category }) => category === asset.category,
    );

    let replacedVoice: Readonly<AudioVoiceRecord> | undefined;
    let rejectionReason: AudioVoiceRejectionReason | undefined;
    if (categoryVoices.length >= this.categoryVoiceLimits[asset.category]) {
      replacedVoice = replacementCandidate(categoryVoices, priority);
      rejectionReason = "category-limit";
    } else if (this.activeVoices.size >= this.totalVoiceLimit) {
      replacedVoice = replacementCandidate([...this.activeVoices.values()], priority);
      rejectionReason = "total-limit";
    }
    if (rejectionReason && !replacedVoice) {
      return Object.freeze({
        kind: "rejected",
        reason: rejectionReason,
        mutation: noMutation(this.revision),
      });
    }

    const voice = Object.freeze({
      voiceId,
      assetId: asset.id,
      category: asset.category,
      priority,
      sequence: this.nextVoiceSequence++,
    });
    const previousRevision = this.beginMutation();
    if (replacedVoice) this.activeVoices.delete(replacedVoice.voiceId);
    this.activeVoices.set(voiceId, voice);
    const mutation = changedMutation(previousRevision, this.revision);
    return replacedVoice
      ? Object.freeze({
        kind: "replaced",
        voice,
        replacedVoice,
        replacedVoiceId: replacedVoice.voiceId,
        mutation,
      })
      : Object.freeze({ kind: "accepted", voice, mutation });
  }

  releaseVoice(voiceId: string): Readonly<AudioMixerMutation> {
    voiceId = voiceIdentifier(voiceId);
    if (!this.activeVoices.has(voiceId)) return noMutation(this.revision);
    const previousRevision = this.beginMutation();
    this.activeVoices.delete(voiceId);
    return changedMutation(previousRevision, this.revision);
  }

  clearVoices(): Readonly<AudioMixerMutation> {
    if (this.activeVoices.size === 0) return noMutation(this.revision);
    const previousRevision = this.beginMutation();
    this.activeVoices.clear();
    return changedMutation(previousRevision, this.revision);
  }

  private beginMutation(): number {
    const previousRevision = this.revision;
    this.revision++;
    this.snapshotCache = undefined;
    return previousRevision;
  }
}

function categoryNumberRecord(
  value: (category: AudioCategory) => number,
): Record<AudioCategory, number> {
  return {
    music: value("music"),
    ambience: value("ambience"),
    sfx: value("sfx"),
    ui: value("ui"),
  };
}

function replacementCandidate(
  voices: readonly Readonly<AudioVoiceRecord>[],
  incomingPriority: number,
): Readonly<AudioVoiceRecord> | undefined {
  return voices
    .filter(({ priority }) => priority <= incomingPriority)
    .sort((left, right) => left.priority - right.priority || left.sequence - right.sequence)[0];
}

function clampedGain(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return Math.min(1, Math.max(0, value));
}

function initialGain(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1`);
  }
  return value;
}

function assertCategory(category: string): asserts category is AudioCategory {
  if (!(AUDIO_CATEGORIES as readonly string[]).includes(category)) {
    throw new RangeError(`Unknown audio category ${category}`);
  }
}

function voiceIdentifier(value: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 160) {
    throw new TypeError("voiceId must be a trimmed non-empty string of at most 160 characters");
  }
  return value;
}

function voicePriority(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000) {
    throw new RangeError("voice priority must be an integer between 0 and 1000");
  }
  return value;
}

function positiveIntegerAtMost(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function noMutation(revision: number): Readonly<AudioMixerMutation> {
  return Object.freeze({ kind: "none", previousRevision: revision, revision });
}

function changedMutation(previousRevision: number, revision: number): Readonly<AudioMixerMutation> {
  return Object.freeze({ kind: "changed", previousRevision, revision });
}
