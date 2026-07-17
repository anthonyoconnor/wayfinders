export const AUDIO_CUE_SOURCES = [
  "ui.confirm",
  "ui.cancel",
  "ui.toggle",
  "islandSighted",
  "surveySiteSighted",
  "fishingShoalSighted",
  "wreckDiscovered",
  "islandDossierSurveyed",
  "surveySiteSurveyed",
  "fishingShoalSurveyed",
  "wreckSurveyed",
  "idolLocationDiscovered",
  "expeditionReturned",
  "shipReplenishedDock",
  "shipWrecked",
  "provisionConsumed",
  "shipEnteredTile",
  "knowledgeChanged",
  "returnStateChanged",
  "shipTeleported",
  "worldRegenerated",
] as const;

export type AudioCueSource = typeof AUDIO_CUE_SOURCES[number];
export type AudioUiCueAction = "confirm" | "cancel" | "toggle";
export type AudioCueFamily =
  | "ui-confirm"
  | "ui-cancel"
  | "ui-toggle"
  | "discovery"
  | "survey"
  | "idol-discovery"
  | "dock-return"
  | "wreck";
export type AudioCueReplacement = "reject" | "replace-oldest";

export interface AudioCueIntention {
  readonly source: AudioCueSource;
  readonly family: AudioCueFamily;
  readonly assetId: string;
  readonly priority: number;
  readonly cooldownMs: number;
  readonly maxVoices: number;
  readonly replacement: AudioCueReplacement;
  readonly replacesFamilies: readonly AudioCueFamily[];
}

export interface ActiveAudioCueVoice {
  readonly voiceId: string;
  readonly family: AudioCueFamily;
  readonly priority: number;
  readonly startedAtMs: number;
}

export type AudioCueSuppressionReason =
  | "empty-batch"
  | "no-cue"
  | "developer-action"
  | "cooldown"
  | "voice-limit";

export type AudioCueDecision =
  | Readonly<{
    kind: "play";
    intention: Readonly<AudioCueIntention>;
    replaceVoiceId?: string;
  }>
  | Readonly<{
    kind: "suppressed";
    reason: AudioCueSuppressionReason;
    source?: AudioCueSource;
    family?: AudioCueFamily;
  }>;

const DEVELOPER_ACTIONS: ReadonlySet<AudioCueSource> = new Set([
  "shipTeleported",
  "worldRegenerated",
]);

const CUE_DEFINITIONS: Readonly<Partial<Record<AudioCueSource, Readonly<AudioCueIntention>>>> = {
  "ui.confirm": cue("ui.confirm", "ui-confirm", "ui.confirm", 300, 120, 1, "replace-oldest"),
  "ui.cancel": cue("ui.cancel", "ui-cancel", "ui.cancel", 310, 120, 1, "replace-oldest"),
  "ui.toggle": cue("ui.toggle", "ui-toggle", "ui.toggle", 200, 120, 1, "replace-oldest"),
  islandSighted: cue("islandSighted", "discovery", "sfx.discovery", 400, 650, 1, "replace-oldest"),
  surveySiteSighted: cue("surveySiteSighted", "discovery", "sfx.discovery", 400, 650, 1, "replace-oldest"),
  fishingShoalSighted: cue("fishingShoalSighted", "discovery", "sfx.discovery", 400, 650, 1, "replace-oldest"),
  wreckDiscovered: cue("wreckDiscovered", "discovery", "sfx.discovery", 410, 650, 1, "replace-oldest"),
  islandDossierSurveyed: cue("islandDossierSurveyed", "survey", "sfx.survey-complete", 600, 250, 2, "reject"),
  surveySiteSurveyed: cue("surveySiteSurveyed", "survey", "sfx.survey-complete", 600, 250, 2, "reject"),
  fishingShoalSurveyed: cue("fishingShoalSurveyed", "survey", "sfx.survey-complete", 600, 250, 2, "reject"),
  wreckSurveyed: cue("wreckSurveyed", "survey", "sfx.survey-complete", 610, 250, 2, "reject"),
  idolLocationDiscovered: cue(
    "idolLocationDiscovered",
    "idol-discovery",
    "sfx.discovery",
    900,
    500,
    1,
    "replace-oldest",
    ["survey", "discovery"],
  ),
  expeditionReturned: cue("expeditionReturned", "dock-return", "sfx.dock-return", 800, 500, 1, "replace-oldest"),
  shipReplenishedDock: cue("shipReplenishedDock", "dock-return", "sfx.dock-return", 790, 500, 1, "replace-oldest"),
  shipWrecked: cue("shipWrecked", "wreck", "sfx.wreck", 1_000, 1_000, 1, "replace-oldest"),
};

/** Stateful only for deterministic family cooldowns; it owns no playback. */
export class AudioCuePolicy {
  private readonly lastPlayedAt = new Map<AudioCueFamily, number>();

  decideBatch(
    sources: readonly AudioCueSource[],
    nowMs: number,
    activeVoices: readonly Readonly<ActiveAudioCueVoice>[] = [],
  ): AudioCueDecision {
    if (sources.length === 0) return Object.freeze({ kind: "suppressed", reason: "empty-batch" });
    if (sources.some((source) => DEVELOPER_ACTIONS.has(source))) {
      return Object.freeze({ kind: "suppressed", reason: "developer-action" });
    }

    let selected: Readonly<AudioCueIntention> | undefined;
    for (const source of sources) {
      const candidate = CUE_DEFINITIONS[source];
      if (candidate && (!selected || candidate.priority > selected.priority)) selected = candidate;
    }
    if (!selected) return Object.freeze({ kind: "suppressed", reason: "no-cue" });

    const safeNowMs = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    const lastPlayedAt = this.lastPlayedAt.get(selected.family);
    if (lastPlayedAt !== undefined && safeNowMs - lastPlayedAt < selected.cooldownMs) {
      return Object.freeze({
        kind: "suppressed",
        reason: "cooldown",
        source: selected.source,
        family: selected.family,
      });
    }

    const crossFamilyReplacement = oldestReplaceableVoice(
      activeVoices,
      selected.replacesFamilies,
      selected.priority,
    );
    const ownVoices = activeVoices.filter(({ family }) => family === selected.family);
    let replaceVoiceId = crossFamilyReplacement?.voiceId;
    if (!replaceVoiceId && ownVoices.length >= selected.maxVoices) {
      if (selected.replacement === "reject") {
        return Object.freeze({
          kind: "suppressed",
          reason: "voice-limit",
          source: selected.source,
          family: selected.family,
        });
      }
      replaceVoiceId = oldestReplaceableVoice(
        ownVoices,
        [selected.family],
        selected.priority,
      )?.voiceId;
      if (!replaceVoiceId) {
        return Object.freeze({
          kind: "suppressed",
          reason: "voice-limit",
          source: selected.source,
          family: selected.family,
        });
      }
    }

    this.lastPlayedAt.set(selected.family, safeNowMs);
    return Object.freeze({
      kind: "play",
      intention: selected,
      ...(replaceVoiceId ? { replaceVoiceId } : {}),
    });
  }
}

function cue(
  source: AudioCueSource,
  family: AudioCueFamily,
  assetId: string,
  priority: number,
  cooldownMs: number,
  maxVoices: number,
  replacement: AudioCueReplacement,
  replacesFamilies: readonly AudioCueFamily[] = [],
): Readonly<AudioCueIntention> {
  return Object.freeze({
    source,
    family,
    assetId,
    priority,
    cooldownMs,
    maxVoices,
    replacement,
    replacesFamilies: Object.freeze([...replacesFamilies]),
  });
}

function oldestReplaceableVoice(
  voices: readonly Readonly<ActiveAudioCueVoice>[],
  families: readonly AudioCueFamily[],
  incomingPriority: number,
): Readonly<ActiveAudioCueVoice> | undefined {
  let oldest: Readonly<ActiveAudioCueVoice> | undefined;
  for (const voice of voices) {
    if (!families.includes(voice.family) || voice.priority > incomingPriority) continue;
    if (
      !oldest
      || voice.startedAtMs < oldest.startedAtMs
      || (voice.startedAtMs === oldest.startedAtMs && voice.voiceId < oldest.voiceId)
    ) {
      oldest = voice;
    }
  }
  return oldest;
}
