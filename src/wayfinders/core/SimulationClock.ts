import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";

/** Keeps gameplay deterministic and independent of render frame rate. */
export class SimulationClock {
  private accumulatorMs = 0;
  private droppedMs = 0;
  private droppedMsTotal = 0;

  constructor(private readonly config: PrototypeConfig = prototypeConfig) {}

  advance(frameDeltaMs: number, step: (deltaSeconds: number) => boolean | void): number {
    this.droppedMs = 0;
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs < 0) return 0;

    const fixedStepMs = this.config.simulation.fixedStepMs;
    const acceptedDeltaMs = Math.min(frameDeltaMs, this.config.simulation.maxFrameDeltaMs);
    this.droppedMs = frameDeltaMs - acceptedDeltaMs;
    this.droppedMsTotal += this.droppedMs;
    this.accumulatorMs += acceptedDeltaMs;

    let steps = 0;
    while (this.accumulatorMs >= fixedStepMs) {
      const shouldContinue = step(fixedStepMs / 1000);
      this.accumulatorMs -= fixedStepMs;
      steps++;
      if (shouldContinue === false) {
        this.accumulatorMs = 0;
        break;
      }
    }
    return steps;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.droppedMs = 0;
  }

  get interpolationAlpha(): number {
    return this.accumulatorMs / this.config.simulation.fixedStepMs;
  }

  /** Elapsed real time intentionally discarded by the most recent spiral-of-death guard. */
  get lastDroppedMs(): number {
    return this.droppedMs;
  }

  /** Cumulative dropped time, exposed so browser diagnostics can identify actual simulation slowdown. */
  get totalDroppedMs(): number {
    return this.droppedMsTotal;
  }
}
