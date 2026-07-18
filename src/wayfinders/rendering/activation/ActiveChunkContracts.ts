import type { GridPoint, WorldPoint } from "../../core/types";
import type { WorldTopology } from "../../world/WorldTopology";

/** Closed, inclusive bounds in lifted tile coordinates. */
export interface LiftedTileBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ActiveChunkSetOptions {
  /** Authoritative dimensions, chunk layout, and per-axis boundary behaviour. */
  readonly topology: WorldTopology;
  /** Number of chunk-width tile rings to prepare beyond every visible edge. */
  readonly prefetchRing: number;
  /** Hard cap for active periodic image entries. */
  readonly maxActiveChunks: number;
}

export type ActiveChunkBand = "visible" | "prefetch";

/** A deterministic request for one lifted image of one canonical chunk. */
export interface ActiveChunkEntry {
  /** Unique presentation identity for this canonical chunk image. */
  readonly viewKey: string;
  /** Canonical logical/resource-owner identity. */
  readonly canonicalChunk: Readonly<GridPoint>;
  /** Whole-world pixel offset that places this image in lifted view space. */
  readonly imageOffset: Readonly<WorldPoint>;
  readonly band: ActiveChunkBand;
  /** Chebyshev tile-gap distance measured in chunk-width rings. */
  readonly ringDistance: number;
  /** Total deterministic order across both active and deferred images. */
  readonly loadPriority: number;
}

export type ChunkDeactivationReason = "outside-prefetch" | "budget";

export interface DeactivatedChunkEntry extends ActiveChunkEntry {
  readonly reason: ChunkDeactivationReason;
}

/** Current and lifetime counters; counts refer to image entries, not canonical owners. */
export interface ActiveChunkTelemetry {
  readonly updateCount: number;
  /** Changes when the effective visible target, priorities, or budget result changes. */
  readonly revision: number;
  /** Changes only when active image membership changes. */
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
  /** Lifted tile coverage requested by the current camera. */
  readonly visibleTileBounds: Readonly<LiftedTileBounds> | null;
  /** Load in this order after processing deactivations. */
  readonly activated: readonly Readonly<ActiveChunkEntry>[];
  /** Lowest-value former requests are returned first so resources can be freed early. */
  readonly deactivated: readonly Readonly<DeactivatedChunkEntry>[];
  /** Retained images whose band or priority changed. */
  readonly updated: readonly Readonly<ActiveChunkEntry>[];
  readonly active: readonly Readonly<ActiveChunkEntry>[];
  /** Desired requests outside the hard cap; visible entries need a placeholder. */
  readonly deferred: readonly Readonly<ActiveChunkEntry>[];
  readonly telemetry: Readonly<ActiveChunkTelemetry>;
}
