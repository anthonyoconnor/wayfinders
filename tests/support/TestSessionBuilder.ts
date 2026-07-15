import { SessionBuilder } from "../../src/wayfinders/app/SessionBuilder";

/**
 * Test-facing vocabulary for common setup values. Tests can still use
 * `withConfig` when a scenario needs a less common setting.
 */
export class TestSessionBuilder extends SessionBuilder {
  withSeed(seed: number): this {
    return this.withConfig({ world: { seed } });
  }

  withWorldSize(width: number, height: number): this {
    return this.withConfig({ world: { width, height } });
  }

  withStartingBundles(startingBundles: number): this {
    return this.withConfig({ provisions: { startingBundles } });
  }
}
