import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { GameSimulation } from "../../src/wayfinders/core/GameSimulation";
import { ForwardRangeSystem } from "../../src/wayfinders/exploration/ForwardRangeSystem";
import { createWorldProfileConfig } from "../fixtures/worldProfiles";

interface Distribution {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) => sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  ];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1)! };
}

function assertEquivalent(
  simulation: GameSimulation,
  reference: ReturnType<ForwardRangeSystem["calculate"]>,
): void {
  const actual = simulation.forwardRange;
  expect(actual.mask).toEqual(reference.mask);
  expect(actual.presentationMask).toEqual(reference.presentationMask);
  expect(actual.costs).toEqual(reference.costs);
  expect(actual.candidateIndices).toEqual(reference.candidateIndices);
  expect(actual.presentationCandidateIndices).toEqual(reference.presentationCandidateIndices);
  expect(actual).toMatchObject({
    budget: reference.budget,
    reachableCount: reference.reachableCount,
    frontierCount: reference.frontierCount,
    presentationHeading: reference.presentationHeading,
  });
}

describe("cooperative ForwardGuidance budget", () => {
  it("P2 keeps each main-thread slice below the 4 ms p95 gate", () => {
    const profile = "P2";
    const warmups = 20;
    const samples = 100;
    const simulation = new GameSimulation(createWorldProfileConfig(profile), undefined, {
      forwardGuidanceEnabled: true,
    });
    const oracle = new ForwardRangeSystem(simulation.world, simulation.config);
    const expected = oracle.calculate(simulation.ship);
    const sliceDurations: number[] = [];
    const requestCpuDurations: number[] = [];
    const slicesPerRequest: number[] = [];

    for (let request = 0; request < warmups + samples; request++) {
      simulation.refreshRiskOverlays();
      let requestCpu = 0;
      let slices = 0;
      for (; slices < 1_000; slices++) {
        const sliceStartedAt = performance.now();
        const applied = simulation.advanceForwardGuidance();
        const sliceDuration = performance.now() - sliceStartedAt;
        requestCpu += sliceDuration;
        if (request >= warmups) sliceDurations.push(sliceDuration);
        if (applied) break;
      }
      if (slices >= 1_000) throw new Error(`${profile} guidance failed to drain`);
      if (request >= warmups) {
        requestCpuDurations.push(requestCpu);
        slicesPerRequest.push(slices + 1);
      }
      if (request === warmups - 1 || request === warmups + samples - 1) {
        assertEquivalent(simulation, expected);
      }
    }

    const slices = distribution(sliceDurations);
    const requestCpu = distribution(requestCpuDurations);
    const frameSlices = distribution(slicesPerRequest);
    const evidence = {
      profile,
      samples,
      mainThreadSliceMs: slices,
      requestCpuMs: requestCpu,
      slicesPerRequest: frameSlices,
      thresholdMs: 4,
      telemetry: simulation.forwardGuidanceStatus.telemetry,
    };

    expect(
      slices.p95,
      `ForwardGuidance budget miss: ${JSON.stringify(evidence)}`,
    ).toBeLessThan(4);
    expect(
      frameSlices.p95,
      `ForwardGuidance starvation guard: ${JSON.stringify(evidence)}`,
    ).toBeLessThanOrEqual(24);
    expect(simulation.forwardGuidanceStatus.telemetry.staleResultsDiscarded).toBe(0);
  }, 120_000);
});
