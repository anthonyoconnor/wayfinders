import type { ShipwreckState } from "../core/types";
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
  type NavigatorVoyageAchievementRecordV3,
} from "./NavigatorLineageSystem";

export const GREAT_HALL_CHRONICLE_READ_MODEL_VERSION = 3 as const;

const greatHallVoyageKeyBrand: unique symbol = Symbol("GreatHallVoyageKey");
const greatHallAchievementKeyBrand: unique symbol = Symbol("GreatHallAchievementKey");

export type GreatHallVoyageKey = string & { readonly [greatHallVoyageKeyBrand]: true };
export type GreatHallAchievementKey = string & { readonly [greatHallAchievementKeyBrand]: true };

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
}

interface GreatHallAchievementBase {
  readonly key: GreatHallAchievementKey;
  readonly label: string;
}

export interface GreatHallSupportedRouteAchievement extends GreatHallAchievementBase {
  readonly kind: "supported-route-tiles";
  readonly tileCount: number;
}

export interface GreatHallMappedWaterAchievement extends GreatHallAchievementBase {
  readonly kind: "mapped-enclosed-water-tiles";
  readonly tileCount: number;
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

export type GreatHallAchievement =
  | GreatHallSupportedRouteAchievement
  | GreatHallMappedWaterAchievement
  | GreatHallIslandLeadAchievement
  | GreatHallIslandDossierAchievement
  | GreatHallSurveySiteLeadAchievement
  | GreatHallSurveySiteReportAchievement
  | GreatHallFishingLeadAchievement
  | GreatHallFishingSurveyAchievement
  | GreatHallWreckReportAchievement;

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
  readonly supportedRouteTiles: number;
  readonly mappedEnclosedWaterTiles: number;
  readonly islandLeads: number;
  readonly islandDossiers: number;
  readonly surveySiteLeads: number;
  readonly surveySiteReports: number;
  readonly fishingLeads: number;
  readonly fishingSurveys: number;
  readonly wreckReports: number;
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

  return Object.freeze({
    readModelVersion: GREAT_HALL_CHRONICLE_READ_MODEL_VERSION,
    navigators: entries,
    totals: totalLineage(entries),
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

function buildReturnedAchievements(
  navigator: Readonly<NavigatorRecordV6>,
  voyage: Readonly<NavigatorVoyageAchievementRecordV3>,
  voyageKey: GreatHallVoyageKey,
  indexes: Readonly<SourceIndexes>,
  usedAchievementKeys: Set<string>,
  wreckReportCredits: Map<number, Readonly<WreckReportCredit>>,
): readonly Readonly<GreatHallAchievement>[] {
  const achievements: Readonly<GreatHallAchievement>[] = [];
  const add = <T extends GreatHallAchievement>(achievement: T): void => {
    registerUniqueKey(usedAchievementKeys, achievement.key, "achievement");
    achievements.push(Object.freeze(achievement));
  };

  if (voyage.supportedTileCount > 0) {
    add({
      key: createAchievementKey(voyageKey, "supported-route-tiles"),
      kind: "supported-route-tiles",
      tileCount: voyage.supportedTileCount,
      label: `Supported ${voyage.supportedTileCount} route tile${voyage.supportedTileCount === 1 ? "" : "s"}`,
    });
  }
  if (voyage.closedUnknownTileCount > 0) {
    add({
      key: createAchievementKey(voyageKey, "mapped-enclosed-water-tiles"),
      kind: "mapped-enclosed-water-tiles",
      tileCount: voyage.closedUnknownTileCount,
      label: `Mapped ${voyage.closedUnknownTileCount} enclosed water tile${voyage.closedUnknownTileCount === 1 ? "" : "s"}`,
    });
  }

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
      wreck.survey.state !== "returned"
      || wreck.survey.expeditionId !== voyage.expeditionId
      || wreck.survey.generation !== navigator.generation
    ) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references wreck report ${wreckId} that was not returned by it`);
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

  return Object.freeze(achievements);
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
  return {
    islandDossierById: uniqueMap(
      sources.islandDossiers,
      ({ islandId }) => islandId,
      (definition) => definition,
      "island dossier",
    ),
    surveySiteById: uniqueMap(
      sources.surveySites,
      ({ id }) => id,
      (definition) => definition,
      "survey site",
    ),
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
  };
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
        case "supported-route-tiles":
          totals.supportedRouteTiles += achievement.tileCount;
          break;
        case "mapped-enclosed-water-tiles":
          totals.mappedEnclosedWaterTiles += achievement.tileCount;
          break;
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
    supportedRouteTiles: 0,
    mappedEnclosedWaterTiles: 0,
    islandLeads: 0,
    islandDossiers: 0,
    surveySiteLeads: 0,
    surveySiteReports: 0,
    fishingLeads: 0,
    fishingSurveys: 0,
    wreckReports: 0,
  };
}

function addVoyageTotals(
  target: MutableGreatHallVoyageTotals,
  source: Readonly<GreatHallVoyageTotals>,
): void {
  target.returnedVoyages += source.returnedVoyages;
  target.lostVoyages += source.lostVoyages;
  target.supportedRouteTiles += source.supportedRouteTiles;
  target.mappedEnclosedWaterTiles += source.mappedEnclosedWaterTiles;
  target.islandLeads += source.islandLeads;
  target.islandDossiers += source.islandDossiers;
  target.surveySiteLeads += source.surveySiteLeads;
  target.surveySiteReports += source.surveySiteReports;
  target.fishingLeads += source.fishingLeads;
  target.fishingSurveys += source.fishingSurveys;
  target.wreckReports += source.wreckReports;
}

const EMPTY_ACHIEVEMENTS = Object.freeze([]) as readonly [];
const UNLOCATED_WRECK_FATE = Object.freeze({ state: "unlocated" as const });
