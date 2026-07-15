import {
  prototypeConfig,
  validatePrototypeConfig,
  type DeepPartial,
  type DeepReadonly,
  type PrototypeConfig,
} from "./prototypeConfig";

/**
 * An immutable configuration snapshot owned by one game session.
 *
 * The live prototype configuration remains an authoring input. Runtime systems
 * should receive this snapshot so one session (or test) cannot change another.
 */
export type SessionConfig = DeepReadonly<PrototypeConfig>;

export type SessionConfigPatch = DeepPartial<PrototypeConfig>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDeep(entry)) as T;
  }
  if (!isRecord(value)) return value;

  const clone: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value)) clone[key] = cloneDeep(entry);
  return clone as T;
}

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function applyPatch(target: UnknownRecord, patch: UnknownRecord, path = ""): void {
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;

    const valuePath = path === "" ? key : `${path}.${key}`;
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      throw new RangeError(`Unknown session config value: ${valuePath}`);
    }

    const targetValue = target[key];
    if (isRecord(targetValue)) {
      if (!isRecord(patchValue)) {
        throw new TypeError(`Session config value ${valuePath} must be an object`);
      }
      applyPatch(targetValue, patchValue, valuePath);
      continue;
    }

    if (isRecord(patchValue) || Array.isArray(patchValue)) {
      throw new TypeError(`Session config value ${valuePath} must be a scalar`);
    }
    target[key] = patchValue;
  }
}

/**
 * Copies and validates an authoring configuration without touching the live
 * prototype object, then freezes every level of the resulting session value.
 */
export function createSessionConfig(
  source: DeepReadonly<PrototypeConfig> = prototypeConfig,
  patch: SessionConfigPatch = {},
): SessionConfig {
  const candidate = cloneDeep(source) as PrototypeConfig;
  applyPatch(candidate as unknown as UnknownRecord, patch as UnknownRecord);
  validatePrototypeConfig(candidate);
  return freezeDeep(candidate);
}

/** Returns a new snapshot; the current session configuration remains unchanged. */
export function patchSessionConfig(
  current: SessionConfig,
  patch: SessionConfigPatch,
): SessionConfig {
  return createSessionConfig(current, patch);
}

/**
 * Creates the detached mutable compatibility view used by legacy systems.
 * GameSession retains the immutable source; this copy must never escape as the
 * session definition and must not be shared between sessions.
 */
export function materializeSessionConfig(config: SessionConfig): PrototypeConfig {
  return cloneDeep(config) as PrototypeConfig;
}
