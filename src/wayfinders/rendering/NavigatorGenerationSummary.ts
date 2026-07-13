import {
  NAVIGATOR_VOYAGE_LIMIT,
  type NavigatorId,
  type NavigatorRecordV4,
  type NavigatorVoyageAchievementRecordV1,
} from "../lineage/NavigatorLineageSystem";
import type { DiscoveryRecord } from "../exploration/DiscoverySystem";
import type {
  FishingShoalDefinition,
  FishingShoalId,
} from "../exploration/FishingShoalContracts";
import type { ShipwreckState } from "../core/types";

export type NavigatorGenerationOutcome = "tenure-completed" | "lost-at-sea";
export type NavigatorJourneyOutcome = "returned" | "lost-at-sea";

export interface NavigatorJourneySummary {
  readonly voyageNumber: number;
  readonly outcome: NavigatorJourneyOutcome;
  readonly achievements: readonly string[];
}

export interface NavigatorAchievementSources {
  readonly discoveries: readonly Readonly<Pick<DiscoveryRecord, "id" | "name">>[];
  readonly fishingShoals: readonly Readonly<Pick<FishingShoalDefinition, "id" | "quality">>[];
  readonly wrecks: readonly Readonly<Pick<ShipwreckState, "id" | "generation">>[];
}

/** Presentation-only read model for the handover from a terminal navigator. */
export interface NavigatorGenerationSummary {
  readonly generation: number;
  readonly navigatorId: NavigatorId;
  readonly outcome: NavigatorGenerationOutcome;
  readonly nextGeneration: number;
  readonly journeys: readonly Readonly<NavigatorJourneySummary>[];
}

/**
 * Derives returned/lost journey rows from the authoritative lineage record.
 * Returned rows resolve only exact-dock-committed source IDs; the fatal row
 * never receives provisional results from the voyage where the navigator died.
 */
export function buildNavigatorGenerationSummary(
  navigator: Readonly<NavigatorRecordV4>,
  sources: Readonly<NavigatorAchievementSources>,
): Readonly<NavigatorGenerationSummary> {
  if (navigator.state === "active") {
    throw new RangeError("A generation summary requires a terminal navigator");
  }
  if (navigator.state === "completed" && navigator.completedVoyages !== NAVIGATOR_VOYAGE_LIMIT) {
    throw new RangeError(`A completed navigator must have ${NAVIGATOR_VOYAGE_LIMIT} returned voyages`);
  }
  if (
    navigator.state === "lost"
    && (
      !Number.isSafeInteger(navigator.completedVoyages)
      || navigator.completedVoyages < 0
      || navigator.completedVoyages >= NAVIGATOR_VOYAGE_LIMIT
    )
  ) {
    throw new RangeError(`A lost navigator must have fewer than ${NAVIGATOR_VOYAGE_LIMIT} returned voyages`);
  }

  const journeys: Readonly<NavigatorJourneySummary>[] = [];
  for (const voyage of navigator.successfulVoyages) {
    journeys.push(Object.freeze({
      voyageNumber: voyage.voyageNumber,
      outcome: "returned",
      achievements: describeNavigatorVoyageAchievements(voyage, sources),
    }));
  }
  if (navigator.state === "lost") {
    journeys.push(Object.freeze({
      voyageNumber: navigator.completedVoyages + 1,
      outcome: "lost-at-sea",
      achievements: Object.freeze(["No findings from this journey were returned."]),
    }));
  }

  return Object.freeze({
    generation: navigator.generation,
    navigatorId: navigator.id,
    outcome: navigator.state === "completed" ? "tenure-completed" : "lost-at-sea",
    nextGeneration: navigator.generation + 1,
    journeys: Object.freeze(journeys),
  });
}

/** Shared dock-return and generation-summary wording for one committed voyage. */
export function describeNavigatorVoyageAchievements(
  voyage: Readonly<NavigatorVoyageAchievementRecordV1>,
  sources: Readonly<NavigatorAchievementSources>,
): readonly string[] {
  const achievements: string[] = [];
  if (voyage.supportedTileCount > 0) {
    achievements.push(
      `Supported ${voyage.supportedTileCount} route tile${voyage.supportedTileCount === 1 ? "" : "s"}`,
    );
  }
  if (voyage.closedUnknownTileCount > 0) {
    achievements.push(
      `Mapped ${voyage.closedUnknownTileCount} enclosed water tile${voyage.closedUnknownTileCount === 1 ? "" : "s"}`,
    );
  }

  const discoveryNames = new Map(sources.discoveries.map(({ id, name }) => [id, name]));
  for (const discoveryId of voyage.discoveryIds) {
    const name = discoveryNames.get(discoveryId);
    if (!name) throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown discovery ${discoveryId}`);
    achievements.push(`Discovered ${name}`);
  }

  if (voyage.fishingLeadIds.length > 0) {
    achievements.push(
      `Recorded ${voyage.fishingLeadIds.length} fishing lead${voyage.fishingLeadIds.length === 1 ? "" : "s"}`,
    );
  }
  const fishingQualityById = new Map<FishingShoalId, string>(
    sources.fishingShoals.map(({ id, quality }) => [id, quality]),
  );
  for (const fishingShoalId of voyage.fishingSurveyIds) {
    const quality = fishingQualityById.get(fishingShoalId);
    if (!quality) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown fishing shoal ${fishingShoalId}`);
    }
    achievements.push(`Surveyed a ${quality} fishing ground`);
  }

  const wreckGenerationById = new Map(sources.wrecks.map(({ id, generation }) => [id, generation]));
  for (const wreckId of voyage.wreckIds) {
    const generation = wreckGenerationById.get(wreckId);
    if (generation === undefined) {
      throw new RangeError(`Voyage ${voyage.voyageNumber} references unknown wreck ${wreckId}`);
    }
    achievements.push(`Identified the Generation ${generation} navigator's wreck`);
  }

  if (achievements.length === 0) achievements.push("No new findings returned.");
  return Object.freeze(achievements);
}
