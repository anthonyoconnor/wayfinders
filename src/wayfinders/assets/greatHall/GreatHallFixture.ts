import fixtureJson from "./great-hall.fixture.json";
import {
  GREAT_HALL_MAX_GENERATIONS,
  validateGreatHallPresentationModel,
  type GreatHallPresentationMode,
  type GreatHallPresentationModel,
  type GreatHallPresentationNavigator,
  type GreatHallPresentationVoyage,
} from "../../rendering/greatHall/GreatHallPresentationModel";

export const GREAT_HALL_FIXTURE = validateGreatHallPresentationModel(fixtureJson);

export function buildGreatHallFixture(options: Readonly<{
  navigatorCount: number;
  selectedGeneration?: number;
  mode?: GreatHallPresentationMode;
}>): Readonly<GreatHallPresentationModel> {
  const count = clamp(options.navigatorCount, 1, GREAT_HALL_MAX_GENERATIONS);
  const mode = options.mode ?? "home";
  const requestedSelection = clamp(options.selectedGeneration ?? count, 1, count);
  const selectedGeneration = mode === "handover" && count > 1
    ? Math.min(requestedSelection, count - 1)
    : requestedSelection;
  const navigators = GREAT_HALL_FIXTURE.navigators.slice(0, count).map((navigator) =>
    projectNavigator(navigator, count, mode));
  const found = navigators.reduce((total, navigator) => total + navigator.voyages.reduce(
    (voyageTotal, voyage) => voyageTotal + voyage.achievements.filter(({ kind }) => kind === "idol-location").length,
    0,
  ), 0);
  return validateGreatHallPresentationModel({
    version: GREAT_HALL_FIXTURE.version,
    mode,
    currentGeneration: count,
    selectedGeneration,
    ...(mode === "handover" ? { nextGeneration: count === 1 ? 2 : count } : {}),
    idolProgress: { found, total: 3, complete: found === 3 },
    navigators,
  });
}

function projectNavigator(
  navigator: Readonly<GreatHallPresentationNavigator>,
  count: number,
  mode: GreatHallPresentationMode,
): GreatHallPresentationNavigator {
  if (navigator.generation === count && navigator.state !== "active" && !(mode === "handover" && count === 1)) {
    const returned = navigator.voyages.filter(({ state }) => state === "returned").slice(0, 3);
    const voyages: GreatHallPresentationVoyage[] = [...returned];
    const awaiting = voyages.length + 1;
    for (let position = awaiting; position <= 4; position += 1) {
      voyages.push({
        position: position as 1 | 2 | 3 | 4,
        state: position === awaiting ? "awaiting" : "unsailed",
        achievements: [],
      });
    }
    return { ...navigator, state: "active", voyages, confirmedByGeneration: undefined };
  }
  if (navigator.state === "lost-confirmed" && navigator.confirmedByGeneration! > count) {
    return { ...navigator, state: "lost-unlocated", confirmedByGeneration: undefined };
  }
  return { ...navigator };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
