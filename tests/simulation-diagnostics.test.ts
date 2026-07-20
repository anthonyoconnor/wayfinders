import { describe, expect, it, vi } from "vitest";
import {
  SimulationDiagnosticsAdapter,
  type SimulationDiagnosticsSource,
} from "../src/wayfinders/core/SimulationDiagnosticsReadModel";
import { ReturnRiskLevel } from "../src/wayfinders/exploration/ReturnPathSystem";
import { KnowledgeState } from "../src/wayfinders/world/TileData";

const source = (): SimulationDiagnosticsSource => ({
  overlaysRevision: 4,
  forwardGuidancePresentationAvailable: true,
  world: {
    knowledgeVersion: 2,
    visibilityVersion: 3,
    currentVisibleCount: 9,
    getKnowledgeCount: vi.fn((state: KnowledgeState) => ({
      [KnowledgeState.Unknown]: 70,
      [KnowledgeState.Personal]: 11,
      [KnowledgeState.Supported]: 19,
    })[state]),
  },
  forwardRange: {
    reachableCount: 8,
    frontierCount: 5,
    presentationHeading: 42,
    coneHalfAngleDegrees: 60,
  },
  returnPaths: {
    riskCounts: { comfortable: 4, warning: 3, critical: 2, impossible: 1 },
    pathIndices: [1, 2, 3],
    corridorIndices: [1, 2, 3, 4, 5],
    riskLevel: ReturnRiskLevel.Warning,
    returnCost: 2.5,
    returnMargin: 1.25,
  },
});

describe("SimulationDiagnosticsAdapter", () => {
  it("projects only the knowledge and risk values used by diagnostics", () => {
    const adapter = new SimulationDiagnosticsAdapter();
    const model = adapter.read(source());

    expect(model.knowledge).toEqual({ supported: 19, personal: 11, unknown: 70, visibleNow: 9 });
    expect(model.risk).toMatchObject({
      forwardAvailable: true,
      forwardReachable: 8,
      forwardFrontier: 5,
      comfortable: 4,
      warning: 3,
      returnPathTiles: 3,
      returnCorridorTiles: 5,
      returnCost: 2.5,
    });
  });

  it("reuses the read model until a relevant authority revision changes", () => {
    const adapter = new SimulationDiagnosticsAdapter();
    const value = source();
    const first = adapter.read(value);
    const second = adapter.read(value);

    expect(second).toBe(first);
    expect(value.world.getKnowledgeCount).toHaveBeenCalledTimes(3);

    const changed = adapter.read({ ...value, overlaysRevision: value.overlaysRevision + 1 });
    expect(changed).not.toBe(first);
    expect(value.world.getKnowledgeCount).toHaveBeenCalledTimes(6);
  });

  it("normalizes unreachable return values without cloning authority collections", () => {
    const adapter = new SimulationDiagnosticsAdapter();
    const value = source();
    const model = adapter.read({
      ...value,
      returnPaths: { ...value.returnPaths, returnCost: Number.POSITIVE_INFINITY, returnMargin: Number.NEGATIVE_INFINITY },
    });

    expect(model.risk.returnCost).toBeNull();
    expect(model.risk.returnMargin).toBeNull();
  });

  it("marks unavailable forward guidance and suppresses its stale scalar projection", () => {
    const adapter = new SimulationDiagnosticsAdapter();
    const model = adapter.read({
      ...source(),
      forwardGuidancePresentationAvailable: false,
    });

    expect(model.risk).toMatchObject({
      forwardAvailable: false,
      forwardReachable: 0,
      forwardFrontier: 0,
      forwardHeading: 0,
      forwardConeHalfAngleDegrees: 0,
    });
  });
});
