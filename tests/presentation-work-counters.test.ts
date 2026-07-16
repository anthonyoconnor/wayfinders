import { describe, expect, it } from "vitest";
import { PresentationWorkMonitor } from "../src/wayfinders/core/PresentationWorkCounters";

describe("PresentationWorkMonitor", () => {
  it("counts revision-gated work, removals, and viewport queries", () => {
    const monitor = new PresentationWorkMonitor();
    monitor.beginFrame();
    monitor.recordRevisionSync(0, 12);
    monitor.recordRevisionSync(0, 3);
    monitor.recordRevisionSync(3, 2);
    monitor.recordViewportQuery();
    monitor.recordEntityQueries(5);
    monitor.recordDiagnostics(0.75);

    expect(monitor.snapshot()).toEqual({
      queriedEntities: 39,
      changedEntities: 18,
      activeMarkers: 14,
      diagnosticsMs: 0.75,
    });
  });

  it("keeps retained marker count across frames while resetting per-frame work", () => {
    const monitor = new PresentationWorkMonitor();
    monitor.recordRevisionSync(0, 7);
    monitor.beginFrame();
    monitor.recordViewportQuery();

    expect(monitor.snapshot()).toEqual({
      queriedEntities: 7,
      changedEntities: 0,
      activeMarkers: 7,
      diagnosticsMs: 0,
    });
  });

  it("rejects invalid counter input", () => {
    const monitor = new PresentationWorkMonitor();
    expect(() => monitor.recordRevisionSync(-1, 0)).toThrow(/non-negative/);
    expect(() => monitor.recordRevisionSync(0, 1.5)).toThrow(/integer/);
    expect(() => monitor.recordEntityQueries(-1)).toThrow(/non-negative/);
    expect(() => monitor.recordDiagnostics(Number.NaN)).toThrow(/finite/);
  });
});
