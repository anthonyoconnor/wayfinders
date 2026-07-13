import { describe, expect, it } from "vitest";
import {
  NAVIGATOR_LINEAGE_CONTRACT_VERSION,
  NAVIGATOR_VOYAGE_LIMIT,
  NavigatorLineageSystem,
  NavigatorLineageValidationError,
  createNavigatorId,
  createNavigatorSuccessionKey,
  isCurrentNavigatorId,
  isCurrentNavigatorSuccessionKey,
  parseNavigatorId,
  parseNavigatorLineageSnapshot,
  parseNavigatorSuccessionKey,
  type NavigatorLineageSnapshotV3,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("NavigatorLineageSystem", () => {
  it("creates canonical stable navigator IDs and versioned succession keys", () => {
    expect(createNavigatorId(1)).toBe("navigator:v1:g1");
    expect(createNavigatorId(42)).toBe("navigator:v1:g42");
    expect(parseNavigatorId("navigator:v1:g42")).toEqual({ version: 1, generation: 42 });
    expect(isCurrentNavigatorId("navigator:v1:g42")).toBe(true);
    expect(isCurrentNavigatorId("navigator:v2:g42")).toBe(false);
    expect(parseNavigatorId("navigator:v1:g042")).toBeUndefined();
    expect(() => createNavigatorId(0)).toThrow(/positive safe integer/);

    const wreckKey = createNavigatorSuccessionKey("wreck", 7);
    const tenureKey = createNavigatorSuccessionKey("tenure", 3);
    expect(wreckKey).toBe("navigator-succession:v2:wreck:7");
    expect(tenureKey).toBe("navigator-succession:v2:tenure:3");
    expect(parseNavigatorSuccessionKey(wreckKey)).toEqual({
      version: 2,
      reason: "wreck",
      resolutionId: 7,
    });
    expect(isCurrentNavigatorSuccessionKey(wreckKey)).toBe(true);
    expect(isCurrentNavigatorSuccessionKey("navigator-succession:v1:wreck:7")).toBe(false);
    expect(parseNavigatorSuccessionKey("navigator-succession:v2:wreck:07")).toBeUndefined();
  });

  it("starts generation one with four voyages available", () => {
    const snapshot = new NavigatorLineageSystem().snapshot();

    expect(NAVIGATOR_VOYAGE_LIMIT).toBe(4);
    expect(snapshot).toEqual({
      contractVersion: NAVIGATOR_LINEAGE_CONTRACT_VERSION,
      navigators: [{
        id: "navigator:v1:g1",
        generation: 1,
        state: "active",
        createdBySuccessionKey: null,
        completedVoyages: 0,
      }],
      pendingSuccession: null,
    });
    expect(NavigatorLineageSystem.fromSnapshot(jsonClone(snapshot)).currentNavigator).toEqual(
      snapshot.navigators[0],
    );
  });

  it("keeps one navigator for returns one through three and automatically succeeds on four", () => {
    const lineage = new NavigatorLineageSystem();

    for (let completedVoyages = 1; completedVoyages < NAVIGATOR_VOYAGE_LIMIT; completedVoyages++) {
      expect(lineage.completeSuccessfulVoyage()).toMatchObject({
        status: "recorded",
        completedVoyages,
        remainingVoyages: NAVIGATOR_VOYAGE_LIMIT - completedVoyages,
        tenureCompleted: false,
        navigator: { generation: 1, state: "active", completedVoyages },
      });
      expect(lineage.navigators).toHaveLength(1);
    }

    const fourth = lineage.completeSuccessfulVoyage();
    expect(fourth).toMatchObject({
      status: "tenure-completed",
      completedVoyages: 4,
      remainingVoyages: 0,
      tenureCompleted: true,
      navigator: { generation: 1, state: "completed", completedVoyages: 4 },
      successor: { generation: 2, state: "active", completedVoyages: 0 },
      transition: { reason: "tenure", resolutionId: 1 },
    });
    expect(lineage.pendingSuccession).toBeNull();
    expect(lineage.navigators.map(({ generation, state, completedVoyages }) => ({
      generation,
      state,
      completedVoyages,
    }))).toEqual([
      { generation: 1, state: "completed", completedVoyages: 4 },
      { generation: 2, state: "active", completedVoyages: 0 },
    ]);
    expect(lineage.totalCompletedVoyages).toBe(4);
  });

  it("assigns the next return to the successor without allowing a fifth voyage", () => {
    const lineage = new NavigatorLineageSystem();
    for (let voyage = 0; voyage < NAVIGATOR_VOYAGE_LIMIT; voyage++) {
      lineage.completeSuccessfulVoyage();
    }

    expect(lineage.completeSuccessfulVoyage()).toMatchObject({
      status: "recorded",
      completedVoyages: 1,
      navigator: { generation: 2, completedVoyages: 1 },
    });
    expect(lineage.navigators[0]).toMatchObject({
      generation: 1,
      state: "completed",
      completedVoyages: 4,
    });
    expect(lineage.totalCompletedVoyages).toBe(5);
  });

  it.each([0, 1, 2, 3])(
    "ends a navigator fatally after %i completed voyages and creates one successor",
    (completedVoyages) => {
      const lineage = new NavigatorLineageSystem();
      for (let voyage = 0; voyage < completedVoyages; voyage++) lineage.completeSuccessfulVoyage();

      const begun = lineage.beginSuccession("wreck", 10 + completedVoyages);
      expect(begun.status).toBe("begun");
      expect(lineage.activeNavigator).toBeUndefined();
      expect(lineage.currentNavigator).toMatchObject({
        generation: 1,
        state: "lost",
        successionReason: "wreck",
        completedVoyages,
      });
      expect(lineage.lostNavigatorCount).toBe(1);
      expect(lineage.beginSuccession("wreck", 10 + completedVoyages).status).toBe("already-pending");

      const completed = lineage.completeSuccession(begun.transition.key);
      expect(completed).toMatchObject({
        status: "completed",
        navigator: { generation: 2, state: "active", completedVoyages: 0 },
      });
      expect(lineage.completeSuccession(begun.transition.key).status).toBe("already-completed");
      expect(lineage.beginSuccession("wreck", 10 + completedVoyages).status).toBe("already-completed");
      expect(lineage.navigators).toHaveLength(2);
    },
  );

  it("replays a pending wreck succession after reload without skipping or duplicating", () => {
    const beforeReload = new NavigatorLineageSystem();
    beforeReload.completeSuccessfulVoyage();
    const begun = beforeReload.beginSuccession("wreck", 3);
    const duringHold = NavigatorLineageSystem.fromSnapshot(jsonClone(beforeReload.snapshot()));

    expect(duringHold.beginSuccession("wreck", 3).status).toBe("already-pending");
    expect(duringHold.completeSuccession(begun.transition.key).status).toBe("completed");

    const afterCompletion = NavigatorLineageSystem.fromSnapshot(jsonClone(duringHold.snapshot()));
    expect(afterCompletion.completeSuccession(begun.transition.key).status).toBe("already-completed");
    expect(afterCompletion.beginSuccession("wreck", 3).status).toBe("already-completed");
    expect(afterCompletion.navigators.map(({ generation }) => generation)).toEqual([1, 2]);
    expect(afterCompletion.totalCompletedVoyages).toBe(1);
  });

  it("rejects conflicting and illegal transitions", () => {
    const lineage = new NavigatorLineageSystem();
    expect(() => lineage.beginSuccession("tenure", 1)).toThrow(/not completed/);
    const pending = lineage.beginSuccession("wreck", 10);

    expect(() => lineage.beginSuccession("wreck", 11)).toThrow(/while .* is pending/);
    expect(() => lineage.beginSuccession("tenure", 1)).toThrow(/while .* is pending/);
    expect(() => lineage.completeSuccession(createNavigatorSuccessionKey("wreck", 11))).toThrow(
      /while .* is pending/,
    );
    expect(lineage.pendingSuccession).toBe(pending.transition);
    expect(lineage.navigators).toHaveLength(1);
  });

  it("validates contract, identity, voyage bounds, linear history, and pending invariants", () => {
    const lineage = new NavigatorLineageSystem();
    const first = lineage.beginSuccession("wreck", 1);
    lineage.completeSuccession(first.transition.key);
    const valid = jsonClone(lineage.snapshot());

    const corruptions: Array<(snapshot: NavigatorLineageSnapshotV3) => void> = [
      (snapshot) => { (snapshot as { contractVersion: number }).contractVersion = 2; },
      (snapshot) => { (snapshot.navigators[1] as { id: string }).id = "navigator:v1:g7"; },
      (snapshot) => { (snapshot.navigators[1] as { generation: number }).generation = 4; },
      (snapshot) => { (snapshot.navigators[0] as { state: string }).state = "active"; },
      (snapshot) => { (snapshot.navigators[1] as { completedVoyages: number }).completedVoyages = 4; },
      (snapshot) => {
        (snapshot.navigators[1] as { createdBySuccessionKey: string }).createdBySuccessionKey =
          "navigator-succession:v2:wreck:2";
      },
      (snapshot) => { (snapshot as { pendingSuccession: object | null }).pendingSuccession = {
        key: "navigator-succession:v2:wreck:2",
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

  it("rejects lifecycle/count mismatches and a tenure key for the wrong generation", () => {
    const lineage = new NavigatorLineageSystem();
    for (let voyage = 0; voyage < 4; voyage++) lineage.completeSuccessfulVoyage();
    const completed = jsonClone(lineage.snapshot());

    (completed.navigators[0] as { completedVoyages: number }).completedVoyages = 3;
    expect(() => parseNavigatorLineageSnapshot(completed)).toThrow(/completed tenure/);

    const wrongKey = jsonClone(lineage.snapshot());
    (wrongKey.navigators[0] as { endedBySuccessionKey: string }).endedBySuccessionKey =
      "navigator-succession:v2:tenure:2";
    (wrongKey.navigators[1] as { createdBySuccessionKey: string }).createdBySuccessionKey =
      "navigator-succession:v2:tenure:2";
    expect(() => parseNavigatorLineageSnapshot(wrongKey)).toThrow(/must match the navigator generation/);
  });

  it("defensively freezes restored records and snapshots", () => {
    const source = jsonClone(new NavigatorLineageSystem().snapshot());
    const lineage = NavigatorLineageSystem.fromSnapshot(source);
    (source.navigators[0] as { generation: number }).generation = 99;

    expect(lineage.generation).toBe(1);
    expect(Object.isFrozen(lineage.snapshot())).toBe(true);
    expect(Object.isFrozen(lineage.navigators)).toBe(true);
    expect(Object.isFrozen(lineage.currentNavigator)).toBe(true);
  });
});
