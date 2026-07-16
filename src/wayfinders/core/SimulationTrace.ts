export type SimulationPhase =
  | "world-generation"
  | "manifest-generation"
  | "logical-rasterization"
  | "world-analysis"
  | "feature-catalogs"
  | "feature-seeding"
  | "playable-region"
  | "movement"
  | "observation"
  | "forward-guidance"
  | "return-query";

export interface SimulationTraceSink {
  record(phase: SimulationPhase, durationMs: number): void;
}

export function measureSimulationPhase<T>(
  sink: SimulationTraceSink | undefined,
  phase: SimulationPhase,
  operation: () => T,
): T {
  if (!sink) return operation();
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    sink.record(phase, performance.now() - startedAt);
  }
}
