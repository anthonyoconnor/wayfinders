import type { NavigatorId } from "../../lineage/NavigatorLineageSystem";
import type {
  GreatHallAchievement,
  GreatHallChronicle,
  GreatHallNavigatorEntry,
} from "../../lineage/GreatHallChronicle";
import {
  GREAT_HALL_MAX_GENERATIONS,
  GREAT_HALL_PRESENTATION_VERSION,
  navigatorPortraitUrl,
  validateGreatHallPresentationModel,
  type GreatHallPresentationAchievement,
  type GreatHallPresentationMode,
  type GreatHallPresentationModel,
  type GreatHallPresentationNavigator,
  type GreatHallPresentationVoyage,
} from "./GreatHallPresentationModel";

const ACHIEVEMENT_KIND = Object.freeze({
  "supported-route-tiles": "supported-route",
  "mapped-enclosed-water-tiles": "mapped-water",
  "island-lead": "island-lead",
  "island-dossier": "island-dossier",
  "survey-site-lead": "survey-lead",
  "survey-site-report": "survey-report",
  "fishing-leads": "fishing-lead",
  "fishing-survey": "fishing-survey",
  "wreck-report": "wreck-report",
  "idol-location": "idol-location",
} satisfies Record<GreatHallAchievement["kind"], GreatHallPresentationAchievement["kind"]>);

export interface GreatHallPresentationRequest {
  readonly mode: GreatHallPresentationMode;
  readonly selectedNavigatorId?: NavigatorId;
  readonly nextGeneration?: number;
}

/** Pure projection from committed gameplay history into presentation-only identity and layout data. */
export function adaptGreatHallChronicle(
  chronicle: Readonly<GreatHallChronicle>,
  request: Readonly<GreatHallPresentationRequest>,
): Readonly<GreatHallPresentationModel> {
  if (chronicle.navigators.length > GREAT_HALL_MAX_GENERATIONS) {
    throw new RangeError(`Graphical Great Hall supports at most ${GREAT_HALL_MAX_GENERATIONS} generations`);
  }
  const selected = chronicle.navigators.find(({ navigatorId }) => navigatorId === request.selectedNavigatorId)
    ?? chronicle.navigators.at(-1);
  if (!selected) throw new RangeError("Great Hall chronicle requires at least one navigator");
  const model: GreatHallPresentationModel = {
    version: GREAT_HALL_PRESENTATION_VERSION,
    mode: request.mode,
    currentGeneration: chronicle.navigators.at(-1)!.generation,
    selectedGeneration: selected.generation,
    ...(request.nextGeneration === undefined ? {} : { nextGeneration: request.nextGeneration }),
    idolProgress: { ...chronicle.idolProgress },
    navigators: chronicle.navigators.map(adaptNavigator),
  };
  return validateGreatHallPresentationModel(model);
}

function adaptNavigator(entry: Readonly<GreatHallNavigatorEntry>): GreatHallPresentationNavigator {
  const voyages: GreatHallPresentationVoyage[] = entry.voyages.map((voyage) => ({
    position: voyage.voyageNumber as 1 | 2 | 3 | 4,
    state: voyage.outcome === "returned" ? "returned" : "lost",
    achievements: voyage.achievements.map((achievement) => ({
      kind: ACHIEVEMENT_KIND[achievement.kind],
      label: achievement.label,
    })),
  }));
  for (let position = voyages.length + 1; position <= 4; position += 1) {
    const state = entry.state === "active"
      ? position === entry.completedVoyages + 1 ? "awaiting" : "unsailed"
      : "closed";
    voyages.push({ position: position as 1 | 2 | 3 | 4, state, achievements: [] });
  }
  const state = entry.state !== "lost"
    ? entry.state
    : entry.wreckFate?.state === "confirmed" ? "lost-confirmed" : "lost-unlocated";
  return {
    id: entry.navigatorId,
    generation: entry.generation,
    portraitUrl: navigatorPortraitUrl(entry.generation),
    state,
    voyages,
    ...(entry.wreckFate?.state === "confirmed"
      ? { confirmedByGeneration: entry.wreckFate.returnedByGeneration }
      : {}),
  };
}
