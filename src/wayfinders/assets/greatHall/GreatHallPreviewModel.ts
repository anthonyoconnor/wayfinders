export const GREAT_HALL_PREVIEW_MAX_GENERATIONS = 20;
export const GREAT_HALL_ERA_SIZE = 12;

export type GreatHallPreviewMode = "home" | "handover" | "completion";
export type GreatHallPreviewNavigatorState =
  | "active"
  | "completed"
  | "lost-unlocated"
  | "lost-confirmed";
export type GreatHallPreviewVoyageState =
  | "returned"
  | "lost"
  | "awaiting"
  | "unsailed"
  | "closed";
export type GreatHallPreviewAchievementKind =
  | "supported-route"
  | "mapped-water"
  | "island-lead"
  | "island-dossier"
  | "survey-lead"
  | "survey-report"
  | "fishing-lead"
  | "fishing-survey"
  | "wreck-report"
  | "idol-location";

export interface GreatHallPreviewAchievement {
  readonly kind: GreatHallPreviewAchievementKind;
  readonly label: string;
}

export interface GreatHallPreviewVoyage {
  readonly position: 1 | 2 | 3 | 4;
  readonly state: GreatHallPreviewVoyageState;
  readonly achievements: readonly Readonly<GreatHallPreviewAchievement>[];
}

export interface GreatHallPreviewNavigator {
  readonly generation: number;
  readonly portraitUrl: string;
  readonly state: GreatHallPreviewNavigatorState;
  readonly voyages: readonly Readonly<GreatHallPreviewVoyage>[];
  readonly confirmedByGeneration?: number;
}

export interface GreatHallPreviewTotals {
  readonly navigators: number;
  readonly returnedVoyages: number;
  readonly completedNavigators: number;
  readonly lostNavigators: number;
  readonly confirmedWrecks: number;
  readonly idolLocations: number;
  readonly idolTotal: 3;
}

export interface GreatHallPreviewModel {
  readonly mode: GreatHallPreviewMode;
  readonly navigatorCount: number;
  readonly eraIndex: number;
  readonly eraCount: number;
  readonly eraStart: number;
  readonly eraEnd: number;
  readonly visibleNavigators: readonly Readonly<GreatHallPreviewNavigator>[];
  readonly selectedNavigator: Readonly<GreatHallPreviewNavigator>;
  readonly totals: Readonly<GreatHallPreviewTotals>;
}

const ACHIEVEMENTS = Object.freeze({
  route: Object.freeze({ kind: "supported-route", label: "Charted a supported route" }),
  water: Object.freeze({ kind: "mapped-water", label: "Mapped an enclosed lagoon" }),
  islandLead: Object.freeze({ kind: "island-lead", label: "Sighted Greenwake Island" }),
  islandDossier: Object.freeze({ kind: "island-dossier", label: "Surveyed Greenwake Island" }),
  siteLead: Object.freeze({ kind: "survey-lead", label: "Found a coastal survey lead" }),
  siteReport: Object.freeze({ kind: "survey-report", label: "Recorded a tidal-cave survey" }),
  fishingLead: Object.freeze({ kind: "fishing-lead", label: "Sighted a fishing shoal" }),
  fishingSurvey: Object.freeze({ kind: "fishing-survey", label: "Surveyed a rich fishing shoal" }),
  wreck: Object.freeze({ kind: "wreck-report", label: "Confirmed an ancestor's wreck fate" }),
  idol: Object.freeze({ kind: "idol-location", label: "Returned an idol location" }),
} satisfies Record<string, Readonly<GreatHallPreviewAchievement>>);

function returned(
  position: 1 | 2 | 3 | 4,
  ...achievements: readonly Readonly<GreatHallPreviewAchievement>[]
): Readonly<GreatHallPreviewVoyage> {
  return Object.freeze({ position, state: "returned", achievements: Object.freeze(achievements) });
}

function voyage(
  position: 1 | 2 | 3 | 4,
  state: Exclude<GreatHallPreviewVoyageState, "returned">,
): Readonly<GreatHallPreviewVoyage> {
  return Object.freeze({ position, state, achievements: Object.freeze([]) });
}

function completedVoyages(
  first: readonly Readonly<GreatHallPreviewAchievement>[],
  second: readonly Readonly<GreatHallPreviewAchievement>[],
  third: readonly Readonly<GreatHallPreviewAchievement>[],
  fourth: readonly Readonly<GreatHallPreviewAchievement>[],
): readonly Readonly<GreatHallPreviewVoyage>[] {
  return Object.freeze([
    returned(1, ...first),
    returned(2, ...second),
    returned(3, ...third),
    returned(4, ...fourth),
  ]);
}

function lostVoyages(
  completed: readonly (readonly Readonly<GreatHallPreviewAchievement>[])[],
): readonly Readonly<GreatHallPreviewVoyage>[] {
  const records: Readonly<GreatHallPreviewVoyage>[] = completed.map((items, index) =>
    returned((index + 1) as 1 | 2 | 3, ...items));
  const fatalPosition = (completed.length + 1) as 1 | 2 | 3 | 4;
  records.push(voyage(fatalPosition, "lost"));
  for (let position = fatalPosition + 1; position <= 4; position += 1) {
    records.push(voyage(position as 2 | 3 | 4, "closed"));
  }
  return Object.freeze(records);
}

function portraitUrl(generation: number): string {
  return `/assets/gr5/great-hall/portraits/navigator-${String(generation).padStart(2, "0")}.png`;
}

function navigator(
  generation: number,
  state: GreatHallPreviewNavigatorState,
  voyages: readonly Readonly<GreatHallPreviewVoyage>[],
  confirmedByGeneration?: number,
): Readonly<GreatHallPreviewNavigator> {
  return Object.freeze({
    generation,
    portraitUrl: portraitUrl(generation),
    state,
    voyages,
    ...(confirmedByGeneration === undefined ? {} : { confirmedByGeneration }),
  });
}

const V = ACHIEVEMENTS;

export const GREAT_HALL_PREVIEW_ROSTER = Object.freeze([
  navigator(1, "completed", completedVoyages([V.route], [V.water], [V.fishingLead], [V.fishingSurvey])),
  navigator(2, "completed", completedVoyages([V.route, V.islandLead], [V.islandDossier], [], [V.siteLead])),
  navigator(3, "lost-unlocated", lostVoyages([[V.route], [V.fishingLead]])),
  navigator(4, "completed", completedVoyages([V.water], [V.siteLead], [V.siteReport], [V.route])),
  navigator(5, "lost-confirmed", lostVoyages([[V.islandLead], [V.islandDossier], [V.fishingSurvey]]), 9),
  navigator(6, "completed", completedVoyages([V.route], [V.fishingLead], [V.fishingSurvey], [V.water])),
  navigator(7, "completed", completedVoyages([V.siteLead], [V.siteReport], [V.islandDossier], [V.idol])),
  navigator(8, "lost-unlocated", lostVoyages([[V.route]])),
  navigator(9, "completed", completedVoyages([V.wreck], [V.water], [V.islandLead], [V.siteReport])),
  navigator(10, "lost-confirmed", lostVoyages([[V.fishingLead], [V.fishingSurvey]]), 13),
  navigator(11, "completed", completedVoyages([V.route], [V.water], [V.siteLead], [V.siteReport])),
  navigator(12, "completed", completedVoyages([V.islandLead], [V.islandDossier], [V.fishingLead], [V.route])),
  navigator(13, "completed", completedVoyages([V.wreck], [V.fishingSurvey], [V.water], [V.idol])),
  navigator(14, "lost-unlocated", lostVoyages([[V.route], [V.siteLead], [V.siteReport]])),
  navigator(15, "completed", completedVoyages([V.islandLead], [V.islandDossier], [V.water], [V.route])),
  navigator(16, "lost-confirmed", lostVoyages([[V.fishingLead], [V.fishingSurvey], [V.siteLead]]), 18),
  navigator(17, "completed", completedVoyages([V.route], [V.water], [V.islandLead], [V.islandDossier])),
  navigator(18, "completed", completedVoyages([V.wreck], [V.siteReport], [V.fishingSurvey], [V.route])),
  navigator(19, "lost-unlocated", lostVoyages([[V.water], [V.islandLead]])),
  navigator(20, "active", Object.freeze([
    returned(1, V.route, V.water, V.islandLead, V.islandDossier),
    returned(2, V.siteLead, V.siteReport, V.fishingLead),
    returned(3, V.fishingSurvey, V.wreck, V.idol),
    voyage(4, "awaiting"),
  ])),
] satisfies readonly Readonly<GreatHallPreviewNavigator>[]);

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function projectRoster(navigatorCount: number): readonly Readonly<GreatHallPreviewNavigator>[] {
  const roster = GREAT_HALL_PREVIEW_ROSTER.slice(0, navigatorCount).map((entry) => {
    if (entry.state !== "lost-confirmed" || entry.confirmedByGeneration! <= navigatorCount) {
      return entry;
    }
    return navigator(entry.generation, "lost-unlocated", entry.voyages);
  });
  const current = roster.at(-1)!;
  if (current.state === "active") return Object.freeze(roster);

  const returnedVoyages = current.voyages
    .filter(({ state }) => state === "returned")
    .slice(0, 3);
  const activeVoyages: Readonly<GreatHallPreviewVoyage>[] = [...returnedVoyages];
  const awaitingPosition = (returnedVoyages.length + 1) as 1 | 2 | 3 | 4;
  activeVoyages.push(voyage(awaitingPosition, "awaiting"));
  for (let position = awaitingPosition + 1; position <= 4; position += 1) {
    activeVoyages.push(voyage(position as 2 | 3 | 4, "unsailed"));
  }
  roster[roster.length - 1] = navigator(
    current.generation,
    "active",
    Object.freeze(activeVoyages),
  );
  return Object.freeze(roster);
}

export function buildGreatHallPreviewModel(options: Readonly<{
  navigatorCount: number;
  selectedGeneration?: number;
  mode?: GreatHallPreviewMode;
}>): Readonly<GreatHallPreviewModel> {
  const navigatorCount = clampInteger(options.navigatorCount, 1, GREAT_HALL_PREVIEW_MAX_GENERATIONS);
  const selectedGeneration = clampInteger(
    options.selectedGeneration ?? navigatorCount,
    1,
    navigatorCount,
  );
  const eraIndex = Math.floor((selectedGeneration - 1) / GREAT_HALL_ERA_SIZE);
  const eraCount = Math.ceil(navigatorCount / GREAT_HALL_ERA_SIZE);
  const eraStart = eraIndex * GREAT_HALL_ERA_SIZE + 1;
  const eraEnd = Math.min(navigatorCount, eraStart + GREAT_HALL_ERA_SIZE - 1);
  const roster = projectRoster(navigatorCount);
  const visibleNavigators = Object.freeze(roster.slice(eraStart - 1, eraEnd));
  const selectedNavigator = roster[selectedGeneration - 1]!;
  const returnedVoyages = roster.reduce((total, entry) =>
    total + entry.voyages.filter(({ state }) => state === "returned").length, 0);
  const idolLocations = roster.reduce((total, entry) =>
    total + entry.voyages.reduce((voyageTotal, record) => voyageTotal
      + record.achievements.filter(({ kind }) => kind === "idol-location").length, 0), 0);

  return Object.freeze({
    mode: options.mode ?? "home",
    navigatorCount,
    eraIndex,
    eraCount,
    eraStart,
    eraEnd,
    visibleNavigators,
    selectedNavigator,
    totals: Object.freeze({
      navigators: navigatorCount,
      returnedVoyages,
      completedNavigators: roster.filter(({ state }) => state === "completed").length,
      lostNavigators: roster.filter(({ state }) => state.startsWith("lost-")).length,
      confirmedWrecks: roster.filter(({ state }) => state === "lost-confirmed").length,
      idolLocations,
      idolTotal: 3,
    }),
  });
}
