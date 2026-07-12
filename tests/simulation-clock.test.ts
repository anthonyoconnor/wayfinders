import { describe, expect, it } from "vitest";
import { SimulationClock } from "../src/tidebound/core/SimulationClock";
import { makeConfig } from "./helpers";

describe("SimulationClock", () => {
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
});
