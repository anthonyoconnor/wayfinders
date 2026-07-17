export const GREAT_HALL_PRESENTATION_VERSION = 1 as const;
export const GREAT_HALL_ERA_SIZE = 12;
export const GREAT_HALL_MAX_GENERATIONS = 20;

export type GreatHallPresentationMode = "home" | "handover" | "completion";
export type GreatHallPresentationNavigatorState =
  | "active"
  | "completed"
  | "lost-unlocated"
  | "lost-confirmed";
export type GreatHallPresentationVoyageState =
  | "returned"
  | "lost"
  | "awaiting"
  | "unsailed"
  | "closed";
export type GreatHallPresentationAchievementKind =
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

export interface GreatHallPresentationAchievement {
  readonly kind: GreatHallPresentationAchievementKind;
  readonly label: string;
}

export interface GreatHallPresentationVoyage {
  readonly position: 1 | 2 | 3 | 4;
  readonly state: GreatHallPresentationVoyageState;
  readonly achievements: readonly Readonly<GreatHallPresentationAchievement>[];
}

export interface GreatHallPresentationNavigator {
  readonly id: string;
  readonly generation: number;
  readonly portraitUrl: string;
  readonly state: GreatHallPresentationNavigatorState;
  readonly voyages: readonly Readonly<GreatHallPresentationVoyage>[];
  readonly confirmedByGeneration?: number;
}

export interface GreatHallPresentationModel {
  readonly version: typeof GREAT_HALL_PRESENTATION_VERSION;
  readonly mode: GreatHallPresentationMode;
  readonly currentGeneration: number;
  readonly selectedGeneration: number;
  readonly nextGeneration?: number;
  readonly idolProgress: Readonly<{
    readonly found: number;
    readonly total: number;
    readonly complete: boolean;
  }>;
  readonly navigators: readonly Readonly<GreatHallPresentationNavigator>[];
}

const MODES = new Set<GreatHallPresentationMode>(["home", "handover", "completion"]);
const NAVIGATOR_STATES = new Set<GreatHallPresentationNavigatorState>([
  "active", "completed", "lost-unlocated", "lost-confirmed",
]);
const VOYAGE_STATES = new Set<GreatHallPresentationVoyageState>([
  "returned", "lost", "awaiting", "unsailed", "closed",
]);
const ACHIEVEMENT_KINDS = new Set<GreatHallPresentationAchievementKind>([
  "supported-route", "mapped-water", "island-lead", "island-dossier", "survey-lead",
  "survey-report", "fishing-lead", "fishing-survey", "wreck-report", "idol-location",
]);

/** Validates the checked-in fixture and any other untyped JSON boundary before rendering. */
export function validateGreatHallPresentationModel(value: unknown): Readonly<GreatHallPresentationModel> {
  const model = record(value, "Great Hall presentation model");
  if (model.version !== GREAT_HALL_PRESENTATION_VERSION) fail("version must be 1");
  if (!MODES.has(model.mode as GreatHallPresentationMode)) fail("mode is invalid");
  const navigators = array(model.navigators, "navigators");
  if (navigators.length < 1 || navigators.length > GREAT_HALL_MAX_GENERATIONS) {
    fail(`navigators must contain 1 through ${GREAT_HALL_MAX_GENERATIONS} entries`);
  }
  const currentGeneration = integer(model.currentGeneration, "currentGeneration");
  const selectedGeneration = integer(model.selectedGeneration, "selectedGeneration");
  if (model.nextGeneration !== undefined) integer(model.nextGeneration, "nextGeneration");
  const navigatorIds = new Set<string>();
  const portraitUrls = new Set<string>();

  for (const [index, rawNavigator] of navigators.entries()) {
    const navigator = record(rawNavigator, `navigator ${index + 1}`);
    const navigatorId = string(navigator.id, `navigator ${index + 1} id`);
    if (navigatorId.length === 0 || navigatorIds.has(navigatorId)) fail("navigator ids must be non-empty and unique");
    navigatorIds.add(navigatorId);
    if (integer(navigator.generation, `navigator ${index + 1} generation`) !== index + 1) {
      fail("navigator generations must be ordered and contiguous from 1");
    }
    const portraitUrl = string(navigator.portraitUrl, `navigator ${index + 1} portraitUrl`);
    if (portraitUrl !== navigatorPortraitUrl(index + 1) || portraitUrls.has(portraitUrl)) {
      fail("portraitUrl must be the generation's unique fixed portrait");
    }
    portraitUrls.add(portraitUrl);
    if (!NAVIGATOR_STATES.has(navigator.state as GreatHallPresentationNavigatorState)) {
      fail(`navigator ${index + 1} state is invalid`);
    }
    if (navigator.confirmedByGeneration !== undefined) {
      const confirmed = integer(navigator.confirmedByGeneration, `navigator ${index + 1} confirmedByGeneration`);
      if (confirmed <= index + 1 || confirmed > navigators.length) fail("wreck confirmation generation is invalid");
    }
    const voyages = array(navigator.voyages, `navigator ${index + 1} voyages`);
    if (voyages.length !== 4) fail(`navigator ${index + 1} must have four voyage positions`);
    for (const [voyageIndex, rawVoyage] of voyages.entries()) {
      const voyage = record(rawVoyage, `navigator ${index + 1} voyage ${voyageIndex + 1}`);
      if (voyage.position !== voyageIndex + 1) fail("voyage positions must be ordered 1 through 4");
      if (!VOYAGE_STATES.has(voyage.state as GreatHallPresentationVoyageState)) fail("voyage state is invalid");
      const achievements = array(voyage.achievements, "voyage achievements");
      if (voyage.state !== "returned" && achievements.length > 0) {
        fail("only returned voyages may contain achievements");
      }
      for (const rawAchievement of achievements) {
        const achievement = record(rawAchievement, "achievement");
        if (!ACHIEVEMENT_KINDS.has(achievement.kind as GreatHallPresentationAchievementKind)) {
          fail("achievement kind is invalid");
        }
        if (string(achievement.label, "achievement label").trim().length === 0) fail("achievement label is empty");
      }
    }
  }

  if (currentGeneration !== navigators.length) fail("currentGeneration must identify the newest navigator");
  if (selectedGeneration < 1 || selectedGeneration > navigators.length) fail("selectedGeneration is out of range");
  if (model.mode === "handover" && model.nextGeneration !== currentGeneration + 1) {
    fail("handover nextGeneration must follow the current generation");
  }
  if (model.mode !== "handover" && model.nextGeneration !== undefined) {
    fail("nextGeneration is valid only in handover mode");
  }
  const idolProgress = record(model.idolProgress, "idolProgress");
  const found = integer(idolProgress.found, "idolProgress.found");
  const total = integer(idolProgress.total, "idolProgress.total");
  if (found < 0 || total < 0 || found > total) fail("idolProgress counts are invalid");
  if (idolProgress.complete !== (total > 0 && found === total)) fail("idolProgress.complete is inconsistent");
  return value as Readonly<GreatHallPresentationModel>;
}

export function navigatorPortraitUrl(generation: number): string {
  if (!Number.isInteger(generation) || generation < 1 || generation > GREAT_HALL_MAX_GENERATIONS) {
    throw new RangeError(`Great Hall portrait generation must be 1 through ${GREAT_HALL_MAX_GENERATIONS}`);
  }
  return `/assets/gr5/great-hall/portraits/navigator-${String(generation).padStart(2, "0")}.png`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value as number;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a string`);
  return value;
}

function fail(message: string): never {
  throw new TypeError(`Invalid GreatHallPresentationModel: ${message}`);
}
