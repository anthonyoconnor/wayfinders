import {
  createSessionConfig,
  patchSessionConfig,
  type SessionConfig,
  type SessionConfigPatch,
} from "../config/SessionConfig";
import { prototypeConfig, type DeepReadonly, type PrototypeConfig } from "../config/prototypeConfig";

/** The stable inputs needed to construct one application session. */
export interface SessionDefinition {
  readonly config: SessionConfig;
}

/**
 * Builds isolated session inputs without changing developer-tool defaults.
 * Each successful patch creates a new immutable snapshot, so previously built
 * definitions remain valid recovery points.
 */
export class SessionBuilder {
  private config: SessionConfig;

  constructor(base: DeepReadonly<PrototypeConfig> = prototypeConfig) {
    this.config = createSessionConfig(base);
  }

  withConfig(patch: SessionConfigPatch): this {
    this.config = patchSessionConfig(this.config, patch);
    return this;
  }

  buildConfig(): SessionConfig {
    return this.config;
  }

  build(): SessionDefinition {
    return Object.freeze({ config: this.config });
  }
}
