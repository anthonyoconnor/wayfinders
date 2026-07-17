import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildGreatHallFixture } from "../../src/wayfinders/assets/greatHall/GreatHallFixture";

describe("GR-5.3 Great Hall twenty-generation fixture baseline", () => {
  it("validates and derives the shared presentation fixture within the accepted p95 budget", () => {
    const samples: number[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const started = performance.now();
      buildGreatHallFixture({
        navigatorCount: 20,
        selectedGeneration: index % 20 + 1,
        mode: index % 3 === 0 ? "home" : index % 3 === 1 ? "handover" : "completion",
      });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.info(
      `[great-hall-presentation] phase=fixture-build generations=20 samples=${samples.length} p95=${p95.toFixed(3)}ms budget=5ms`,
    );
    expect(p95, `20-generation presentation fixture p95 ${p95.toFixed(3)} ms over ${samples.length} samples`)
      .toBeLessThan(5);
  });
});
