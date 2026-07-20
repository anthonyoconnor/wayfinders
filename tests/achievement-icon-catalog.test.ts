import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_ICON_CATALOG,
  ACHIEVEMENT_ICON_FRAME_COUNT,
  ACHIEVEMENT_ICON_FRAME_SIZE_PX,
  ACHIEVEMENT_ICON_FRAMES_PER_SECOND,
  ACHIEVEMENT_ICON_KINDS,
  ACHIEVEMENT_ICON_ROW_COUNT,
  ACHIEVEMENT_ICON_SHEET_URL,
  achievementIconFrameAtElapsedMs,
  achievementIconRowPositionPercent,
  achievementIconSourceRect,
} from "../src/wayfinders/assets/achievementIcons";

describe("achievement icon catalog", () => {
  it("covers the eight active presentation kinds once in canonical row order", () => {
    expect(ACHIEVEMENT_ICON_KINDS).toEqual([
      "island-lead",
      "island-dossier",
      "survey-lead",
      "survey-report",
      "fishing-lead",
      "fishing-survey",
      "wreck-report",
      "idol-location",
    ]);
    expect(Object.keys(ACHIEVEMENT_ICON_CATALOG)).toEqual(ACHIEVEMENT_ICON_KINDS);
    expect(ACHIEVEMENT_ICON_KINDS.map((kind) => ACHIEVEMENT_ICON_CATALOG[kind].row))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    for (const kind of ACHIEVEMENT_ICON_KINDS) {
      const metadata = ACHIEVEMENT_ICON_CATALOG[kind];
      expect(metadata.kind).toBe(kind);
      expect(metadata.shortLabel.trim()).not.toBe("");
      expect(metadata.visualDescription.trim()).not.toBe("");
    }
  });

  it("publishes the fixed sprite-sheet contract", () => {
    expect(ACHIEVEMENT_ICON_SHEET_URL).toBe(
      "/assets/gr5/achievement-icons/achievement-icon-sprites.png",
    );
    expect(ACHIEVEMENT_ICON_FRAME_SIZE_PX).toBe(128);
    expect(ACHIEVEMENT_ICON_FRAME_COUNT).toBe(16);
    expect(ACHIEVEMENT_ICON_ROW_COUNT).toBe(10);
    expect(ACHIEVEMENT_ICON_FRAMES_PER_SECOND).toBe(12);
  });

  it("maps validated frames to exact source rectangles", () => {
    expect(achievementIconSourceRect("island-lead", 0)).toEqual({
      x: 0,
      y: 256,
      width: 128,
      height: 128,
    });
    expect(achievementIconSourceRect("idol-location", 15)).toEqual({
      x: 1_920,
      y: 1_152,
      width: 128,
      height: 128,
    });
    expect(() => achievementIconSourceRect("island-lead", -1)).toThrow(RangeError);
    expect(() => achievementIconSourceRect("island-lead", 1.5)).toThrow(RangeError);
    expect(() => achievementIconSourceRect("island-lead", 16)).toThrow(RangeError);
  });

  it("maps catalog rows to exact CSS background positions", () => {
    expect(achievementIconRowPositionPercent("island-lead")).toBeCloseTo(200 / 9);
    expect(achievementIconRowPositionPercent("island-dossier")).toBeCloseTo(100 / 3);
    expect(achievementIconRowPositionPercent("idol-location")).toBe(100);
  });

  it("selects 12 fps frames and wraps every sixteen frames", () => {
    expect(achievementIconFrameAtElapsedMs(0)).toBe(0);
    expect(achievementIconFrameAtElapsedMs(83)).toBe(0);
    expect(achievementIconFrameAtElapsedMs(84)).toBe(1);
    expect(achievementIconFrameAtElapsedMs(1_333)).toBe(15);
    expect(achievementIconFrameAtElapsedMs(1_334)).toBe(0);
    expect(achievementIconFrameAtElapsedMs(2_667)).toBe(0);
  });

  it("rejects invalid elapsed animation time", () => {
    expect(() => achievementIconFrameAtElapsedMs(-1)).toThrow(RangeError);
    expect(() => achievementIconFrameAtElapsedMs(Number.NaN)).toThrow(RangeError);
    expect(() => achievementIconFrameAtElapsedMs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
