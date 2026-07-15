import { describe, expect, it } from "vitest";
import {
  measureSimulationPhase,
  type SimulationPhase,
  type SimulationTraceSink,
} from "../src/wayfinders/core/SimulationTrace";

class RecordingTrace implements SimulationTraceSink {
  readonly phases: Array<{ phase: SimulationPhase; durationMs: number }> = [];

  record(phase: SimulationPhase, durationMs: number): void {
    this.phases.push({ phase, durationMs });
  }
}

describe("simulation tracing", () => {
  it("returns the operation result without a sink", () => {
    expect(measureSimulationPhase(undefined, "movement", () => 42)).toBe(42);
  });

  it("records successful and failed operations", () => {
    const trace = new RecordingTrace();
    expect(measureSimulationPhase(trace, "forward-guidance", () => "done")).toBe("done");
    expect(() => measureSimulationPhase(trace, "return-query", () => {
      throw new Error("expected");
    })).toThrow("expected");

    expect(trace.phases.map(({ phase }) => phase)).toEqual([
      "forward-guidance",
      "return-query",
    ]);
    expect(trace.phases.every(({ durationMs }) => durationMs >= 0)).toBe(true);
  });
});
