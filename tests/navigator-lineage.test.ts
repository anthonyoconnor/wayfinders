import { describe, expect, it } from "vitest";
import { createFishingShoalId } from "../src/wayfinders/exploration/FishingShoalContracts.ts";
import { createSurveySiteId } from "../src/wayfinders/exploration/SurveySiteContracts.ts";
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
  type NavigatorLineageSnapshotV6,
  type NavigatorVoyageAchievementInputV3,
} from "../src/wayfinders/lineage/NavigatorLineageSystem.ts";

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyVoyage(expeditionId: number): NavigatorVoyageAchievementInputV3 {
  return {
    expeditionId,
    supportedTileCount: 0,
    closedUnknownTileCount: 0,
    islandLeadIds: [],
    islandDossierIds: [],
    surveySiteLeadIds: [],
    surveySiteReportIds: [],
    fishingLeadIds: [],
    fishingSurveyIds: [],
    wreckIds: [],
  };
}

function completeVoyages(
  lineage: NavigatorLineageSystem,
  count: number,
  firstExpeditionId = 1,
): number {
  let expeditionId = firstExpeditionId;
  for (let voyage = 0; voyage < count; voyage++) {
    lineage.completeSuccessfulVoyage(emptyVoyage(expeditionId));
    expeditionId++;
  }
  return expeditionId;
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
        successfulVoyages: [],
      }],
      pendingSuccession: null,
    });
    expect(NavigatorLineageSystem.fromSnapshot(jsonClone(snapshot)).currentNavigator).toEqual(
      snapshot.navigators[0],
    );
  });

  it("rejects a successful voyage outside the next expedition chronology", () => {
    const lineage = new NavigatorLineageSystem();

    expect(() => lineage.completeSuccessfulVoyage(emptyVoyage(2))).toThrow(
      /chronological expedition 1/,
    );
    expect(lineage.currentNavigator).toMatchObject({
      state: "active",
      completedVoyages: 0,
      successfulVoyages: [],
    });
  });

  it("reserves a chronological expedition for each fatal voyage", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(emptyVoyage(1));
    const wreck = lineage.beginSuccession("wreck", 1);
    lineage.completeSuccession(wreck.transition.key);

    expect(() => lineage.completeSuccessfulVoyage(emptyVoyage(2))).toThrow(
      /chronological expedition 3/,
    );
    expect(lineage.currentNavigator.completedVoyages).toBe(0);
    expect(lineage.completeSuccessfulVoyage(emptyVoyage(3))).toMatchObject({
      status: "recorded",
      voyage: { voyageNumber: 1, expeditionId: 3 },
      navigator: { generation: 2, completedVoyages: 1 },
    });
  });

  it("keeps one navigator for returns one through three and automatically succeeds on four", () => {
    const lineage = new NavigatorLineageSystem();

    for (let completedVoyages = 1; completedVoyages < NAVIGATOR_VOYAGE_LIMIT; completedVoyages++) {
      expect(lineage.completeSuccessfulVoyage(emptyVoyage(completedVoyages))).toMatchObject({
        status: "recorded",
        completedVoyages,
        remainingVoyages: NAVIGATOR_VOYAGE_LIMIT - completedVoyages,
        tenureCompleted: false,
        voyage: { voyageNumber: completedVoyages, expeditionId: completedVoyages },
        navigator: { generation: 1, state: "active", completedVoyages },
      });
      expect(lineage.navigators).toHaveLength(1);
    }

    const fourth = lineage.completeSuccessfulVoyage(emptyVoyage(4));
    expect(fourth).toMatchObject({
      status: "tenure-completed",
      completedVoyages: 4,
      remainingVoyages: 0,
      tenureCompleted: true,
      voyage: { voyageNumber: 4, expeditionId: 4 },
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
    const nextExpeditionId = completeVoyages(lineage, NAVIGATOR_VOYAGE_LIMIT);

    expect(lineage.completeSuccessfulVoyage(emptyVoyage(nextExpeditionId))).toMatchObject({
      status: "recorded",
      completedVoyages: 1,
      voyage: { voyageNumber: 1, expeditionId: 5 },
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
      completeVoyages(lineage, completedVoyages);

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
    beforeReload.completeSuccessfulVoyage(emptyVoyage(1));
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

  it("defensively copies and deeply freezes successful-voyage achievements", () => {
    const lineage = new NavigatorLineageSystem();
    const input = {
      expeditionId: 1,
      supportedTileCount: 7,
      closedUnknownTileCount: 2,
      islandLeadIds: [1, 3],
      islandDossierIds: [4, 6],
      surveySiteLeadIds: [
        createSurveySiteId("historic-wreck", 0),
        createSurveySiteId("tidal-cave", 0),
      ],
      surveySiteReportIds: [createSurveySiteId("coastal-ruin", 0)],
      fishingLeadIds: [createFishingShoalId(0)],
      fishingSurveyIds: [createFishingShoalId(1), createFishingShoalId(2)],
      wreckIds: [9],
    };

    const result = lineage.completeSuccessfulVoyage(input);
    expect(result.voyage).toEqual({
      ...input,
      voyageNumber: 1,
    });
    expect(Object.isFrozen(result.voyage)).toBe(true);
    expect(Object.isFrozen(result.voyage.islandLeadIds)).toBe(true);
    expect(Object.isFrozen(result.voyage.islandDossierIds)).toBe(true);
    expect(Object.isFrozen(result.voyage.surveySiteLeadIds)).toBe(true);
    expect(Object.isFrozen(result.voyage.surveySiteReportIds)).toBe(true);
    expect(Object.isFrozen(result.voyage.fishingLeadIds)).toBe(true);
    expect(Object.isFrozen(result.voyage.fishingSurveyIds)).toBe(true);
    expect(Object.isFrozen(result.voyage.wreckIds)).toBe(true);
    expect(Object.isFrozen(lineage.currentNavigator.successfulVoyages)).toBe(true);

    input.islandLeadIds.push(5);
    input.islandDossierIds.push(8);
    input.surveySiteLeadIds.push(createSurveySiteId("tidal-cave", 1));
    input.surveySiteReportIds.push(createSurveySiteId("coastal-ruin", 1));
    input.fishingLeadIds.push(createFishingShoalId(3));
    input.fishingSurveyIds.length = 0;
    input.wreckIds.push(10);
    expect(result.voyage).toMatchObject({
      islandLeadIds: [1, 3],
      islandDossierIds: [4, 6],
      surveySiteLeadIds: [
        createSurveySiteId("historic-wreck", 0),
        createSurveySiteId("tidal-cave", 0),
      ],
      surveySiteReportIds: [createSurveySiteId("coastal-ruin", 0)],
      fishingLeadIds: [createFishingShoalId(0)],
      fishingSurveyIds: [createFishingShoalId(1), createFishingShoalId(2)],
      wreckIds: [9],
    });

    const source = jsonClone(lineage.snapshot());
    const restored = NavigatorLineageSystem.fromSnapshot(source);
    const sourceVoyage = source.navigators[0].successfulVoyages[0] as unknown as {
      islandLeadIds: number[];
      islandDossierIds: number[];
      surveySiteLeadIds: string[];
      surveySiteReportIds: string[];
    };
    sourceVoyage.islandLeadIds.push(99);
    sourceVoyage.islandDossierIds.push(100);
    sourceVoyage.surveySiteLeadIds.push(createSurveySiteId("historic-wreck", 9));
    sourceVoyage.surveySiteReportIds.push(createSurveySiteId("tidal-cave", 9));
    expect(restored.currentNavigator.successfulVoyages[0].islandLeadIds).toEqual([1, 3]);
    expect(restored.currentNavigator.successfulVoyages[0].islandDossierIds).toEqual([4, 6]);
    expect(restored.currentNavigator.successfulVoyages[0].surveySiteLeadIds).toEqual([
      createSurveySiteId("historic-wreck", 0),
      createSurveySiteId("tidal-cave", 0),
    ]);
    expect(restored.currentNavigator.successfulVoyages[0].surveySiteReportIds).toEqual([
      createSurveySiteId("coastal-ruin", 0),
    ]);
    expect(Object.isFrozen(restored.currentNavigator.successfulVoyages[0])).toBe(true);
    expect(Object.isFrozen(restored.currentNavigator.successfulVoyages[0].islandLeadIds)).toBe(true);
    expect(Object.isFrozen(restored.currentNavigator.successfulVoyages[0].islandDossierIds)).toBe(true);
    expect(Object.isFrozen(restored.currentNavigator.successfulVoyages[0].surveySiteLeadIds)).toBe(true);
    expect(Object.isFrozen(restored.currentNavigator.successfulVoyages[0].surveySiteReportIds)).toBe(true);
  });

  it("credits each island transition once while allowing a later dossier to resolve its lead", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage({
      ...emptyVoyage(1),
      islandLeadIds: [7],
    });

    expect(() => lineage.completeSuccessfulVoyage({
      ...emptyVoyage(2),
      islandLeadIds: [7],
    })).toThrow(/must not repeat an island lead/);
    expect(lineage.currentNavigator.completedVoyages).toBe(1);

    expect(lineage.completeSuccessfulVoyage({
      ...emptyVoyage(2),
      islandDossierIds: [7],
    }).voyage).toMatchObject({
      islandLeadIds: [],
      islandDossierIds: [7],
    });

    expect(() => lineage.completeSuccessfulVoyage({
      ...emptyVoyage(3),
      islandDossierIds: [7],
    })).toThrow(/must not repeat an island dossier/);
    expect(() => lineage.completeSuccessfulVoyage({
      ...emptyVoyage(3),
      islandLeadIds: [7],
    })).toThrow(/cannot record an island lead after its dossier/);
    expect(lineage.currentNavigator.completedVoyages).toBe(2);
  });

  it("credits each survey-site transition once while allowing a later report to resolve its lead", () => {
    const lineage = new NavigatorLineageSystem();
    const siteId = createSurveySiteId("historic-wreck", 0);
    lineage.completeSuccessfulVoyage({
      ...emptyVoyage(1),
      surveySiteLeadIds: [siteId],
    });

    expect(() => lineage.completeSuccessfulVoyage({
      ...emptyVoyage(2),
      surveySiteLeadIds: [siteId],
    })).toThrow(/must not repeat a survey-site lead/);
    expect(lineage.currentNavigator.completedVoyages).toBe(1);

    expect(lineage.completeSuccessfulVoyage({
      ...emptyVoyage(2),
      surveySiteReportIds: [siteId],
    }).voyage).toMatchObject({
      surveySiteLeadIds: [],
      surveySiteReportIds: [siteId],
    });

    expect(() => lineage.completeSuccessfulVoyage({
      ...emptyVoyage(3),
      surveySiteReportIds: [siteId],
    })).toThrow(/must not repeat a survey-site report/);
    expect(() => lineage.completeSuccessfulVoyage({
      ...emptyVoyage(3),
      surveySiteLeadIds: [siteId],
    })).toThrow(/cannot record a survey-site lead after its report/);
    expect(lineage.currentNavigator.completedVoyages).toBe(2);
  });

  it("rejects malformed, non-canonical, or chronologically inconsistent voyage achievements", () => {
    const lineage = new NavigatorLineageSystem();
    lineage.completeSuccessfulVoyage(emptyVoyage(1));
    const wreck = lineage.beginSuccession("wreck", 21);
    lineage.completeSuccession(wreck.transition.key);
    lineage.completeSuccessfulVoyage(emptyVoyage(3));
    const valid = jsonClone(lineage.snapshot());
    const fishingId = createFishingShoalId(0);
    const surveySiteId = createSurveySiteId("historic-wreck", 0);
    const laterSurveySiteId = createSurveySiteId("tidal-cave", 0);

    type MutableVoyage = {
      expeditionId: number;
      voyageNumber: number;
      supportedTileCount: number;
      closedUnknownTileCount: number;
      islandLeadIds: number[];
      islandDossierIds: number[];
      surveySiteLeadIds: string[];
      surveySiteReportIds: string[];
      fishingLeadIds: string[];
      fishingSurveyIds: string[];
      wreckIds: number[];
    };
    const voyage = (
      snapshot: NavigatorLineageSnapshotV6,
      navigatorIndex: number,
    ): MutableVoyage => snapshot.navigators[navigatorIndex].successfulVoyages[0] as unknown as MutableVoyage;
    const successfulVoyages = (
      snapshot: NavigatorLineageSnapshotV6,
      navigatorIndex: number,
    ): MutableVoyage[] => snapshot.navigators[navigatorIndex].successfulVoyages as unknown as MutableVoyage[];

    const corruptions: Array<{
      corrupt: (snapshot: NavigatorLineageSnapshotV6) => void;
      message: RegExp;
    }> = [
      {
        corrupt: (snapshot) => { successfulVoyages(snapshot, 0).pop(); },
        message: /length must equal completedVoyages/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 0).voyageNumber = 2; },
        message: /must be voyage 1/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 1).expeditionId = 2; },
        message: /lineage chronology with expedition 3/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 0).islandLeadIds = [2, 1]; },
        message: /sorted with no duplicates/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 0).islandDossierIds = [0]; },
        message: /positive safe integer/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).islandLeadIds = [2];
          voyage(snapshot, 0).islandDossierIds = [2];
        },
        message: /cannot also be recorded as an island lead/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).islandLeadIds = [3];
          voyage(snapshot, 1).islandLeadIds = [3];
        },
        message: /must not repeat an island lead/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).islandDossierIds = [4];
          voyage(snapshot, 1).islandDossierIds = [4];
        },
        message: /must not repeat an island dossier/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).islandDossierIds = [5];
          voyage(snapshot, 1).islandLeadIds = [5];
        },
        message: /cannot record an island lead after its dossier/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).surveySiteLeadIds = [laterSurveySiteId, surveySiteId];
        },
        message: /sorted with no duplicates/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).surveySiteLeadIds = ["survey-site:v2:historic-wreck:0000"];
        },
        message: /current survey-site IDs/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).surveySiteLeadIds = [surveySiteId];
          voyage(snapshot, 0).surveySiteReportIds = [surveySiteId];
        },
        message: /cannot also be recorded as a survey-site lead/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).surveySiteLeadIds = [surveySiteId];
          voyage(snapshot, 1).surveySiteLeadIds = [surveySiteId];
        },
        message: /must not repeat a survey-site lead/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).surveySiteReportIds = [surveySiteId];
          voyage(snapshot, 1).surveySiteReportIds = [surveySiteId];
        },
        message: /must not repeat a survey-site report/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).surveySiteReportIds = [surveySiteId];
          voyage(snapshot, 1).surveySiteLeadIds = [surveySiteId];
        },
        message: /cannot record a survey-site lead after its report/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 0).fishingLeadIds = [fishingId, fishingId]; },
        message: /sorted with no duplicates/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 0).fishingLeadIds = ["fishing-shoal:v2:0000"]; },
        message: /current fishing-shoal IDs/,
      },
      {
        corrupt: (snapshot) => { voyage(snapshot, 0).supportedTileCount = -1; },
        message: /non-negative safe integer/,
      },
      {
        corrupt: (snapshot) => {
          voyage(snapshot, 0).fishingLeadIds = [fishingId];
          voyage(snapshot, 0).fishingSurveyIds = [fishingId];
        },
        message: /cannot also be recorded as a fishing lead/,
      },
    ];

    for (const { corrupt, message } of corruptions) {
      const candidate = jsonClone(valid);
      corrupt(candidate);
      expect(() => parseNavigatorLineageSnapshot(candidate)).toThrow(message);
    }
  });

  it("validates contract, identity, voyage bounds, linear history, and pending invariants", () => {
    const lineage = new NavigatorLineageSystem();
    const first = lineage.beginSuccession("wreck", 1);
    lineage.completeSuccession(first.transition.key);
    const valid = jsonClone(lineage.snapshot());

    const corruptions: Array<(snapshot: NavigatorLineageSnapshotV6) => void> = [
      (snapshot) => {
        (snapshot as { contractVersion: number }).contractVersion = NAVIGATOR_LINEAGE_CONTRACT_VERSION - 1;
      },
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
    completeVoyages(lineage, 4);
    const completed = jsonClone(lineage.snapshot());

    const completedNavigator = completed.navigators[0] as unknown as {
      completedVoyages: number;
      successfulVoyages: unknown[];
    };
    completedNavigator.completedVoyages = 3;
    completedNavigator.successfulVoyages.pop();
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
