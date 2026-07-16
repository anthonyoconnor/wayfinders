/** A chunk coordinate in presentation space. */
export interface ActiveChunkCoordinate {
  readonly x: number;
  readonly y: number;
}

/** Closed, inclusive bounds in chunk coordinates. */
export interface ChunkRegion {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ActiveChunkSetOptions {
  /** Closed bounds for chunks that can be presented. */
  readonly worldBounds: Readonly<ChunkRegion>;
  /** Number of chunks to prepare beyond every visible edge. */
  readonly prefetchRing: number;
  /** Hard cap for fully active presentation chunks. */
  readonly maxActiveChunks: number;
}

export type ActiveChunkBand = "visible" | "prefetch";

/** A deterministic presentation-resource request. Lower priorities load first. */
export interface ActiveChunkEntry {
  readonly key: string;
  readonly coordinate: Readonly<ActiveChunkCoordinate>;
  readonly band: ActiveChunkBand;
  /** Chebyshev distance from the closed visible region. Zero is visible. */
  readonly ringDistance: number;
  /** Total deterministic order across both active and deferred chunks. */
  readonly loadPriority: number;
}

export type ChunkDeactivationReason = "outside-prefetch" | "budget";

export interface DeactivatedChunkEntry extends ActiveChunkEntry {
  readonly reason: ChunkDeactivationReason;
}

/** Current and lifetime counters; no deep renderer snapshot is required. */
export interface ActiveChunkTelemetry {
  readonly updateCount: number;
  /** Changes when the effective visible target, priorities, or budget result changes. */
  readonly revision: number;
  /** Changes only when active membership changes. */
  readonly membershipRevision: number;
  readonly capacity: number;
  readonly activeChunks: number;
  readonly visibleActiveChunks: number;
  readonly prefetchedActiveChunks: number;
  readonly desiredChunks: number;
  readonly budgetDeferredChunks: number;
  readonly visibleBudgetDeferredChunks: number;
  readonly budgetSaturated: boolean;
  readonly totalActivations: number;
  readonly totalDeactivations: number;
  readonly totalBudgetEvictions: number;
  readonly totalViewportDeactivations: number;
  readonly peakActiveChunks: number;
  readonly peakBudgetDeferredChunks: number;
}

export interface ActiveChunkDelta {
  readonly revision: number;
  readonly membershipRevision: number;
  /** Effective region after clipping to world bounds. */
  readonly visibleRegion: Readonly<ChunkRegion> | null;
  /** Load in this order after processing deactivations. */
  readonly activated: readonly Readonly<ActiveChunkEntry>[];
  /** Lowest-value former requests are returned first so resources can be freed early. */
  readonly deactivated: readonly Readonly<DeactivatedChunkEntry>[];
  /** Retained chunks whose band or priority changed. */
  readonly updated: readonly Readonly<ActiveChunkEntry>[];
  readonly active: readonly Readonly<ActiveChunkEntry>[];
  /** Desired requests outside the hard cap; visible entries need a placeholder. */
  readonly deferred: readonly Readonly<ActiveChunkEntry>[];
  readonly telemetry: Readonly<ActiveChunkTelemetry>;
}
