import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildGreatHallPreviewModel } from "../../src/wayfinders/assets/greatHall/GreatHallPreviewModel";

describe("GR-5.1 Great Hall twenty-generation baseline", () => {
  it("builds the bounded preview model within the accepted p95 budget", () => {
    const samples: number[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const started = performance.now();
      buildGreatHallPreviewModel({
        navigatorCount: 20,
        selectedGeneration: index % 20 + 1,
        mode: index % 3 === 0 ? "home" : index % 3 === 1 ? "handover" : "completion",
      });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.info(
      `[great-hall-preview] phase=model-build generations=20 samples=${samples.length} p95=${p95.toFixed(3)}ms budget=5ms`,
    );
    expect(p95, `20-generation preview model p95 ${p95.toFixed(3)} ms over ${samples.length} samples`)
      .toBeLessThan(5);
  });
});
