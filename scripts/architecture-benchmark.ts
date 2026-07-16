import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, hostname, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { GameSimulation } from "../src/wayfinders/core/GameSimulation.ts";
import { ForwardRangeSystem } from "../src/wayfinders/exploration/ForwardRangeSystem.ts";
import type { ForwardGuidanceTelemetry } from "../src/wayfinders/exploration/ForwardGuidance.ts";
import type {
  SimulationPhase,
  SimulationTraceSink,
} from "../src/wayfinders/core/SimulationTrace.ts";
import { GridGraph } from "../src/wayfinders/navigation/GridGraph.ts";
import { DEFAULT_ACTIVE_CHUNK_BUDGET } from "../src/wayfinders/rendering/activation/index.ts";
import {
  createWorldProfileConfig,
  WORLD_PROFILES,
  type WorldProfileName,
} from "../tests/fixtures/worldProfiles.ts";

const RESULT_VERSION = 4;
const DEFAULT_UPDATE_SAMPLES = 25;
const DEFAULT_CONSTRUCTION_SAMPLES = 3;
const DEFAULT_WARMUP_CROSSINGS = 5;
const DEFAULT_GUIDANCE_WARMUPS = 20;

interface Distribution {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

interface CountDistribution {
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

interface ProfileResult {
  readonly profile: WorldProfileName;
  readonly config: {
    readonly seed: number;
    readonly width: number;
    readonly height: number;
    readonly chunkSize: number;
    readonly islands: number;
  };
  readonly construction?: Distribution;
  readonly ordinaryUpdate?: Distribution;
  readonly tileEntryUpdate?: Distribution;
  readonly guidance?: {
    readonly baselineSynchronous: Distribution;
    readonly mainThreadSlice: Distribution;
    readonly requestCpu: Distribution;
    readonly slicesPerRequest: CountDistribution;
    readonly sliceP95BudgetMs: number;
    readonly sliceBudgetPassed: boolean;
    readonly telemetry: Readonly<ForwardGuidanceTelemetry>;
  };
  readonly phases: Partial<Record<SimulationPhase, Distribution>>;
  readonly resources?: {
    readonly loadedChunks: number;
    readonly activeChunkBudget: number;
    readonly modeledActiveChunks: number;
    readonly modeledTextureCount: number;
    readonly modeledTextureBytes: number;
    readonly modeledFullWorldTextureBytes: number;
    readonly model: string;
  };
  readonly heapDeltaBytes?: number;
  readonly error?: {
    readonly name: string;
    readonly message: string;
  };
}

class TraceCollector implements SimulationTraceSink {
  private readonly durations = new Map<SimulationPhase, number[]>();

  record(phase: SimulationPhase, durationMs: number): void {
    const values = this.durations.get(phase);
    if (values) values.push(durationMs);
    else this.durations.set(phase, [durationMs]);
  }

  clear(): void {
    this.durations.clear();
  }

  appendFrom(source: TraceCollector): void {
    for (const [phase, values] of source.durations) {
      const current = this.durations.get(phase);
      if (current) current.push(...values);
      else this.durations.set(phase, [...values]);
    }
  }

  snapshot(): Partial<Record<SimulationPhase, Distribution>> {
    const result: Partial<Record<SimulationPhase, Distribution>> = {};
    for (const [phase, values] of this.durations) result[phase] = distribution(values);
    return result;
  }
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { samples: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const at = (percentile: number): number => {
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1);
    return Number(sorted[Math.max(0, index)].toFixed(4));
  };
  return {
    samples: sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: Number(sorted[sorted.length - 1].toFixed(4)),
  };
}

function countDistribution(values: readonly number[]): CountDistribution {
  if (values.length === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (percentile: number): number => (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1))]
  );
  return {
    samples: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  };
}

function argument(name: string): string | undefined {
  const prefix = "--" + name + "=";
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function positiveIntegerArgument(name: string, fallback: number): number {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError("--" + name + " must be a positive integer");
  }
  return parsed;
}

function requestedProfiles(): WorldProfileName[] {
  const raw = (argument("profile") ?? "P0").toUpperCase();
  if (raw === "ALL") return ["P0", "P1", "P2"];
  if (raw === "P0" || raw === "P1" || raw === "P2") return [raw];
  throw new RangeError("--profile must be P0, P1, P2, or all");
}

function gitValue(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function findEastboundRun(
  simulation: GameSimulation,
  requiredEdges: number,
): { x: number; y: number } {
  const world = simulation.world;
  const graph = new GridGraph(world);
  for (let y = 1; y + 1 < world.height; y++) {
    for (let x = 1; x + requiredEdges < world.width; x++) {
      let valid = true;
      for (let offset = 0; offset < requiredEdges; offset++) {
        const from = world.index(x + offset, y);
        const to = world.index(x + offset + 1, y);
        if (!graph.canTraverseCardinalEdge(from, to)) {
          valid = false;
          break;
        }
      }
      if (valid) return { x, y };
    }
  }
  throw new Error("Unable to locate the requested eastbound navigation fixture");
}

function resourceEstimate(simulation: GameSimulation): ProfileResult["resources"] {
  const chunks = simulation.world.getLoadedChunks().length;
  const chunkSize = simulation.world.chunkSize;
  const knowledgePixels = (chunkSize * 4 + 8) ** 2;
  const riskPixels = (chunkSize * 6) ** 2 * 2;
  const bytesPerChunk = (knowledgePixels + riskPixels) * 4;
  const activeChunks = Math.min(chunks, DEFAULT_ACTIVE_CHUNK_BUDGET);
  return {
    loadedChunks: chunks,
    activeChunkBudget: DEFAULT_ACTIVE_CHUNK_BUDGET,
    modeledActiveChunks: activeChunks,
    modeledTextureCount: activeChunks * 3,
    modeledTextureBytes: activeChunks * bytesPerChunk,
    modeledFullWorldTextureBytes: chunks * bytesPerChunk,
    model: "Active window: one knowledge and two risk RGBA canvases per active chunk; terrain commands and GPU copies excluded.",
  };
}

function drainForwardGuidance(
  simulation: GameSimulation,
  sliceDurations?: number[],
): { readonly cpuMs: number; readonly slices: number } {
  let cpuMs = 0;
  for (let slices = 1; slices <= 10_000; slices++) {
    const startedAt = performance.now();
    const applied = simulation.advanceForwardGuidance();
    const duration = performance.now() - startedAt;
    cpuMs += duration;
    sliceDurations?.push(duration);
    if (applied) return { cpuMs, slices };
    if (!simulation.forwardGuidanceStatus.pending) {
      throw new Error("Forward guidance stopped without publishing a result");
    }
  }
  throw new Error("Forward guidance exceeded 10,000 cooperative slices");
}

function assertEquivalentGuidance(
  simulation: GameSimulation,
  reference: ReturnType<ForwardRangeSystem["calculate"]>,
): void {
  const actual = simulation.forwardRange;
  if (
    actual.budget !== reference.budget
    || actual.reachableCount !== reference.reachableCount
    || actual.frontierCount !== reference.frontierCount
    || actual.presentationHeading !== reference.presentationHeading
    || actual.candidateIndices.length !== reference.candidateIndices.length
  ) {
    throw new Error("Cooperative guidance summary differs from the synchronous oracle");
  }
  for (let index = 0; index < simulation.world.tileCount; index++) {
    if (
      actual.mask[index] !== reference.mask[index]
      || actual.presentationMask[index] !== reference.presentationMask[index]
      || actual.costs[index] !== reference.costs[index]
    ) {
      throw new Error(`Cooperative guidance differs from the synchronous oracle at tile ${index}`);
    }
  }
}

function benchmarkProfile(
  profileName: WorldProfileName,
  updateSamples: number,
  constructionSamples: number,
  warmupCrossings: number,
  guidanceSamples: number,
  guidanceWarmups: number,
): ProfileResult {
  const profile = WORLD_PROFILES[profileName];
  const configSummary = {
    seed: profile.config.world.seed,
    width: profile.config.world.width,
    height: profile.config.world.height,
    chunkSize: profile.config.navigation.chunkSize,
    islands: profile.config.islands.count,
  };
  const trace = new TraceCollector();
  const constructionDurations: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;

  try {
    let simulation: GameSimulation | undefined;
    for (let sample = 0; sample < constructionSamples; sample++) {
      const startedAt = performance.now();
      simulation = new GameSimulation(createWorldProfileConfig(profileName), trace);
      constructionDurations.push(performance.now() - startedAt);
    }
    if (!simulation) throw new Error("Construction produced no simulation");

    const constructionPhases = trace.snapshot();
    const resources = resourceEstimate(simulation);
    const ordinaryDurations: number[] = [];
    trace.clear();
    for (let sample = 0; sample < updateSamples; sample++) {
      const startedAt = performance.now();
      simulation.update({ turn: 0, throttle: 0 }, 1 / 30);
      ordinaryDurations.push(performance.now() - startedAt);
    }
    const ordinaryPhases = trace.snapshot();

    const tileEntryDurations: number[] = [];
    const baselineGuidanceDurations: number[] = [];
    const guidanceSliceDurations: number[] = [];
    const guidanceRequestCpuDurations: number[] = [];
    const guidanceSlicesPerRequest: number[] = [];
    const tileTrace = new TraceCollector();
    const baselineGuidance = new ForwardRangeSystem(simulation.world, simulation.config);
    let baselineResult = baselineGuidance.calculate(simulation.ship);
    const start = findEastboundRun(simulation, warmupCrossings + updateSamples + 1);
    if (!simulation.teleport(start)) throw new Error("Tile-entry fixture teleport was rejected");
    baselineResult = baselineGuidance.recalculate(baselineResult, simulation.ship);
    drainForwardGuidance(simulation);
    assertEquivalentGuidance(simulation, baselineResult);
    for (let warmup = 0; warmup < warmupCrossings; warmup++) {
      const movement = simulation.update({ turn: 0, throttle: 1 }, 0.4);
      if (!movement.tileChanged) throw new Error("Tile-entry warmup did not cross a tile");
      baselineResult = baselineGuidance.recalculate(baselineResult, simulation.ship);
      drainForwardGuidance(simulation);
      assertEquivalentGuidance(simulation, baselineResult);
    }
    trace.clear();
    for (let sample = 0; sample < updateSamples; sample++) {
      const startedAt = performance.now();
      const movement = simulation.update({ turn: 0, throttle: 1 }, 0.4);
      tileEntryDurations.push(performance.now() - startedAt);
      if (!movement.tileChanged) throw new Error("Tile-entry fixture did not cross a tile");
      tileTrace.appendFrom(trace);
      trace.clear();
      baselineResult = baselineGuidance.recalculate(baselineResult, simulation.ship);
      drainForwardGuidance(simulation);
      assertEquivalentGuidance(simulation, baselineResult);
      tileTrace.appendFrom(trace);
      trace.clear();
    }

    for (let requestIndex = 0; requestIndex < guidanceWarmups + guidanceSamples; requestIndex++) {
      simulation.refreshRiskOverlays();
      const baselineStartedAt = performance.now();
      baselineResult = baselineGuidance.recalculate(baselineResult, simulation.ship);
      const baselineDuration = performance.now() - baselineStartedAt;
      const request = drainForwardGuidance(
        simulation,
        requestIndex >= guidanceWarmups ? guidanceSliceDurations : undefined,
      );
      if (requestIndex >= guidanceWarmups) {
        baselineGuidanceDurations.push(baselineDuration);
        guidanceRequestCpuDurations.push(request.cpuMs);
        guidanceSlicesPerRequest.push(request.slices);
      }
      if (
        requestIndex === guidanceWarmups - 1
        || requestIndex === guidanceWarmups + guidanceSamples - 1
      ) {
        assertEquivalentGuidance(simulation, baselineResult);
      }
      tileTrace.appendFrom(trace);
      trace.clear();
    }
    const tilePhases = tileTrace.snapshot();
    const phases = { ...constructionPhases, ...ordinaryPhases, ...tilePhases };

    return {
      profile: profileName,
      config: configSummary,
      construction: distribution(constructionDurations),
      ordinaryUpdate: distribution(ordinaryDurations),
      tileEntryUpdate: distribution(tileEntryDurations),
      guidance: {
        baselineSynchronous: distribution(baselineGuidanceDurations),
        mainThreadSlice: distribution(guidanceSliceDurations),
        requestCpu: distribution(guidanceRequestCpuDurations),
        slicesPerRequest: countDistribution(guidanceSlicesPerRequest),
        sliceP95BudgetMs: 4,
        sliceBudgetPassed: distribution(guidanceSliceDurations).p95Ms < 4,
        telemetry: simulation.forwardGuidanceStatus.telemetry,
      },
      phases,
      resources,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    };
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    return {
      profile: profileName,
      config: configSummary,
      construction: constructionDurations.length > 0
        ? distribution(constructionDurations)
        : undefined,
      phases: trace.snapshot(),
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      error: {
        name: cause.name,
        message: cause.message,
      },
    };
  }
}

const updateSamples = positiveIntegerArgument("samples", DEFAULT_UPDATE_SAMPLES);
const constructionSamples = positiveIntegerArgument(
  "construction-samples",
  DEFAULT_CONSTRUCTION_SAMPLES,
);
const warmupCrossings = positiveIntegerArgument("warmup-crossings", DEFAULT_WARMUP_CROSSINGS);
const guidanceSamples = positiveIntegerArgument("guidance-samples", updateSamples);
const guidanceWarmups = positiveIntegerArgument("guidance-warmups", DEFAULT_GUIDANCE_WARMUPS);
const commit = gitValue(["rev-parse", "HEAD"]);
const dirty = gitValue(["status", "--porcelain"]) !== "";
const results = requestedProfiles().map((profile) => (
  benchmarkProfile(
    profile,
    updateSamples,
    constructionSamples,
    warmupCrossings,
    guidanceSamples,
    guidanceWarmups,
  )
));
const report = {
  version: RESULT_VERSION,
  createdAt: new Date().toISOString(),
  commit,
  dirty,
  buildMode: "vite-node",
  machine: argument("machine") ?? hostname(),
  runtime: {
    node: process.version,
    platform: platform(),
    release: release(),
    logicalCpus: cpus().length,
  },
  updateSamples,
  constructionSamples,
  warmupCrossings,
  guidanceSamples,
  guidanceWarmups,
  results,
};
const output = resolve(
  argument("output")
    ?? ("artifacts/architecture/benchmark-" + commit.slice(0, 12) + ".json"),
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify({ output, ...report }, null, 2) + "\n");

if (results.some((result) => result.error !== undefined)) process.exitCode = 2;
