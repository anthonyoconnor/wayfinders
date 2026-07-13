export const NAVIGATOR_LINEAGE_CONTRACT_VERSION = 1 as const;
export const NAVIGATOR_ID_VERSION = 1 as const;

const navigatorIdBrand: unique symbol = Symbol("NavigatorId");
const navigatorSuccessionKeyBrand: unique symbol = Symbol("NavigatorSuccessionKey");
const NAVIGATOR_ID_PATTERN = /^navigator:v([1-9]\d*):g([1-9]\d*)$/;
const NAVIGATOR_SUCCESSION_KEY_PATTERN =
  /^navigator-succession:v([1-9]\d*):(wreck|retirement):([1-9]\d*)$/;

export type NavigatorId = string & { readonly [navigatorIdBrand]: true };
export type NavigatorSuccessionKey = string & { readonly [navigatorSuccessionKeyBrand]: true };

export const NAVIGATOR_LIFECYCLE_STATES = ["active", "retired", "lost"] as const;
export type NavigatorLifecycleState = (typeof NAVIGATOR_LIFECYCLE_STATES)[number];

export const NAVIGATOR_SUCCESSION_REASONS = ["wreck", "retirement"] as const;
export type NavigatorSuccessionReason = (typeof NAVIGATOR_SUCCESSION_REASONS)[number];

export interface ParsedNavigatorId {
  version: number;
  generation: number;
}

export interface ParsedNavigatorSuccessionKey {
  version: number;
  reason: NavigatorSuccessionReason;
  resolutionId: number;
}

interface NavigatorRecordBaseV1 {
  id: NavigatorId;
  generation: number;
  /** Null only for the navigator introduced when the lineage save shape is created. */
  createdBySuccessionKey: NavigatorSuccessionKey | null;
}

export interface ActiveNavigatorRecordV1 extends NavigatorRecordBaseV1 {
  state: "active";
  successionReason?: never;
  endedBySuccessionKey?: never;
}

export interface RetiredNavigatorRecordV1 extends NavigatorRecordBaseV1 {
  state: "retired";
  successionReason: "retirement";
  endedBySuccessionKey: NavigatorSuccessionKey;
}

export interface LostNavigatorRecordV1 extends NavigatorRecordBaseV1 {
  state: "lost";
  successionReason: "wreck";
  endedBySuccessionKey: NavigatorSuccessionKey;
}

export type NavigatorRecordV1 =
  | ActiveNavigatorRecordV1
  | RetiredNavigatorRecordV1
  | LostNavigatorRecordV1;

/** Persisted between the visible end of one navigator and creation of the next. */
export interface NavigatorSuccessionTransitionV1 {
  key: NavigatorSuccessionKey;
  reason: NavigatorSuccessionReason;
  resolutionId: number;
  fromNavigatorId: NavigatorId;
  fromGeneration: number;
  nextGeneration: number;
}

export interface NavigatorLineageSnapshotV1 {
  contractVersion: typeof NAVIGATOR_LINEAGE_CONTRACT_VERSION;
  navigators: readonly Readonly<NavigatorRecordV1>[];
  pendingSuccession: Readonly<NavigatorSuccessionTransitionV1> | null;
}

export type NavigatorSuccessionBeginResult =
  | {
      status: "begun" | "already-pending";
      transition: Readonly<NavigatorSuccessionTransitionV1>;
    }
  | {
      status: "already-completed";
      transition: Readonly<NavigatorSuccessionTransitionV1>;
      navigator: Readonly<NavigatorRecordV1>;
    };

export interface NavigatorSuccessionCompleteResult {
  status: "completed" | "already-completed";
  transition: Readonly<NavigatorSuccessionTransitionV1>;
  navigator: Readonly<NavigatorRecordV1>;
}

export class NavigatorLineageValidationError extends RangeError {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "NavigatorLineageValidationError";
  }
}

export function createNavigatorId(generation: number): NavigatorId {
  positiveSafeInteger(generation, "generation");
  return `navigator:v${NAVIGATOR_ID_VERSION}:g${generation}` as NavigatorId;
}

export function parseNavigatorId(value: unknown): ParsedNavigatorId | undefined {
  if (typeof value !== "string") return undefined;
  const match = NAVIGATOR_ID_PATTERN.exec(value);
  if (!match) return undefined;
  const version = Number(match[1]);
  const generation = Number(match[2]);
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(generation)) return undefined;
  if (value !== `navigator:v${version}:g${generation}`) return undefined;
  return { version, generation };
}

export function isCurrentNavigatorId(value: unknown): value is NavigatorId {
  return parseNavigatorId(value)?.version === NAVIGATOR_ID_VERSION;
}

export function createNavigatorSuccessionKey(
  reason: NavigatorSuccessionReason,
  resolutionId: number,
): NavigatorSuccessionKey {
  if (!isSuccessionReason(reason)) throw new RangeError(`Unsupported navigator succession reason ${String(reason)}`);
  positiveSafeInteger(resolutionId, "resolutionId");
  return `navigator-succession:v${NAVIGATOR_LINEAGE_CONTRACT_VERSION}:${reason}:${resolutionId}` as NavigatorSuccessionKey;
}

export function parseNavigatorSuccessionKey(value: unknown): ParsedNavigatorSuccessionKey | undefined {
  if (typeof value !== "string") return undefined;
  const match = NAVIGATOR_SUCCESSION_KEY_PATTERN.exec(value);
  if (!match) return undefined;
  const version = Number(match[1]);
  const reason = match[2];
  const resolutionId = Number(match[3]);
  if (!isSuccessionReason(reason) || !Number.isSafeInteger(version) || !Number.isSafeInteger(resolutionId)) {
    return undefined;
  }
  if (value !== `navigator-succession:v${version}:${reason}:${resolutionId}`) return undefined;
  return { version, reason, resolutionId };
}

export function isCurrentNavigatorSuccessionKey(value: unknown): value is NavigatorSuccessionKey {
  return parseNavigatorSuccessionKey(value)?.version === NAVIGATOR_LINEAGE_CONTRACT_VERSION;
}

/**
 * Adds the first navigator-owned save fragment to an accepted baseline save.
 * A save captured during the wreck hold migrates directly into the same
 * pending, idempotent succession that normal runtime play would create.
 */
export function migrateBaselineNavigatorLineage(
  generation: number,
  pendingWreckId: number | null = null,
): NavigatorLineageSnapshotV1 {
  const lineage = new NavigatorLineageSystem(generation);
  if (pendingWreckId !== null) lineage.beginSuccession("wreck", pendingWreckId);
  return lineage.snapshot();
}

/** Validates and defensively copies a persisted navigator-lineage fragment. */
export function parseNavigatorLineageSnapshot(value: unknown): NavigatorLineageSnapshotV1 {
  const root = record(value, "navigatorLineage");
  if (root.contractVersion !== NAVIGATOR_LINEAGE_CONTRACT_VERSION) {
    fail(
      `must use contract version ${NAVIGATOR_LINEAGE_CONTRACT_VERSION}`,
      "navigatorLineage.contractVersion",
    );
  }
  if (!Array.isArray(root.navigators) || root.navigators.length === 0) {
    fail("must contain at least one navigator", "navigatorLineage.navigators");
  }

  const navigators: Readonly<NavigatorRecordV1>[] = [];
  const navigatorIds = new Set<string>();
  const generations = new Set<number>();
  const endedKeys = new Set<string>();
  const createdKeys = new Set<string>();
  for (let index = 0; index < root.navigators.length; index++) {
    const path = `navigatorLineage.navigators[${index}]`;
    const item = record(root.navigators[index], path);
    const generation = positiveSafeInteger(item.generation, `${path}.generation`);
    const id = currentNavigatorId(item.id, `${path}.id`);
    if (id !== createNavigatorId(generation)) fail("must match its generation", `${path}.id`);
    if (navigatorIds.has(id)) fail(`duplicates navigator ${id}`, `${path}.id`);
    if (generations.has(generation)) fail(`duplicates generation ${generation}`, `${path}.generation`);
    navigatorIds.add(id);
    generations.add(generation);

    const createdBySuccessionKey = nullableSuccessionKey(
      item.createdBySuccessionKey,
      `${path}.createdBySuccessionKey`,
    );
    if (createdBySuccessionKey !== null) {
      if (createdKeys.has(createdBySuccessionKey)) {
        fail("must create at most one navigator", `${path}.createdBySuccessionKey`);
      }
      createdKeys.add(createdBySuccessionKey);
    }

    if (item.state === "active") {
      if (item.successionReason !== undefined || item.endedBySuccessionKey !== undefined) {
        fail("cannot contain terminal succession fields", path);
      }
      navigators.push(freezeNavigator({
        id,
        generation,
        state: "active",
        createdBySuccessionKey,
      }));
      continue;
    }
    if (item.state !== "retired" && item.state !== "lost") {
      fail("must have lifecycle state active, retired or lost", `${path}.state`);
    }
    const expectedReason: NavigatorSuccessionReason = item.state === "lost" ? "wreck" : "retirement";
    if (item.successionReason !== expectedReason) {
      fail(`must use succession reason ${expectedReason}`, `${path}.successionReason`);
    }
    const endedBySuccessionKey = currentSuccessionKey(
      item.endedBySuccessionKey,
      `${path}.endedBySuccessionKey`,
    );
    const parsedKey = parseNavigatorSuccessionKey(endedBySuccessionKey);
    if (parsedKey?.reason !== expectedReason) {
      fail("reason must match the terminal lifecycle state", `${path}.endedBySuccessionKey`);
    }
    if (endedKeys.has(endedBySuccessionKey)) {
      fail("must end at most one navigator", `${path}.endedBySuccessionKey`);
    }
    endedKeys.add(endedBySuccessionKey);
    navigators.push(freezeNavigator({
      id,
      generation,
      state: item.state,
      successionReason: expectedReason,
      endedBySuccessionKey,
      createdBySuccessionKey,
    } as RetiredNavigatorRecordV1 | LostNavigatorRecordV1));
  }

  if (navigators[0].createdBySuccessionKey !== null) {
    fail("the first preserved navigator cannot have a predecessor", "navigatorLineage.navigators[0].createdBySuccessionKey");
  }
  for (let index = 1; index < navigators.length; index++) {
    const previous = navigators[index - 1];
    const current = navigators[index];
    const path = `navigatorLineage.navigators[${index}]`;
    if (current.generation !== previous.generation + 1) {
      fail("must immediately follow the previous generation", `${path}.generation`);
    }
    if (previous.state === "active") {
      fail("only the final navigator may be active", `navigatorLineage.navigators[${index - 1}].state`);
    }
    if (current.createdBySuccessionKey !== previous.endedBySuccessionKey) {
      fail("must be created by the previous navigator's succession", `${path}.createdBySuccessionKey`);
    }
  }

  const pendingSuccession = root.pendingSuccession === null
    ? null
    : parsePendingSuccession(root.pendingSuccession);
  const latest = navigators[navigators.length - 1];
  if (pendingSuccession === null) {
    if (latest.state !== "active") {
      fail("requires an active final navigator when no succession is pending", "navigatorLineage.navigators");
    }
  } else {
    if (latest.state === "active") {
      fail("cannot retain an active navigator during succession", "navigatorLineage.navigators");
    }
    if (
      pendingSuccession.fromNavigatorId !== latest.id
      || pendingSuccession.fromGeneration !== latest.generation
    ) {
      fail("must depart from the latest navigator", "navigatorLineage.pendingSuccession");
    }
    if (pendingSuccession.nextGeneration !== latest.generation + 1) {
      fail("must create the immediately following generation", "navigatorLineage.pendingSuccession.nextGeneration");
    }
    if (
      pendingSuccession.key !== latest.endedBySuccessionKey
      || pendingSuccession.reason !== latest.successionReason
    ) {
      fail("must match the latest navigator's terminal transition", "navigatorLineage.pendingSuccession");
    }
  }

  return Object.freeze({
    contractVersion: NAVIGATOR_LINEAGE_CONTRACT_VERSION,
    navigators: Object.freeze(navigators),
    pendingSuccession,
  });
}

/** Pure owner of one active navigator and the lineage's immutable history. */
export class NavigatorLineageSystem {
  private navigatorsValue: readonly Readonly<NavigatorRecordV1>[];
  private pendingSuccessionValue: Readonly<NavigatorSuccessionTransitionV1> | null = null;

  constructor(generation = 1) {
    this.navigatorsValue = Object.freeze([
      freezeNavigator({
        id: createNavigatorId(generation),
        generation,
        state: "active",
        createdBySuccessionKey: null,
      }),
    ]);
  }

  static fromSnapshot(value: unknown): NavigatorLineageSystem {
    const system = new NavigatorLineageSystem();
    system.restore(value);
    return system;
  }

  get navigators(): readonly Readonly<NavigatorRecordV1>[] {
    return this.navigatorsValue;
  }

  /** The latest record, including the outgoing navigator during a succession hold. */
  get currentNavigator(): Readonly<NavigatorRecordV1> {
    return this.navigatorsValue[this.navigatorsValue.length - 1];
  }

  get activeNavigator(): Readonly<ActiveNavigatorRecordV1> | undefined {
    const current = this.currentNavigator;
    return current.state === "active" ? current : undefined;
  }

  get pendingSuccession(): Readonly<NavigatorSuccessionTransitionV1> | null {
    return this.pendingSuccessionValue;
  }

  get generation(): number {
    return this.currentNavigator.generation;
  }

  beginSuccession(
    reason: NavigatorSuccessionReason,
    resolutionId: number,
  ): NavigatorSuccessionBeginResult {
    const key = createNavigatorSuccessionKey(reason, resolutionId);
    const completed = this.completedTransition(key);
    if (completed) {
      return Object.freeze({
        status: "already-completed",
        transition: completed.transition,
        navigator: completed.navigator,
      });
    }
    if (this.pendingSuccessionValue) {
      if (this.pendingSuccessionValue.key !== key) {
        throw new RangeError(
          `Cannot begin navigator succession ${key} while ${this.pendingSuccessionValue.key} is pending`,
        );
      }
      return Object.freeze({ status: "already-pending", transition: this.pendingSuccessionValue });
    }

    const active = this.activeNavigator;
    if (!active) throw new RangeError("Navigator lineage has no active navigator to succeed");
    if (!Number.isSafeInteger(active.generation + 1)) {
      throw new RangeError("No safe navigator generation remains");
    }
    const transition = freezeTransition({
      key,
      reason,
      resolutionId,
      fromNavigatorId: active.id,
      fromGeneration: active.generation,
      nextGeneration: active.generation + 1,
    });
    const terminal = reason === "wreck"
      ? freezeNavigator({
          ...active,
          state: "lost",
          successionReason: "wreck",
          endedBySuccessionKey: key,
        })
      : freezeNavigator({
          ...active,
          state: "retired",
          successionReason: "retirement",
          endedBySuccessionKey: key,
        });
    this.navigatorsValue = Object.freeze([
      ...this.navigatorsValue.slice(0, -1),
      terminal,
    ]);
    this.pendingSuccessionValue = transition;
    return Object.freeze({ status: "begun", transition });
  }

  completeSuccession(key: NavigatorSuccessionKey): NavigatorSuccessionCompleteResult {
    if (!isCurrentNavigatorSuccessionKey(key)) {
      throw new RangeError(`Invalid or unsupported navigator succession key ${String(key)}`);
    }
    const completed = this.completedTransition(key);
    if (completed) {
      return Object.freeze({
        status: "already-completed",
        transition: completed.transition,
        navigator: completed.navigator,
      });
    }
    const pending = this.pendingSuccessionValue;
    if (!pending) throw new RangeError(`Navigator succession ${key} is not pending`);
    if (pending.key !== key) {
      throw new RangeError(`Cannot complete navigator succession ${key} while ${pending.key} is pending`);
    }

    const navigator = freezeNavigator({
      id: createNavigatorId(pending.nextGeneration),
      generation: pending.nextGeneration,
      state: "active",
      createdBySuccessionKey: pending.key,
    });
    this.navigatorsValue = Object.freeze([...this.navigatorsValue, navigator]);
    this.pendingSuccessionValue = null;
    return Object.freeze({ status: "completed", transition: pending, navigator });
  }

  snapshot(): NavigatorLineageSnapshotV1 {
    return Object.freeze({
      contractVersion: NAVIGATOR_LINEAGE_CONTRACT_VERSION,
      navigators: this.navigatorsValue,
      pendingSuccession: this.pendingSuccessionValue,
    });
  }

  restore(value: unknown): void {
    const parsed = parseNavigatorLineageSnapshot(value);
    this.navigatorsValue = parsed.navigators;
    this.pendingSuccessionValue = parsed.pendingSuccession;
  }

  private completedTransition(key: NavigatorSuccessionKey): {
    transition: Readonly<NavigatorSuccessionTransitionV1>;
    navigator: Readonly<NavigatorRecordV1>;
  } | undefined {
    const successorIndex = this.navigatorsValue.findIndex((record) => record.createdBySuccessionKey === key);
    if (successorIndex <= 0) return undefined;
    const source = this.navigatorsValue[successorIndex - 1];
    const successor = this.navigatorsValue[successorIndex];
    if (source.state === "active") {
      throw new RangeError(`Navigator succession ${key} has inconsistent historical records`);
    }
    const parsedKey = parseNavigatorSuccessionKey(key);
    if (!parsedKey) throw new RangeError(`Navigator succession ${key} has an invalid key`);
    return {
      transition: freezeTransition({
        key,
        reason: parsedKey.reason,
        resolutionId: parsedKey.resolutionId,
        fromNavigatorId: source.id,
        fromGeneration: source.generation,
        nextGeneration: successor.generation,
      }),
      navigator: successor,
    };
  }
}

function parsePendingSuccession(value: unknown): Readonly<NavigatorSuccessionTransitionV1> {
  const path = "navigatorLineage.pendingSuccession";
  const item = record(value, path);
  const key = currentSuccessionKey(item.key, `${path}.key`);
  const parsedKey = parseNavigatorSuccessionKey(key);
  if (!parsedKey) fail("has an invalid key", `${path}.key`);
  if (!isSuccessionReason(item.reason)) fail("must be wreck or retirement", `${path}.reason`);
  const resolutionId = positiveSafeInteger(item.resolutionId, `${path}.resolutionId`);
  if (parsedKey.reason !== item.reason || parsedKey.resolutionId !== resolutionId) {
    fail("key must match its reason and resolution ID", `${path}.key`);
  }
  return freezeTransition({
    key,
    reason: item.reason,
    resolutionId,
    fromNavigatorId: currentNavigatorId(item.fromNavigatorId, `${path}.fromNavigatorId`),
    fromGeneration: positiveSafeInteger(item.fromGeneration, `${path}.fromGeneration`),
    nextGeneration: positiveSafeInteger(item.nextGeneration, `${path}.nextGeneration`),
  });
}

function freezeNavigator<T extends NavigatorRecordV1>(recordValue: T): Readonly<T> {
  return Object.freeze(recordValue);
}

function freezeTransition(
  transition: NavigatorSuccessionTransitionV1,
): Readonly<NavigatorSuccessionTransitionV1> {
  return Object.freeze(transition);
}

function currentNavigatorId(value: unknown, path: string): NavigatorId {
  if (!isCurrentNavigatorId(value)) fail("has an invalid or unsupported navigator ID", path);
  return value;
}

function currentSuccessionKey(value: unknown, path: string): NavigatorSuccessionKey {
  if (!isCurrentNavigatorSuccessionKey(value)) {
    fail("has an invalid or unsupported navigator succession key", path);
  }
  return value;
}

function nullableSuccessionKey(value: unknown, path: string): NavigatorSuccessionKey | null {
  if (value === null) return null;
  return currentSuccessionKey(value, path);
}

function isSuccessionReason(value: unknown): value is NavigatorSuccessionReason {
  return value === "wreck" || value === "retirement";
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("must be an object", path);
  return value as Record<string, unknown>;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail("must be a positive safe integer", path);
  return value as number;
}

function fail(message: string, path: string): never {
  throw new NavigatorLineageValidationError(message, path);
}
