import { describe, expect, it, vi } from "vitest";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation";
import { SimulationClock } from "../src/wayfinders/core/SimulationClock";
import { makeConfig } from "./helpers";

describe("SimulationClock", () => {
  it("reports real time discarded by the frame-delta safety cap", () => {
    const clock = new SimulationClock(makeConfig({
      simulation: { fixedStepMs: 20, maxFrameDeltaMs: 100 },
    }));
    const step = vi.fn();

    expect(clock.advance(250, step)).toBe(5);
    expect(clock.lastDroppedMs).toBe(150);
    expect(clock.totalDroppedMs).toBe(150);

    clock.reset();
    expect(clock.lastDroppedMs).toBe(0);
    expect(clock.totalDroppedMs).toBe(150);
  });

  it("drops remaining fixed substeps when a lifecycle transition requests a stop", () => {
    const clock = new SimulationClock(makeConfig({
      simulation: { fixedStepMs: 20, maxFrameDeltaMs: 100 },
    }));
    let calls = 0;

    const steps = clock.advance(100, () => {
      calls++;
      return false;
    });

    expect(steps).toBe(1);
    expect(calls).toBe(1);
    expect(clock.interpolationAlpha).toBe(0);
  });

  it("drops buffered substeps when the wreck hold completes", () => {
    const config = makeConfig({
      simulation: { fixedStepMs: 20, maxFrameDeltaMs: 100, wreckPresentationSeconds: 0.02 },
    });
    const simulation = new GameSimulation(config);
    expect(simulation.teleport({ x: 4, y: 4 })).toBe(true);
    expect(simulation.forceWreck()).toBe(true);
    const clock = new SimulationClock(config);
    let calls = 0;

    clock.advance(100, (deltaSeconds) => {
      const lifecycleRevision = simulation.lifecycleResolutionRevision;
      simulation.update({ turn: 1, throttle: 1 }, deltaSeconds);
      calls++;
      return lifecycleRevision === simulation.lifecycleResolutionRevision;
    });

    expect(calls).toBe(1);
    expect(simulation.wreckPresentationActive).toBe(false);
    expect(simulation.generation).toBe(2);
    expect(simulation.atDock).toBe(true);
    expect(simulation.ship.speed).toBe(0);
    expect(clock.interpolationAlpha).toBe(0);
  });
});
