import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { GameSimulation } from "../../src/wayfinders/core/GameSimulation.ts";
import { GridGraph } from "../../src/wayfinders/navigation/GridGraph.ts";
import {
  createWorldProfileConfig,
  type WorldProfileName,
} from "../fixtures/worldProfiles.ts";

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function findEastboundRun(simulation: GameSimulation, edgeCount: number) {
  const graph = new GridGraph(simulation.world, simulation.config);
  for (let y = 1; y + 1 < simulation.world.height; y++) {
    for (let x = 1; x + edgeCount < simulation.world.width; x++) {
      let passable = true;
      for (let offset = 0; offset < edgeCount; offset++) {
        if (!graph.canTraverseCardinalEdge(
          simulation.world.index(x + offset, y),
          simulation.world.index(x + offset + 1, y),
        )) {
          passable = false;
          break;
        }
      }
      if (passable) return { x, y };
    }
  }
  throw new Error("No eastbound performance fixture was available");
}

describe("AM-1 navigation latency budget", () => {
  for (const profile of ["P0", "P1"] as const satisfies readonly WorldProfileName[]) {
    it(`${profile} keeps synchronous tile-entry p95 below 4 ms`, () => {
      const simulation = new GameSimulation(createWorldProfileConfig(profile), undefined, {
        deferredForwardGuidance: true,
      });
      const warmups = 6;
      const samples = 24;
      const start = findEastboundRun(simulation, warmups + samples + 1);
      expect(simulation.teleport(start)).toBe(true);
      simulation.advanceForwardGuidance();

      for (let index = 0; index < warmups; index++) {
        expect(simulation.update({ turn: 0, throttle: 1 }, 0.4).tileChanged).toBe(true);
        expect(simulation.advanceForwardGuidance()).toBe(true);
      }

      const durations: number[] = [];
      for (let index = 0; index < samples; index++) {
        const startedAt = performance.now();
        const movement = simulation.update({ turn: 0, throttle: 1 }, 0.4);
        durations.push(performance.now() - startedAt);
        expect(movement.tileChanged).toBe(true);
        expect(simulation.advanceForwardGuidance()).toBe(true);
      }

      expect(percentile(durations, 0.95)).toBeLessThan(4);
    }, 30_000);
  }
});
