import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";

/** Keeps gameplay deterministic and independent of render frame rate. */
export class SimulationClock {
  private accumulatorMs = 0;

  constructor(private readonly config: PrototypeConfig = prototypeConfig) {}

  advance(frameDeltaMs: number, step: (deltaSeconds: number) => boolean | void): number {
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs < 0) return 0;

    const fixedStepMs = this.config.simulation.fixedStepMs;
    this.accumulatorMs += Math.min(frameDeltaMs, this.config.simulation.maxFrameDeltaMs);

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
  }

  get interpolationAlpha(): number {
    return this.accumulatorMs / this.config.simulation.fixedStepMs;
  }
}
