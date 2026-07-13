import { describe, expect, it } from "vitest";
import { FrameTimingMonitor } from "../src/wayfinders/core/FrameTimingMonitor";

describe("FrameTimingMonitor", () => {
  it("retains a bounded recent window while keeping cumulative hitch counters", () => {
    const monitor = new FrameTimingMonitor(4, 50);
    monitor.record(10);
    monitor.record(20);
    monitor.record(60, 5);
    monitor.record(30);
    monitor.record(40, 2);

    expect(monitor.snapshot()).toEqual({
      sampleCount: 4,
      p50Ms: 30,
      p95Ms: 40,
      p99Ms: 40,
      maxMs: 60,
      longFrameCount: 1,
      totalDroppedSimulationMs: 7,
    });
  });

  it("ignores background and invalid samples", () => {
    const monitor = new FrameTimingMonitor();
    monitor.record(80, 10, false);
    monitor.record(Number.NaN);

    expect(monitor.snapshot().sampleCount).toBe(0);
    expect(monitor.snapshot().totalDroppedSimulationMs).toBe(0);
  });
});
