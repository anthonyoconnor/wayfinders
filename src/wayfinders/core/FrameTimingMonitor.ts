export interface FrameTimingSnapshot {
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  longFrameCount: number;
  totalDroppedSimulationMs: number;
}

/** Small allocation-free frame ring; percentile sorting happens only when diagnostics request a snapshot. */
export class FrameTimingMonitor {
  private readonly samples: Float64Array;
  private nextSample = 0;
  private samplesWritten = 0;
  private longFrames = 0;
  private droppedSimulationMs = 0;

  constructor(
    sampleCapacity = 180,
    private readonly longFrameThresholdMs = 50,
  ) {
    if (!Number.isInteger(sampleCapacity) || sampleCapacity <= 0) {
      throw new RangeError("sampleCapacity must be a positive integer");
    }
    if (!Number.isFinite(longFrameThresholdMs) || longFrameThresholdMs <= 0) {
      throw new RangeError("longFrameThresholdMs must be positive");
    }
    this.samples = new Float64Array(sampleCapacity);
  }

  record(frameDeltaMs: number, droppedSimulationMs = 0, active = true): void {
    if (!active || !Number.isFinite(frameDeltaMs) || frameDeltaMs < 0) return;
    this.samples[this.nextSample] = frameDeltaMs;
    this.nextSample = (this.nextSample + 1) % this.samples.length;
    this.samplesWritten++;
    if (frameDeltaMs > this.longFrameThresholdMs) this.longFrames++;
    if (Number.isFinite(droppedSimulationMs) && droppedSimulationMs > 0) {
      this.droppedSimulationMs += droppedSimulationMs;
    }
  }

  snapshot(): FrameTimingSnapshot {
    const sampleCount = Math.min(this.samplesWritten, this.samples.length);
    if (sampleCount === 0) {
      return {
        sampleCount: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        maxMs: 0,
        longFrameCount: this.longFrames,
        totalDroppedSimulationMs: this.droppedSimulationMs,
      };
    }

    const sorted = Array.from(this.samples.subarray(0, sampleCount)).sort((left, right) => left - right);
    const percentile = (fraction: number): number => sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ];
    return {
      sampleCount,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: sorted[sorted.length - 1],
      longFrameCount: this.longFrames,
      totalDroppedSimulationMs: this.droppedSimulationMs,
    };
  }
}
