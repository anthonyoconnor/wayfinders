import { describe, expect, it } from "vitest";
import {
  NAVIGATOR_LINEAGE_CONTRACT_VERSION,
  NavigatorLineageSystem,
  NavigatorLineageValidationError,
  createNavigatorId,
  createNavigatorSuccessionKey,
  isCurrentNavigatorId,
  isCurrentNavigatorSuccessionKey,
  migrateBaselineNavigatorLineage,
  parseNavigatorId,
  parseNavigatorLineageSnapshot,
  parseNavigatorSuccessionKey,
  type NavigatorLineageSnapshotV1,
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

  it("migrates a baseline generation into one valid active navigator", () => {
    const migrated = migrateBaselineNavigatorLineage(4);

    expect(migrated).toEqual({
      contractVersion: NAVIGATOR_LINEAGE_CONTRACT_VERSION,
      navigators: [{
        id: "navigator:v1:g4",
        generation: 4,
        state: "active",
        createdBySuccessionKey: null,
      }],
      pendingSuccession: null,
    });
    expect(NavigatorLineageSystem.fromSnapshot(jsonClone(migrated)).currentNavigator).toEqual(
      migrated.navigators[0],
    );
  });

  it("migrates a baseline wreck hold without prematurely creating the next navigator", () => {
    const migrated = migrateBaselineNavigatorLineage(4, 12);

    expect(migrated.navigators).toEqual([{
      id: "navigator:v1:g4",
      generation: 4,
      state: "lost",
      successionReason: "wreck",
      endedBySuccessionKey: "navigator-succession:v1:wreck:12",
      createdBySuccessionKey: null,
    }]);
    expect(migrated.pendingSuccession).toEqual({
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
    });
    expect(lineage.completeSuccession(begun.transition.key).status).toBe("already-completed");
    expect(lineage.beginSuccession("wreck", 1).status).toBe("already-completed");
    expect(lineage.navigators).toHaveLength(2);
    expect(lineage.generation).toBe(2);
  });

  it("distinguishes safe retirement while retaining every historical navigator", () => {
    const lineage = new NavigatorLineageSystem(8);
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

    const corruptions: Array<(snapshot: NavigatorLineageSnapshotV1) => void> = [
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
    const source = jsonClone(migrateBaselineNavigatorLineage(1));
    const lineage = NavigatorLineageSystem.fromSnapshot(source);
    (source.navigators[0] as { generation: number }).generation = 99;

    expect(lineage.generation).toBe(1);
    expect(Object.isFrozen(lineage.snapshot())).toBe(true);
    expect(Object.isFrozen(lineage.navigators)).toBe(true);
    expect(Object.isFrozen(lineage.currentNavigator)).toBe(true);
  });
});
