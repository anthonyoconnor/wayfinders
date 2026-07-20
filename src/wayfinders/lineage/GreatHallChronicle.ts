import type { ShipwreckState } from "../core/types";
import {
  createIdolLocationHostKey,
  isCurrentIdolLocationId,
  parseIdolLocationId,
  type IdolLocationDefinition,
  type IdolLocationHostRef,
  type IdolLocationId,
} from "../exploration/IdolLocationContracts";
import type { IslandDossierDefinitionV1 } from "../exploration/IslandDossierContracts";
import type {
  FishingShoalDefinition,
  FishingShoalId,
  FishingShoalQuality,
} from "../exploration/FishingShoalContracts";
import type {
  SurveySiteDefinition,
  SurveySiteId,
} from "../exploration/SurveySiteContracts";
import {
  NAVIGATOR_VOYAGE_LIMIT,
  parseNavigatorSuccessionKey,
  type NavigatorId,
  type NavigatorLifecycleState,
  type NavigatorRecordV6,
  type NavigatorVoyageAchievementOrderEntryV1,
  type NavigatorVoyageAchievementInputV3,
  type NavigatorVoyageAchievementRecordV3,
} from "./NavigatorLineageSystem";

export const GREAT_HALL_CHRONICLE_READ_MODEL_VERSION = 4 as const;

const greatHallVoyageKeyBrand: unique symbol = Symbol("GreatHallVoyageKey");
const greatHallAchievementKeyBrand: unique symbol = Symbol("GreatHallAchievementKey");

export type GreatHallVoyageKey = string & { readonly [greatHallVoyageKeyBrand]: true };
export type GreatHallAchievementKey = string & { readonly [greatHallAchievementKeyBrand]: true };

export type GreatHallReturnedIdolLocationSource = Readonly<Pick<
  IdolLocationDefinition,
  "id" | "ordinal" | "displayLabel" | "host"
>>;

export interface GreatHallIdolSources {
  /** Safe count-only world goal; it exposes no undiscovered host. */
  readonly total: number;
  /** Only locations whose host survey has already returned to the exact home dock. */
  readonly returned: readonly GreatHallReturnedIdolLocationSource[];
}

export interface GreatHallChronicleSources {
  /** Deterministic names and results for stable island IDs credited by lineage voyages. */
  readonly islandDossiers: readonly Readonly<Pick<
    IslandDossierDefinitionV1,
    "islandId" | "name" | "dossier"
  >>[];
  /** Deterministic labels and results for stable survey-site IDs credited by lineage voyages. */
  readonly surveySites: readonly Readonly<Pick<
    SurveySiteDefinition<string>,
    "id" | "type" | "typeLabel" | "clue" | "result"
  >>[];
  /** Deterministic labels for stable fishing IDs already committed to lineage voyages. */
  readonly fishingShoals: readonly Readonly<Pick<FishingShoalDefinition, "id" | "quality">>[];
  /** Runtime wreck authority, including whether an identity report has returned home. */
  readonly wrecks: readonly Readonly<Pick<ShipwreckState, "id" | "generation" | "survey">>[];
  /** Safe idol input: total count plus returned locations only, never the hidden catalog. */
  readonly idols: Readonly<GreatHallIdolSources>;
}

export interface GreatHallVoyagePreviewSources extends Omit<GreatHallChronicleSources, "idols"> {
  /** Safe count-only world goal used to validate provisional idol ordinals. */
  readonly idolTotal: number;
  /** Only idol locations whose host finding belongs to this provisional voyage. */
  readonly idolLocations: readonly GreatHallReturnedIdolLocationSource[];
}

interface GreatHallAchievementBase {
  readonly key: GreatHallAchievementKey;
  readonly label: string;
}

export interface GreatHallIslandLeadAchievement extends GreatHallAchievementBase {
  readonly kind: "island-lead";
  readonly islandId: number;
  readonly name: string;
}

export interface GreatHallIslandDossierAchievement extends GreatHallAchievementBase {
  readonly kind: "island-dossier";
  readonly islandId: number;
  readonly name: string;
  readonly findingLabel: string;
}

export interface GreatHallSurveySiteLeadAchievement extends GreatHallAchievementBase {
  readonly kind: "survey-site-lead";
  readonly surveySiteId: SurveySiteId;
  readonly siteType: string;
  readonly typeLabel: string;
  readonly clueLabel: string;
}

export interface GreatHallSurveySiteReportAchievement extends GreatHallAchievementBase {
  readonly kind: "survey-site-report";
  readonly surveySiteId: SurveySiteId;
  readonly siteType: string;
  readonly typeLabel: string;
  readonly resultLabel: string;
}

export interface GreatHallFishingLeadAchievement extends GreatHallAchievementBase {
  readonly kind: "fishing-leads";
  readonly fishingShoalIds: readonly FishingShoalId[];
  readonly leadCount: number;
}

export interface GreatHallFishingSurveyAchievement extends GreatHallAchievementBase {
  readonly kind: "fishing-survey";
  readonly fishingShoalId: FishingShoalId;
  readonly quality: FishingShoalQuality;
}

export interface GreatHallWreckReportAchievement extends GreatHallAchievementBase {
  readonly kind: "wreck-report";
  readonly wreckId: number;
  readonly lostNavigatorId: NavigatorId;
  readonly lostGeneration: number;
}

export interface GreatHallIdolLocationAchievement extends GreatHallAchievementBase {
  readonly kind: "idol-location";
  readonly idolLocationId: IdolLocationId;
  readonly ordinal: number;
  readonly displayLabel: string;
  readonly host: Readonly<IdolLocationHostRef>;
  /** Safe returned location copy used only for presentation. */
  readonly locationLabel: string;
}

export type GreatHallAchievement =
  | GreatHallIslandLeadAchievement
  | GreatHallIslandDossierAchievement
  | GreatHallSurveySiteLeadAchievement
  | GreatHallSurveySiteReportAchievement
  | GreatHallFishingLeadAchievement
  | GreatHallFishingSurveyAchievement
  | GreatHallWreckReportAchievement
  | GreatHallIdolLocationAchievement;

interface GreatHallVoyageBase {
  readonly key: GreatHallVoyageKey;
  readonly voyageNumber: number;
}

export interface GreatHallReturnedVoyage extends GreatHallVoyageBase {
  readonly outcome: "returned";
  readonly expeditionId: number;
  /** Structured, exact-dock-committed achievements; an uneventful return is empty. */
  readonly achievements: readonly Readonly<GreatHallAchievement>[];
}

export interface GreatHallLostVoyage extends GreatHallVoyageBase {
  readonly outcome: "lost-at-sea";
  /** A fatal expedition is never represented by provisional achievement credit. */
  readonly achievements: readonly [];
}

export type GreatHallVoyage = GreatHallReturnedVoyage | GreatHallLostVoyage;

export interface GreatHallVoyageTotals {
  readonly returnedVoyages: number;
  readonly lostVoyages: number;
  readonly islandLeads: number;
  readonly islandDossiers: number;
  readonly surveySiteLeads: number;
  readonly surveySiteReports: number;
  readonly fishingLeads: number;
  readonly fishingSurveys: number;
  readonly wreckReports: number;
  readonly idolLocations: number;
}

export interface GreatHallUnlocatedWreckFate {
  readonly state: "unlocated";
}

export interface GreatHallConfirmedWreckFate {
  readonly state: "confirmed";
  readonly wreckId: number;
  readonly returnedByNavigatorId: NavigatorId;
  readonly returnedByGeneration: number;
  readonly returnedOnVoyage: number;
  readonly returnedVoyageKey: GreatHallVoyageKey;
  readonly achievementKey: GreatHallAchievementKey;
}

export type GreatHallWreckFate = GreatHallUnlocatedWreckFate | GreatHallConfirmedWreckFate;

export interface GreatHallNavigatorEntry {
  /** The authoritative navigator ID is also the stable entry identity. */
  readonly key: NavigatorId;
  readonly navigatorId: NavigatorId;
  readonly generation: number;
  readonly state: NavigatorLifecycleState;
  readonly completedVoyages: number;
  readonly voyageLimit: typeof NAVIGATOR_VOYAGE_LIMIT;
  readonly voyages: readonly Readonly<GreatHallVoyage>[];
  readonly totals: Readonly<GreatHallVoyageTotals>;
  /** Present only for a navigator lost at sea; no hidden wreck data leaks before confirmation. */
  readonly wreckFate: Readonly<GreatHallWreckFate> | null;
}

export interface GreatHallLineageTotals extends GreatHallVoyageTotals {
  readonly navigators: number;
  readonly activeNavigators: number;
  readonly completedNavigators: number;
  readonly lostNavigators: number;
  readonly confirmedWreckFates: number;
  readonly unlocatedWreckFates: number;
}

export interface GreatHallIdolProgress {
  readonly found: number;
  readonly total: number;
  readonly complete: boolean;
}

type MutableGreatHallVoyageTotals = {
  -readonly [Key in keyof GreatHallVoyageTotals]: GreatHallVoyageTotals[Key];
};

/**
 * Ephemeral GP-2.3 read model. Every value is derived from the authoritative
 * lineage and returned-world records; this object is never gameplay authority.
 */
export interface GreatHallChronicle {
  readonly readModelVersion: typeof GREAT_HALL_CHRONICLE_READ_MODEL_VERSION;
  readonly navigators: readonly Readonly<GreatHallNavigatorEntry>[];
  /** Counts only player-known, committed history; it contains no world-content totals. */
  readonly totals: Readonly<GreatHallLineageTotals>;
  /** Count-only goal progress; undiscovered idol identities and hosts are structurally absent. */
  readonly idolProgress: Readonly<GreatHallIdolProgress>;
}

interface WreckReportCredit {
  readonly navigatorId: NavigatorId;
  readonly generation: number;
  readonly voyageNumber: number;
  readonly voyageKey: GreatHallVoyageKey;
  readonly achievementKey: GreatHallAchievementKey;
}

interface SourceIndexes {
  readonly islandDossierById: ReadonlyMap<number, Readonly<Pick<
    IslandDossierDefinitionV1,
    "islandId" | "name" | "dossier"
  >>>;
  readonly surveySiteById: ReadonlyMap<SurveySiteId, Readonly<Pick<
    SurveySiteDefinition<string>,
    "id" | "type" | "typeLabel" | "clue" | "result"
  >>>;
  readonly fishingQualityById: ReadonlyMap<FishingShoalId, FishingShoalQuality>;
  readonly wreckById: ReadonlyMap<number, Readonly<Pick<ShipwreckState, "id" | "generation" | "survey">>>;
  readonly navigatorByGeneration: ReadonlyMap<number, Readonly<NavigatorRecordV6>>;
  readonly returnedIdolByHostKey: ReadonlyMap<string, GreatHallReturnedIdolLocationSource>;
}

/** Builds the complete home/succession chronicle without creating duplicate authority. */
export function buildGreatHallChronicle(
  navigators: readonly Readonly<NavigatorRecordV6>[],
  sources: Readonly<GreatHallChronicleSources>,
): Readonly<GreatHallChronicle> {
  if (navigators.length === 0) throw new RangeError("A Great Hall chronicle requires a navigator lineage");

  const indexes = createSourceIndexes(navigators, sources);
  const usedVoyageKeys = new Set<string>();
  const usedAchievementKeys = new Set<string>();
  const wreckReportCredits = new Map<number, Readonly<WreckReportCredit>>();
  const creditedIdolLocationIds = new Set<IdolLocationId>();

  const entriesWithoutFates = navigators.map((navigator): Readonly<GreatHallNavigatorEntry> => {
    validateNavigatorVoyages(navigator);
    const voyages: Readonly<GreatHallVoyage>[] = navigator.successfulVoyages.map((voyage) => {
      const key = createGreatHallVoyageKey(navigator.id, voyage.voyageNumber);
      registerUniqueKey(usedVoyageKeys, key, "voyage");
      const achievements = buildReturnedAchievements(
        navigator,
        voyage,
        key,
        indexes,
        usedAchievementKeys,
        wreckReportCredits,
        creditedIdolLocationIds,
      );
      return Object.freeze({
        key,
        voyageNumber: voyage.voyageNumber,
        outcome: "returned",
        expeditionId: voyage.expeditionId,
        achievements,
      });
    });

    if (navigator.state === "lost") {
      const voyageNumber = navigator.completedVoyages + 1;
      const key = createGreatHallVoyageKey(navigator.id, voyageNumber);
      registerUniqueKey(usedVoyageKeys, key, "voyage");
      voyages.push(Object.freeze({
        key,
        voyageNumber,
        outcome: "lost-at-sea",
        achievements: EMPTY_ACHIEVEMENTS,
      }));
    }

    const frozenVoyages = Object.freeze(voyages);
    return Object.freeze({
      key: navigator.id,
      navigatorId: navigator.id,
      generation: navigator.generation,
      state: navigator.state,
      completedVoyages: navigator.completedVoyages,
      voyageLimit: NAVIGATOR_VOYAGE_LIMIT,
      voyages: frozenVoyages,
      totals: totalVoyages(frozenVoyages),
      wreckFate: null,
    });
  });

  const entries = Object.freeze(entriesWithoutFates.map((entry, index) => {
    const navigator = navigators[index];
    if (navigator.state !== "lost") return entry;
    return Object.freeze({
      ...entry,
      wreckFate: resolveLostNavigatorFate(navigator, indexes, wreckReportCredits),
    });
  }));

  validateReturnedIdolCredits(sources.idols.returned, creditedIdolLocationIds);
  const totals = totalLineage(entries);
  if (totals.idolLocations !== creditedIdolLocationIds.size) {
    throw new RangeError("Great Hall idol-location totals do not reconcile with returned credit");
  }
  const idolProgress = Object.freeze({
    found: creditedIdolLocationIds.size,
    total: sources.idols.total,
    complete: creditedIdolLocationIds.size === sources.idols.total,
  });

  return Object.freeze({
    readModelVersion: GREAT_HALL_CHRONICLE_READ_MODEL_VERSION,
    navigators: entries,
    totals,
    idolProgress,
  });
}

export function createGreatHallVoyageKey(
  navigatorId: NavigatorId,
  voyageNumber: number,
): GreatHallVoyageKey {
  if (!Number.isSafeInteger(voyageNumber) || voyageNumber < 1 || voyageNumber > NAVIGATOR_VOYAGE_LIMIT) {
    throw new RangeError(`Great Hall voyage number must be from 1 through ${NAVIGATOR_VOYAGE_LIMIT}`);
  }
  return `great-hall:v${GREAT_HALL_CHRONICLE_READ_MODEL_VERSION}:${navigatorId}:voyage:${voyageNumber}` as GreatHallVoyageKey;
}

/**
 * Projects current expedition credits through the same semantic achievement
 * builder used by returned Great Hall voyages. It owns no gameplay state.
 */
export function buildGreatHallVoyageAchievementPreview(
  navigators: readonly Readonly<NavigatorRecordV6>[],
  navigator: Readonly<NavigatorRecordV6>,
  voyageNumber: number,
  voyage: Readonly<NavigatorVoyageAchievementInputV3>,
  sources: Readonly<GreatHallVoyagePreviewSources>,
): readonly Readonly<GreatHallAchievement>[] {
  const voyageKey = createGreatHallVoyageKey(navigator.id, voyageNumber);
  const indexes = createSourceIndexes(navigators, {
    islandDossiers: sources.islandDossiers,
    surveySites: sources.surveySites,
    fishingShoals: sources.fishingShoals,
    wrecks: sources.wrecks,
    idols: {
      total: sources.idolTotal,
      returned: sources.idolLocations,
    },
  });
  return buildReturnedAchievements(
    navigator,
    { ...voyage, voyageNumber },
    voyageKey,
    indexes,
    new Set<string>(),
    new Map<number, Readonly<WreckReportCredit>>(),
    new Set<IdolLocationId>(),
    "provisional",
  );
}

function buildReturnedAchievements(
  navigator: Readonly<NavigatorRecordV6>,
  voyage: Readonly<NavigatorVoyageAchievementRecordV3>,
  voyageKey: GreatHallVoyageKey,
  indexes: Readonly<SourceIndexes>,
  usedAchievementKeys: Set<string>,
  wreckReportCredits: Map<number, Readonly<WreckReportCredit>>,
  creditedIdolLocationIds: Set<IdolLocationId>,
  creditState: "provisional" | "returned" = "returned",
): readonly Readonly<GreatHallAchievement>[] {
  const achievements: Readonly<GreatHallAchievement>[] = [];
  const add = <T extends GreatHallAchievement>(achievement: T): void => {
    registerUniqueKey(usedAchievementKeys, achievement.key, "achievement");
    achievements.push(Object.freeze(achievement));
  };
  const addReturnedIdol = (
    host: Readonly<IdolLocationHostRef>,
    locationLabel: string,
  ): void => {
    const idol = indexes.returnedIdolByHostKey.get(createIdolLocationHostKey(host));
    if (!idol) return;
    if (creditedIdolLocationIds.has(idol.id)) {
      throw new RangeError(`Returned idol location ${idol.id} is credited more than once in the lineage`);
    }
    add({
      key: createAchievementKey(voyageKey, "idol-location", idol.id),
      kind: "idol-location",
      idolLocationId: idol.id,
      ordinal: idol.ordinal,
      displayLabel: idol.displayLabel,
      host: freezeIdolLocationHost(idol.host),
      locationLabel,
      label: `${idol.displayLabel} located — ${locationLabel}`,
    });
    creditedIdolLocationIds.add(idol.id);
  };

  for (const islandId of voyage.islandLeadIds) {
    const definition = indexes.islandDossierById.get(islandId);
    if (!definition) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown island dossier ${islandId}`);
    }
    add({
      key: createAchievementKey(voyageKey, "island-lead", islandId),
      kind: "island-lead",
      islandId,
      name: definition.name,
      label: `Recorded a lead for ${definition.name}`,
    });
  }

  for (const islandId of voyage.islandDossierIds) {
    const definition = indexes.islandDossierById.get(islandId);
    if (!definition) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown island dossier ${islandId}`);
    }
    add({
      key: createAchievementKey(voyageKey, "island-dossier", islandId),
      kind: "island-dossier",
      islandId,
      name: definition.name,
      findingLabel: definition.dossier.findingLabel,
      label: `Surveyed ${definition.name} — ${definition.dossier.findingLabel}`,
    });
    addReturnedIdol({ kind: "island-dossier", islandId }, definition.name);
  }

  for (const surveySiteId of voyage.surveySiteLeadIds) {
    const definition = indexes.surveySiteById.get(surveySiteId);
    if (!definition) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown survey site ${surveySiteId}`);
    }
    add({
      key: createAchievementKey(voyageKey, "survey-site-lead", surveySiteId),
      kind: "survey-site-lead",
      surveySiteId,
      siteType: definition.type,
      typeLabel: definition.typeLabel,
      clueLabel: definition.clue.label,
      label: `Recorded a ${definition.typeLabel.toLowerCase()} lead — ${definition.clue.label}`,
    });
  }

  for (const surveySiteId of voyage.surveySiteReportIds) {
    const definition = indexes.surveySiteById.get(surveySiteId);
    if (!definition) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown survey site ${surveySiteId}`);
    }
    add({
      key: createAchievementKey(voyageKey, "survey-site-report", surveySiteId),
      kind: "survey-site-report",
      surveySiteId,
      siteType: definition.type,
      typeLabel: definition.typeLabel,
      resultLabel: definition.result.label,
      label: `Surveyed ${definition.typeLabel.toLowerCase()} — ${definition.result.label}`,
    });
    addReturnedIdol(
      { kind: "survey-site", surveySiteId },
      `${definition.typeLabel} — ${definition.result.label}`,
    );
  }

  for (const fishingShoalId of voyage.fishingLeadIds) {
    if (!indexes.fishingQualityById.has(fishingShoalId)) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown fishing shoal ${fishingShoalId}`);
    }
  }
  if (voyage.fishingLeadIds.length > 0) {
    const leadCount = voyage.fishingLeadIds.length;
    add({
      key: createAchievementKey(voyageKey, "fishing-leads"),
      kind: "fishing-leads",
      fishingShoalIds: Object.freeze([...voyage.fishingLeadIds]),
      leadCount,
      label: `Recorded ${leadCount} fishing lead${leadCount === 1 ? "" : "s"}`,
    });
  }

  for (const fishingShoalId of voyage.fishingSurveyIds) {
    const quality = indexes.fishingQualityById.get(fishingShoalId);
    if (quality === undefined) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown fishing shoal ${fishingShoalId}`);
    }
    add({
      key: createAchievementKey(voyageKey, "fishing-survey", fishingShoalId),
      kind: "fishing-survey",
      fishingShoalId,
      quality,
      label: `Surveyed a ${quality} fishing ground`,
    });
  }

  for (const wreckId of voyage.wreckIds) {
    const wreck = indexes.wreckById.get(wreckId);
    if (!wreck) throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown wreck ${wreckId}`);
    if (
      wreck.survey.state !== creditState
      || wreck.survey.expeditionId !== voyage.expeditionId
      || wreck.survey.generation !== navigator.generation
    ) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references wreck report ${wreckId} that was not ${creditState} by it`);
    }
    const lostNavigator = indexes.navigatorByGeneration.get(wreck.generation);
    if (lostNavigator?.state !== "lost" || terminalWreckId(lostNavigator) !== wreckId) {
      throw new RangeError(`Wreck ${wreckId} does not identify a lost navigator in this lineage`);
    }
    const achievementKey = createAchievementKey(voyageKey, "wreck-report", wreckId);
    add({
      key: achievementKey,
      kind: "wreck-report",
      wreckId,
      lostNavigatorId: lostNavigator.id,
      lostGeneration: lostNavigator.generation,
      label: `Identified the Generation ${lostNavigator.generation} navigator's wreck`,
    });
    if (wreckReportCredits.has(wreckId)) {
      throw new RangeError(`Wreck report ${wreckId} is credited more than once in the lineage`);
    }
    wreckReportCredits.set(wreckId, Object.freeze({
      navigatorId: navigator.id,
      generation: navigator.generation,
      voyageNumber: voyage.voyageNumber,
      voyageKey,
      achievementKey,
    }));
  }

  if (voyage.achievementOrder.length === 0) return Object.freeze(achievements);
  const order = new Map(voyage.achievementOrder.map((entry, index) => [achievementOrderEntryKey(entry), index]));
  return Object.freeze(achievements
    .map((achievement, originalIndex) => ({ achievement, originalIndex }))
    .sort((left, right) => (
      (order.get(greatHallAchievementOrderKey(left.achievement)) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(greatHallAchievementOrderKey(right.achievement)) ?? Number.MAX_SAFE_INTEGER)
      || left.originalIndex - right.originalIndex
    ))
    .map(({ achievement }) => achievement));
}

function achievementOrderEntryKey(entry: NavigatorVoyageAchievementOrderEntryV1): string {
  return `${entry.kind}:${"sourceId" in entry ? entry.sourceId : ""}`;
}

function greatHallAchievementOrderKey(achievement: GreatHallAchievement): string {
  switch (achievement.kind) {
    case "island-lead": return `${achievement.kind}:${achievement.islandId}`;
    case "island-dossier": return `${achievement.kind}:${achievement.islandId}`;
    case "survey-site-lead": return `${achievement.kind}:${achievement.surveySiteId}`;
    case "survey-site-report": return `${achievement.kind}:${achievement.surveySiteId}`;
    case "fishing-leads": return `${achievement.kind}:`;
    case "fishing-survey": return `${achievement.kind}:${achievement.fishingShoalId}`;
    case "wreck-report": return `${achievement.kind}:${achievement.wreckId}`;
    case "idol-location": return `${achievement.kind}:${achievement.idolLocationId}`;
  }
}

function resolveLostNavigatorFate(
  navigator: Readonly<NavigatorRecordV6> & { readonly state: "lost" },
  indexes: Readonly<SourceIndexes>,
  wreckReportCredits: ReadonlyMap<number, Readonly<WreckReportCredit>>,
): Readonly<GreatHallWreckFate> {
  const wreckId = terminalWreckId(navigator);
  const wreck = indexes.wreckById.get(wreckId);
  if (!wreck || wreck.generation !== navigator.generation) {
    throw new RangeError(`Lost navigator ${navigator.id} has no matching runtime wreck ${wreckId}`);
  }
  const credit = wreckReportCredits.get(wreckId);
  if (wreck.survey.state !== "returned" || !credit) {
    return UNLOCATED_WRECK_FATE;
  }
  return Object.freeze({
    state: "confirmed",
    wreckId,
    returnedByNavigatorId: credit.navigatorId,
    returnedByGeneration: credit.generation,
    returnedOnVoyage: credit.voyageNumber,
    returnedVoyageKey: credit.voyageKey,
    achievementKey: credit.achievementKey,
  });
}

function createSourceIndexes(
  navigators: readonly Readonly<NavigatorRecordV6>[],
  sources: Readonly<GreatHallChronicleSources>,
): SourceIndexes {
  if (!Number.isSafeInteger(sources.idols.total) || sources.idols.total < 1) {
    throw new RangeError("Great Hall idol total must be a positive safe integer");
  }
  if (sources.idols.returned.length > sources.idols.total) {
    throw new RangeError("Great Hall returned idol locations cannot exceed the world total");
  }
  const islandDossierById = uniqueMap(
    sources.islandDossiers,
    ({ islandId }) => islandId,
    (definition) => definition,
    "island dossier",
  );
  const surveySiteById = uniqueMap(
    sources.surveySites,
    ({ id }) => id,
    (definition) => definition,
    "survey site",
  );
  const returnedIdolById = uniqueMap(
    sources.idols.returned,
    ({ id }) => id,
    (idol) => idol,
    "returned idol location",
  );
  const returnedIdolByHostKey = uniqueMap(
    sources.idols.returned,
    ({ host }) => createIdolLocationHostKey(host),
    (idol) => idol,
    "returned idol host",
  );
  for (const idol of returnedIdolById.values()) {
    validateReturnedIdolSource(idol, islandDossierById, surveySiteById);
    if (idol.ordinal > sources.idols.total) {
      throw new RangeError(
        `Great Hall returned idol location ${idol.id} exceeds world total ${sources.idols.total}`,
      );
    }
  }
  return {
    islandDossierById,
    surveySiteById,
    fishingQualityById: uniqueMap(
      sources.fishingShoals,
      ({ id }) => id,
      ({ quality }) => quality,
      "fishing shoal",
    ),
    wreckById: uniqueMap(sources.wrecks, ({ id }) => id, (wreck) => wreck, "wreck"),
    navigatorByGeneration: uniqueMap(
      navigators,
      ({ generation }) => generation,
      (navigator) => navigator,
      "navigator generation",
    ),
    returnedIdolByHostKey,
  };
}

function validateReturnedIdolSource(
  idol: GreatHallReturnedIdolLocationSource,
  islandDossierById: ReadonlyMap<number, unknown>,
  surveySiteById: ReadonlyMap<SurveySiteId, unknown>,
): void {
  if (!isCurrentIdolLocationId(idol.id)) {
    throw new RangeError(`Great Hall returned idol location has invalid ID ${String(idol.id)}`);
  }
  if (!Number.isSafeInteger(idol.ordinal) || idol.ordinal < 1) {
    throw new RangeError(`Great Hall returned idol location ${idol.id} has an invalid ordinal`);
  }
  if (parseIdolLocationId(idol.id)?.ordinal !== idol.ordinal) {
    throw new RangeError(`Great Hall returned idol location ${idol.id} does not match ordinal ${idol.ordinal}`);
  }
  if (idol.displayLabel.trim().length === 0) {
    throw new RangeError(`Great Hall returned idol location ${idol.id} has an empty display label`);
  }
  if (idol.host.kind === "island-dossier") {
    if (!islandDossierById.has(idol.host.islandId)) {
      throw new RangeError(
        `Great Hall returned idol location ${idol.id} references unknown island dossier ${idol.host.islandId}`,
      );
    }
    return;
  }
  if (!surveySiteById.has(idol.host.surveySiteId)) {
    throw new RangeError(
      `Great Hall returned idol location ${idol.id} references unknown survey site ${idol.host.surveySiteId}`,
    );
  }
}

function validateReturnedIdolCredits(
  returned: readonly GreatHallReturnedIdolLocationSource[],
  creditedIds: ReadonlySet<IdolLocationId>,
): void {
  if (creditedIds.size !== returned.length) {
    const uncredited = returned.find(({ id }) => !creditedIds.has(id));
    throw new RangeError(
      uncredited
        ? `Returned idol location ${uncredited.id} is not credited by an exact-dock voyage`
        : "Great Hall returned idol credit count does not match its safe sources",
    );
  }
}

function freezeIdolLocationHost(
  host: Readonly<IdolLocationHostRef>,
): Readonly<IdolLocationHostRef> {
  return Object.freeze(host.kind === "island-dossier"
    ? { kind: host.kind, islandId: host.islandId }
    : { kind: host.kind, surveySiteId: host.surveySiteId });
}

function uniqueMap<T, K, V>(
  values: readonly T[],
  keyFor: (value: T) => K,
  valueFor: (value: T) => V,
  label: string,
): ReadonlyMap<K, V> {
  const map = new Map<K, V>();
  for (const value of values) {
    const key = keyFor(value);
    if (map.has(key)) throw new RangeError(`Duplicate ${label} source ${String(key)}`);
    map.set(key, valueFor(value));
  }
  return map;
}

function validateNavigatorVoyages(navigator: Readonly<NavigatorRecordV6>): void {
  if (navigator.successfulVoyages.length !== navigator.completedVoyages) {
    throw new RangeError(`Navigator ${navigator.id} voyage records do not match its completed count`);
  }
  if (navigator.state === "completed" && navigator.completedVoyages !== NAVIGATOR_VOYAGE_LIMIT) {
    throw new RangeError(`Completed navigator ${navigator.id} must have ${NAVIGATOR_VOYAGE_LIMIT} returned voyages`);
  }
  if (navigator.state !== "completed" && navigator.completedVoyages >= NAVIGATOR_VOYAGE_LIMIT) {
    throw new RangeError(`Navigator ${navigator.id} cannot remain ${navigator.state} after four returned voyages`);
  }
  for (let index = 0; index < navigator.successfulVoyages.length; index++) {
    if (navigator.successfulVoyages[index].voyageNumber !== index + 1) {
      throw new RangeError(`Navigator ${navigator.id} has a non-canonical voyage order`);
    }
  }
}

function terminalWreckId(navigator: Readonly<NavigatorRecordV6> & { readonly state: "lost" }): number {
  const parsed = parseNavigatorSuccessionKey(navigator.endedBySuccessionKey);
  if (parsed?.reason !== "wreck") {
    throw new RangeError(`Lost navigator ${navigator.id} has no valid wreck succession key`);
  }
  return parsed.resolutionId;
}

function createAchievementKey(
  voyageKey: GreatHallVoyageKey,
  kind: GreatHallAchievement["kind"],
  sourceId?: number | string,
): GreatHallAchievementKey {
  return `${voyageKey}:achievement:${kind}${sourceId === undefined ? "" : `:${sourceId}`}` as GreatHallAchievementKey;
}

function registerUniqueKey(keys: Set<string>, key: string, label: string): void {
  if (keys.has(key)) throw new RangeError(`Duplicate Great Hall ${label} key ${key}`);
  keys.add(key);
}

function totalVoyages(voyages: readonly Readonly<GreatHallVoyage>[]): Readonly<GreatHallVoyageTotals> {
  const totals = mutableVoyageTotals();
  for (const voyage of voyages) {
    if (voyage.outcome === "lost-at-sea") {
      totals.lostVoyages++;
      continue;
    }
    totals.returnedVoyages++;
    for (const achievement of voyage.achievements) {
      switch (achievement.kind) {
        case "island-lead":
          totals.islandLeads++;
          break;
        case "island-dossier":
          totals.islandDossiers++;
          break;
        case "survey-site-lead":
          totals.surveySiteLeads++;
          break;
        case "survey-site-report":
          totals.surveySiteReports++;
          break;
        case "fishing-leads":
          totals.fishingLeads += achievement.leadCount;
          break;
        case "fishing-survey":
          totals.fishingSurveys++;
          break;
        case "wreck-report":
          totals.wreckReports++;
          break;
        case "idol-location":
          totals.idolLocations++;
          break;
      }
    }
  }
  return Object.freeze(totals);
}

function totalLineage(
  entries: readonly Readonly<GreatHallNavigatorEntry>[],
): Readonly<GreatHallLineageTotals> {
  const voyageTotals = mutableVoyageTotals();
  let activeNavigators = 0;
  let completedNavigators = 0;
  let lostNavigators = 0;
  let confirmedWreckFates = 0;
  let unlocatedWreckFates = 0;
  for (const entry of entries) {
    addVoyageTotals(voyageTotals, entry.totals);
    if (entry.state === "active") activeNavigators++;
    if (entry.state === "completed") completedNavigators++;
    if (entry.state === "lost") {
      lostNavigators++;
      if (entry.wreckFate?.state === "confirmed") confirmedWreckFates++;
      else unlocatedWreckFates++;
    }
  }
  return Object.freeze({
    ...voyageTotals,
    navigators: entries.length,
    activeNavigators,
    completedNavigators,
    lostNavigators,
    confirmedWreckFates,
    unlocatedWreckFates,
  });
}

function mutableVoyageTotals(): MutableGreatHallVoyageTotals {
  return {
    returnedVoyages: 0,
    lostVoyages: 0,
    islandLeads: 0,
    islandDossiers: 0,
    surveySiteLeads: 0,
    surveySiteReports: 0,
    fishingLeads: 0,
    fishingSurveys: 0,
    wreckReports: 0,
    idolLocations: 0,
  };
}

function addVoyageTotals(
  target: MutableGreatHallVoyageTotals,
  source: Readonly<GreatHallVoyageTotals>,
): void {
  target.returnedVoyages += source.returnedVoyages;
  target.lostVoyages += source.lostVoyages;
  target.islandLeads += source.islandLeads;
  target.islandDossiers += source.islandDossiers;
  target.surveySiteLeads += source.surveySiteLeads;
  target.surveySiteReports += source.surveySiteReports;
  target.fishingLeads += source.fishingLeads;
  target.fishingSurveys += source.fishingSurveys;
  target.wreckReports += source.wreckReports;
  target.idolLocations += source.idolLocations;
}

const EMPTY_ACHIEVEMENTS = Object.freeze([]) as readonly [];
const UNLOCATED_WRECK_FATE = Object.freeze({ state: "unlocated" as const });
