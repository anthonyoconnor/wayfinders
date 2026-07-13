import { describe, expect, it } from "vitest";
import {
  NAVIGATOR_LINEAGE_CONTRACT_VERSION,
  NAVIGATOR_RETIREMENT_AGE_YEARS,
  NAVIGATOR_RETIREMENT_WARNING_AGE_YEARS,
  NAVIGATOR_STARTING_AGE_YEARS,
  NAVIGATOR_SUCCESSFUL_RETURN_AGE_INCREMENT_YEARS,
  NavigatorLineageSystem,
  NavigatorLineageValidationError,
  createNavigatorId,
  createNavigatorSuccessionKey,
  isCurrentNavigatorId,
  isCurrentNavigatorSuccessionKey,
  parseNavigatorId,
  parseNavigatorLineageSnapshot,
  parseNavigatorSuccessionKey,
  type NavigatorLineageSnapshotV2,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("NavigatorLineageSystem", () => {
  it("creates canonical stable navigator IDs and deterministic succession keys", () => {
    expect(createNavigatorId(1)).toBe("navigator:v1:g1");
    expect(createNavigatorId(42)).toBe("navigator:v1:g42");
    expect(parseNavigatorId("navigator:v1:g42")).toEqual({ version: 1, generation: 42 });
    expect(isCurrentNavigatorId("navigator:v1:g42")).toBe(true);
    expect(isCurrentNavigatorId("navigator:v2:g42")).toBe(false);
    expect(parseNavigatorId("navigator:v1:g042")).toBeUndefined();
    expect(() => createNavigatorId(0)).toThrow(/positive safe integer/);

    const key = createNavigatorSuccessionKey("wreck", 7);
    expect(key).toBe("navigator-succession:v1:wreck:7");
    expect(parseNavigatorSuccessionKey(key)).toEqual({ version: 1, reason: "wreck", resolutionId: 7 });
    expect(isCurrentNavigatorSuccessionKey(key)).toBe(true);
    expect(parseNavigatorSuccessionKey("navigator-succession:v1:wreck:07")).toBeUndefined();
  });

  it("creates one valid current-contract navigator for a requested generation", () => {
    const snapshot = new NavigatorLineageSystem(4).snapshot();

    expect(snapshot).toEqual({
      contractVersion: NAVIGATOR_LINEAGE_CONTRACT_VERSION,
      navigators: [{
        id: "navigator:v1:g4",
        generation: 4,
        state: "active",
        createdBySuccessionKey: null,
        ageYears: 30,
        finalVoyageDeclared: false,
      }],
      pendingSuccession: null,
    });
    expect(NavigatorLineageSystem.fromSnapshot(jsonClone(snapshot)).currentNavigator).toEqual(
      snapshot.navigators[0],
    );
  });

  it("advances only successful-return calls and exposes the warning and final thresholds", () => {
    expect(NAVIGATOR_STARTING_AGE_YEARS).toBe(30);
    expect(NAVIGATOR_SUCCESSFUL_RETURN_AGE_INCREMENT_YEARS).toBe(5);
    expect(NAVIGATOR_RETIREMENT_WARNING_AGE_YEARS).toBe(50);
    expect(NAVIGATOR_RETIREMENT_AGE_YEARS).toBe(55);

    const lineage = new NavigatorLineageSystem();
    for (const expectedAge of [35, 40, 45]) {
      expect(lineage.advanceSuccessfulReturn()).toMatchObject({
        status: "advanced",
        ageYears: expectedAge,
        retirementChoiceRequired: false,
        retirementRequired: false,
      });
    }
    expect(lineage.advanceSuccessfulReturn()).toMatchObject({
      ageYears: 50,
      retirementChoiceRequired: true,
      retirementRequired: false,
    });
    expect(lineage.aging).toEqual({
      navigatorId: "navigator:v1:g1",
      ageYears: 50,
      finalVoyageDeclared: false,
      retirementChoiceRequired: true,
      retirementRequired: false,
    });
    expect(() => lineage.advanceSuccessfulReturn()).toThrow(/retire or declare/);
  });

  it("declares one final voyage idempotently, reaches 55, and preserves it through retirement", () => {
    const lineage = new NavigatorLineageSystem();
    for (let returnIndex = 0; returnIndex < 4; returnIndex++) lineage.advanceSuccessfulReturn();

    expect(lineage.declareFinalVoyage()).toMatchObject({ status: "declared" });
    expect(lineage.declareFinalVoyage()).toMatchObject({ status: "already-declared" });
    expect(lineage.advanceSuccessfulReturn()).toMatchObject({
      ageYears: 55,
      retirementRequired: true,
    });
    const begun = lineage.beginSuccession("retirement", 1);
    expect(lineage.currentNavigator).toMatchObject({
      state: "retired",
      ageYears: 55,
      finalVoyageDeclared: true,
    });
    lineage.completeSuccession(begun.transition.key);
    expect(lineage.activeNavigator).toMatchObject({ ageYears: 30, finalVoyageDeclared: false });
  });

  it("preserves a declared final voyage on a wreck and rejects illegal age-state combinations", () => {
    const lineage = new NavigatorLineageSystem();
    for (let returnIndex = 0; returnIndex < 4; returnIndex++) lineage.advanceSuccessfulReturn();
    lineage.declareFinalVoyage();
    lineage.beginSuccession("wreck", 7);
    expect(lineage.currentNavigator).toMatchObject({
      state: "lost",
      ageYears: 50,
      finalVoyageDeclared: true,
    });

    const invalid = jsonClone(new NavigatorLineageSystem(1).snapshot());
    (invalid.navigators[0] as { ageYears: number }).ageYears = 55;
    expect(() => parseNavigatorLineageSnapshot(invalid)).toThrow(/declared final voyage/);
  });

  it("serializes a wreck hold without prematurely creating the next navigator", () => {
    const lineage = new NavigatorLineageSystem(4);
    lineage.beginSuccession("wreck", 12);
    const snapshot = lineage.snapshot();

    expect(snapshot.navigators).toEqual([{
      id: "navigator:v1:g4",
      generation: 4,
      state: "lost",
      successionReason: "wreck",
      endedBySuccessionKey: "navigator-succession:v1:wreck:12",
      createdBySuccessionKey: null,
      ageYears: 30,
      finalVoyageDeclared: false,
    }]);
    expect(snapshot.pendingSuccession).toEqual({
      key: "navigator-succession:v1:wreck:12",
      reason: "wreck",
      resolutionId: 12,
      fromNavigatorId: "navigator:v1:g4",
      fromGeneration: 4,
      nextGeneration: 5,
    });
  });

  it("begins and completes a wreck succession exactly once across repeated resolution", () => {
    const lineage = new NavigatorLineageSystem();
    const begun = lineage.beginSuccession("wreck", 1);

    expect(begun.status).toBe("begun");
    expect(lineage.activeNavigator).toBeUndefined();
    expect(lineage.currentNavigator).toMatchObject({ state: "lost", successionReason: "wreck" });
    expect(lineage.beginSuccession("wreck", 1).status).toBe("already-pending");
    expect(lineage.navigators).toHaveLength(1);

    const completed = lineage.completeSuccession(begun.transition.key);
    expect(completed.status).toBe("completed");
    expect(completed.navigator).toEqual({
      id: "navigator:v1:g2",
      generation: 2,
      state: "active",
      createdBySuccessionKey: begun.transition.key,
      ageYears: 30,
      finalVoyageDeclared: false,
    });
    expect(lineage.completeSuccession(begun.transition.key).status).toBe("already-completed");
    expect(lineage.beginSuccession("wreck", 1).status).toBe("already-completed");
    expect(lineage.navigators).toHaveLength(2);
    expect(lineage.generation).toBe(2);
  });

  it("distinguishes safe retirement while retaining every historical navigator", () => {
    const lineage = new NavigatorLineageSystem(8);
    for (let returnIndex = 0; returnIndex < 4; returnIndex++) lineage.advanceSuccessfulReturn();
    const retirement = lineage.beginSuccession("retirement", 8);

    expect(lineage.currentNavigator).toMatchObject({
      id: "navigator:v1:g8",
      state: "retired",
      successionReason: "retirement",
    });
    lineage.completeSuccession(retirement.transition.key);
    const wreck = lineage.beginSuccession("wreck", 21);
    expect(lineage.completeSuccession(retirement.transition.key)).toMatchObject({
      status: "already-completed",
      navigator: { id: "navigator:v1:g9", state: "lost" },
    });
    lineage.completeSuccession(wreck.transition.key);

    expect(lineage.navigators.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "navigator:v1:g8", state: "retired" },
      { id: "navigator:v1:g9", state: "lost" },
      { id: "navigator:v1:g10", state: "active" },
    ]);
  });

  it("replays a pending or completed transition after reload without skipping or duplicating", () => {
    const beforeReload = new NavigatorLineageSystem();
    const begun = beforeReload.beginSuccession("wreck", 3);
    const duringHold = NavigatorLineageSystem.fromSnapshot(jsonClone(beforeReload.snapshot()));

    expect(duringHold.beginSuccession("wreck", 3).status).toBe("already-pending");
    expect(duringHold.completeSuccession(begun.transition.key).status).toBe("completed");

    const afterCompletion = NavigatorLineageSystem.fromSnapshot(jsonClone(duringHold.snapshot()));
    expect(afterCompletion.completeSuccession(begun.transition.key).status).toBe("already-completed");
    expect(afterCompletion.beginSuccession("wreck", 3).status).toBe("already-completed");
    expect(afterCompletion.navigators.map(({ generation }) => generation)).toEqual([1, 2]);
  });

  it("rejects conflicting transitions rather than resolving the wrong succession", () => {
    const lineage = new NavigatorLineageSystem();
    const pending = lineage.beginSuccession("wreck", 10);

    expect(() => lineage.beginSuccession("wreck", 11)).toThrow(/while .* is pending/);
    expect(() => lineage.beginSuccession("retirement", 1)).toThrow(/while .* is pending/);
    expect(() => lineage.completeSuccession(createNavigatorSuccessionKey("wreck", 11))).toThrow(
      /while .* is pending/,
    );
    expect(lineage.pendingSuccession).toBe(pending.transition);
    expect(lineage.navigators).toHaveLength(1);
  });

  it("validates identity, lifecycle, linear history and pending-transition invariants on restore", () => {
    const lineage = new NavigatorLineageSystem();
    const first = lineage.beginSuccession("wreck", 1);
    lineage.completeSuccession(first.transition.key);
    const valid = jsonClone(lineage.snapshot());

    const corruptions: Array<(snapshot: NavigatorLineageSnapshotV2) => void> = [
      (snapshot) => { (snapshot.navigators[1] as { id: string }).id = "navigator:v1:g7"; },
      (snapshot) => { (snapshot.navigators[1] as { generation: number }).generation = 4; },
      (snapshot) => { (snapshot.navigators[0] as { state: string }).state = "active"; },
      (snapshot) => {
        (snapshot.navigators[1] as { createdBySuccessionKey: string }).createdBySuccessionKey =
          "navigator-succession:v1:wreck:2";
      },
      (snapshot) => { (snapshot as { pendingSuccession: object }).pendingSuccession = {
        key: "navigator-succession:v1:wreck:2",
        reason: "wreck",
        resolutionId: 2,
        fromNavigatorId: "navigator:v1:g2",
        fromGeneration: 2,
        nextGeneration: 3,
      }; },
    ];

    for (const corrupt of corruptions) {
      const candidate = jsonClone(valid);
      corrupt(candidate);
      expect(() => parseNavigatorLineageSnapshot(candidate)).toThrow(NavigatorLineageValidationError);
    }
  });

  it("defensively freezes restored records and snapshots", () => {
    const source = jsonClone(new NavigatorLineageSystem(1).snapshot());
    const lineage = NavigatorLineageSystem.fromSnapshot(source);
    (source.navigators[0] as { generation: number }).generation = 99;

    expect(lineage.generation).toBe(1);
    expect(Object.isFrozen(lineage.snapshot())).toBe(true);
    expect(Object.isFrozen(lineage.navigators)).toBe(true);
    expect(Object.isFrozen(lineage.currentNavigator)).toBe(true);
  });
});
