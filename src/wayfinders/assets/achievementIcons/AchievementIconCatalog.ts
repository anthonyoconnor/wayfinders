import type { GreatHallPresentationAchievementKind } from "../../rendering/greatHall/GreatHallPresentationModel";

export const ACHIEVEMENT_ICON_SHEET_URL =
  "/assets/gr5/achievement-icons/achievement-icon-sprites.png" as const;
export const ACHIEVEMENT_ICON_FRAME_SIZE_PX = 128 as const;
export const ACHIEVEMENT_ICON_FRAME_COUNT = 16 as const;
export const ACHIEVEMENT_ICON_ROW_COUNT = 10 as const;
export const ACHIEVEMENT_ICON_FRAMES_PER_SECOND = 12 as const;

export const ACHIEVEMENT_ICON_KINDS = Object.freeze([
  "supported-route",
  "mapped-water",
  "island-lead",
  "island-dossier",
  "survey-lead",
  "survey-report",
  "fishing-lead",
  "fishing-survey",
  "wreck-report",
  "idol-location",
] as const satisfies readonly GreatHallPresentationAchievementKind[]);

export type AchievementIconRow = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface AchievementIconMetadata {
  readonly kind: GreatHallPresentationAchievementKind;
  readonly row: AchievementIconRow;
  readonly shortLabel: string;
  readonly visualDescription: string;
}

export interface AchievementIconSourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: typeof ACHIEVEMENT_ICON_FRAME_SIZE_PX;
  readonly height: typeof ACHIEVEMENT_ICON_FRAME_SIZE_PX;
}

export const ACHIEVEMENT_ICON_CATALOG: Readonly<Record<
  GreatHallPresentationAchievementKind,
  Readonly<AchievementIconMetadata>
>> = Object.freeze({
  "supported-route": Object.freeze({
    kind: "supported-route",
    row: 0,
    shortLabel: "Supported route",
    visualDescription: "A canoe follows a dotted, curving wake whose marks flow gently behind it.",
  }),
  "mapped-water": Object.freeze({
    kind: "mapped-water",
    row: 1,
    shortLabel: "Mapped enclosed water",
    visualDescription: "A closed lagoon ring ripples around a small map notch.",
  }),
  "island-lead": Object.freeze({
    kind: "island-lead",
    row: 2,
    shortLabel: "Island lead",
    visualDescription: "An outlined island is crossed by slowly sweeping sight rays.",
  }),
  "island-dossier": Object.freeze({
    kind: "island-dossier",
    row: 3,
    shortLabel: "Island dossier",
    visualDescription: "An inlaid island settles inside a closing survey ring.",
  }),
  "survey-lead": Object.freeze({
    kind: "survey-lead",
    row: 4,
    shortLabel: "Survey-site lead",
    visualDescription: "An open survey marker emits a restrained directional pulse.",
  }),
  "survey-report": Object.freeze({
    kind: "survey-report",
    row: 5,
    shortLabel: "Survey-site report",
    visualDescription: "A filled survey marker glows with a restrained directional pulse.",
  }),
  "fishing-lead": Object.freeze({
    kind: "fishing-lead",
    row: 6,
    shortLabel: "Fishing lead",
    visualDescription: "An outlined fish hovers above widening open ripples.",
  }),
  "fishing-survey": Object.freeze({
    kind: "fishing-survey",
    row: 7,
    shortLabel: "Fishing survey",
    visualDescription: "A filled fish rises above closed ripples and small quality notches.",
  }),
  "wreck-report": Object.freeze({
    kind: "wreck-report",
    row: 8,
    shortLabel: "Wreck report",
    visualDescription: "A broken mast is joined by a shell knot with a subtle settling motion.",
  }),
  "idol-location": Object.freeze({
    kind: "idol-location",
    row: 9,
    shortLabel: "Idol location",
    visualDescription: "A gold shell-idol catches a warm, restrained glint.",
  }),
} satisfies Record<GreatHallPresentationAchievementKind, Readonly<AchievementIconMetadata>>);

/** Returns the exact source rectangle for one validated frame of an achievement row. */
export function achievementIconSourceRect(
  kind: GreatHallPresentationAchievementKind,
  frameIndex: number,
): AchievementIconSourceRect {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= ACHIEVEMENT_ICON_FRAME_COUNT) {
    throw new RangeError(
      `Achievement icon frame index must be an integer from 0 through ${ACHIEVEMENT_ICON_FRAME_COUNT - 1}`,
    );
  }
  const metadata = ACHIEVEMENT_ICON_CATALOG[kind];
  if (metadata === undefined) throw new RangeError(`Unknown achievement icon kind: ${String(kind)}`);
  return Object.freeze({
    x: frameIndex * ACHIEVEMENT_ICON_FRAME_SIZE_PX,
    y: metadata.row * ACHIEVEMENT_ICON_FRAME_SIZE_PX,
    width: ACHIEVEMENT_ICON_FRAME_SIZE_PX,
    height: ACHIEVEMENT_ICON_FRAME_SIZE_PX,
  });
}

/** Returns the CSS background-position percentage that aligns the kind's row. */
export function achievementIconRowPositionPercent(
  kind: GreatHallPresentationAchievementKind,
): number {
  const metadata = ACHIEVEMENT_ICON_CATALOG[kind];
  if (metadata === undefined) throw new RangeError(`Unknown achievement icon kind: ${String(kind)}`);
  return metadata.row * 100 / (ACHIEVEMENT_ICON_ROW_COUNT - 1);
}

/** Selects a looping frame deterministically from elapsed animation time. */
export function achievementIconFrameAtElapsedMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError("Achievement icon elapsed time must be a finite non-negative number");
  }
  const elapsedFrame = Math.floor(elapsedMs * ACHIEVEMENT_ICON_FRAMES_PER_SECOND / 1_000);
  return elapsedFrame % ACHIEVEMENT_ICON_FRAME_COUNT;
}
