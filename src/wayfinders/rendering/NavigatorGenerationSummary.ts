import {
  NAVIGATOR_VOYAGE_LIMIT,
  type NavigatorId,
  type NavigatorRecordV3,
} from "../lineage/NavigatorLineageSystem";

export type NavigatorGenerationOutcome = "tenure-completed" | "lost-at-sea";
export type NavigatorJourneyOutcome = "returned" | "lost-at-sea";

export interface NavigatorJourneySummary {
  readonly voyageNumber: number;
  readonly outcome: NavigatorJourneyOutcome;
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
 * Derives generic returned/lost journey rows from the authoritative lineage
 * record. Specific voyage achievements remain the responsibility of the later
 * Great Hall chronicle.
 */
export function buildNavigatorGenerationSummary(
  navigator: Readonly<NavigatorRecordV3>,
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
  for (let voyageNumber = 1; voyageNumber <= navigator.completedVoyages; voyageNumber++) {
    journeys.push(Object.freeze({ voyageNumber, outcome: "returned" }));
  }
  if (navigator.state === "lost") {
    journeys.push(Object.freeze({
      voyageNumber: navigator.completedVoyages + 1,
      outcome: "lost-at-sea",
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
