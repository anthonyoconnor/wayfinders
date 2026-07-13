export const NAVIGATOR_LINEAGE_CONTRACT_VERSION = 3 as const;
export const NAVIGATOR_ID_VERSION = 1 as const;
export const NAVIGATOR_SUCCESSION_KEY_VERSION = 2 as const;
export const NAVIGATOR_VOYAGE_LIMIT = 4 as const;
export const NAVIGATOR_GENERATION_HANDOVER_VERSION = 1 as const;

const navigatorIdBrand: unique symbol = Symbol("NavigatorId");
const navigatorSuccessionKeyBrand: unique symbol = Symbol("NavigatorSuccessionKey");
const NAVIGATOR_ID_PATTERN = /^navigator:v([1-9]\d*):g([1-9]\d*)$/;
const NAVIGATOR_SUCCESSION_KEY_PATTERN =
  /^navigator-succession:v([1-9]\d*):(wreck|tenure):([1-9]\d*)$/;

export type NavigatorId = string & { readonly [navigatorIdBrand]: true };
export type NavigatorSuccessionKey = string & { readonly [navigatorSuccessionKeyBrand]: true };

export const NAVIGATOR_LIFECYCLE_STATES = ["active", "completed", "lost"] as const;
export type NavigatorLifecycleState = (typeof NAVIGATOR_LIFECYCLE_STATES)[number];

export const NAVIGATOR_SUCCESSION_REASONS = ["wreck", "tenure"] as const;
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

interface NavigatorRecordBaseV3 {
  id: NavigatorId;
  generation: number;
  /** Null only for the first navigator in the current lineage. */
  createdBySuccessionKey: NavigatorSuccessionKey | null;
  completedVoyages: number;
}

export interface ActiveNavigatorRecordV3 extends NavigatorRecordBaseV3 {
  state: "active";
  successionReason?: never;
  endedBySuccessionKey?: never;
}

export interface CompletedNavigatorRecordV3 extends NavigatorRecordBaseV3 {
  state: "completed";
  successionReason: "tenure";
  endedBySuccessionKey: NavigatorSuccessionKey;
}

export interface LostNavigatorRecordV3 extends NavigatorRecordBaseV3 {
  state: "lost";
  successionReason: "wreck";
  endedBySuccessionKey: NavigatorSuccessionKey;
}

export type NavigatorRecordV3 =
  | ActiveNavigatorRecordV3
  | CompletedNavigatorRecordV3
  | LostNavigatorRecordV3;

/** Persisted between the visible end of one navigator and creation of the next. */
export interface NavigatorSuccessionTransitionV2 {
  key: NavigatorSuccessionKey;
  reason: NavigatorSuccessionReason;
  resolutionId: number;
  fromNavigatorId: NavigatorId;
  fromGeneration: number;
  nextGeneration: number;
}

export interface NavigatorLineageSnapshotV3 {
  contractVersion: typeof NAVIGATOR_LINEAGE_CONTRACT_VERSION;
  navigators: readonly Readonly<NavigatorRecordV3>[];
  pendingSuccession: Readonly<NavigatorSuccessionTransitionV2> | null;
}

/** Required presentation gate between a terminal navigator and their successor. */
export interface NavigatorGenerationHandoverV1 {
  readonly contractVersion: typeof NAVIGATOR_GENERATION_HANDOVER_VERSION;
  readonly fromNavigatorId: NavigatorId;
  readonly fromGeneration: number;
  readonly nextNavigatorId: NavigatorId;
  readonly nextGeneration: number;
  readonly reason: NavigatorSuccessionReason;
}

export type NavigatorSuccessfulVoyageResult =
  | {
      status: "recorded";
      previousCompletedVoyages: number;
      completedVoyages: number;
      remainingVoyages: number;
      tenureCompleted: false;
      navigator: Readonly<ActiveNavigatorRecordV3>;
    }
  | {
      status: "tenure-completed";
      previousCompletedVoyages: number;
      completedVoyages: typeof NAVIGATOR_VOYAGE_LIMIT;
      remainingVoyages: 0;
      tenureCompleted: true;
      navigator: Readonly<CompletedNavigatorRecordV3>;
      successor: Readonly<ActiveNavigatorRecordV3>;
      transition: Readonly<NavigatorSuccessionTransitionV2>;
    };

export type NavigatorSuccessionBeginResult =
  | {
      status: "begun" | "already-pending";
      transition: Readonly<NavigatorSuccessionTransitionV2>;
    }
  | {
      status: "already-completed";
      transition: Readonly<NavigatorSuccessionTransitionV2>;
      navigator: Readonly<NavigatorRecordV3>;
    };

export interface NavigatorSuccessionCompleteResult {
  status: "completed" | "already-completed";
  transition: Readonly<NavigatorSuccessionTransitionV2>;
  navigator: Readonly<NavigatorRecordV3>;
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
  return `navigator-succession:v${NAVIGATOR_SUCCESSION_KEY_VERSION}:${reason}:${resolutionId}` as NavigatorSuccessionKey;
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
  return parseNavigatorSuccessionKey(value)?.version === NAVIGATOR_SUCCESSION_KEY_VERSION;
}

/** Validates and defensively copies the exact current lineage contract. */
export function parseNavigatorLineageSnapshot(value: unknown): NavigatorLineageSnapshotV3 {
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

  const navigators: Readonly<NavigatorRecordV3>[] = [];
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
    const completedVoyages = navigatorVoyageCount(item.completedVoyages, `${path}.completedVoyages`);
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
      validateVoyageCountForState("active", completedVoyages, path);
      navigators.push(freezeNavigator({
        id,
        generation,
        state: "active",
        createdBySuccessionKey,
        completedVoyages,
      }));
      continue;
    }
    if (item.state !== "completed" && item.state !== "lost") {
      fail("must have lifecycle state active, completed or lost", `${path}.state`);
    }
    const expectedReason: NavigatorSuccessionReason = item.state === "lost" ? "wreck" : "tenure";
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
    if (expectedReason === "tenure" && parsedKey.resolutionId !== generation) {
      fail("tenure resolution ID must match the navigator generation", `${path}.endedBySuccessionKey`);
    }
    if (endedKeys.has(endedBySuccessionKey)) {
      fail("must end at most one navigator", `${path}.endedBySuccessionKey`);
    }
    endedKeys.add(endedBySuccessionKey);
    validateVoyageCountForState(item.state, completedVoyages, path);
    navigators.push(freezeNavigator({
      id,
      generation,
      state: item.state,
      successionReason: expectedReason,
      endedBySuccessionKey,
      createdBySuccessionKey,
      completedVoyages,
    } as CompletedNavigatorRecordV3 | LostNavigatorRecordV3));
  }

  if (navigators[0].generation !== 1) {
    fail("the lineage must begin with generation 1", "navigatorLineage.navigators[0].generation");
  }
  if (navigators[0].createdBySuccessionKey !== null) {
    fail("the first navigator cannot have a predecessor", "navigatorLineage.navigators[0].createdBySuccessionKey");
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
  private navigatorsValue: readonly Readonly<NavigatorRecordV3>[];
  private pendingSuccessionValue: Readonly<NavigatorSuccessionTransitionV2> | null = null;

  constructor() {
    this.navigatorsValue = Object.freeze([
      freezeNavigator({
        id: createNavigatorId(1),
        generation: 1,
        state: "active",
        createdBySuccessionKey: null,
        completedVoyages: 0,
      }),
    ]);
  }

  static fromSnapshot(value: unknown): NavigatorLineageSystem {
    const system = new NavigatorLineageSystem();
    system.restore(value);
    return system;
  }

  get navigators(): readonly Readonly<NavigatorRecordV3>[] {
    return this.navigatorsValue;
  }

  /** The latest record, including the outgoing navigator during a succession hold. */
  get currentNavigator(): Readonly<NavigatorRecordV3> {
    return this.navigatorsValue[this.navigatorsValue.length - 1];
  }

  get activeNavigator(): Readonly<ActiveNavigatorRecordV3> | undefined {
    const current = this.currentNavigator;
    return current.state === "active" ? current : undefined;
  }

  get pendingSuccession(): Readonly<NavigatorSuccessionTransitionV2> | null {
    return this.pendingSuccessionValue;
  }

  get generation(): number {
    return this.currentNavigator.generation;
  }

  get totalCompletedVoyages(): number {
    return this.navigatorsValue.reduce((total, navigator) => total + navigator.completedVoyages, 0);
  }

  get lostNavigatorCount(): number {
    return this.navigatorsValue.reduce(
      (total, navigator) => total + (navigator.state === "lost" ? 1 : 0),
      0,
    );
  }

  completeSuccessfulVoyage(): NavigatorSuccessfulVoyageResult {
    const active = this.requireActiveNavigator();
    if (active.completedVoyages >= NAVIGATOR_VOYAGE_LIMIT) {
      throw new RangeError("Navigator has already completed the four-voyage tenure");
    }
    const previousCompletedVoyages = active.completedVoyages;
    const completedVoyages = previousCompletedVoyages + 1;
    const navigator = freezeNavigator<ActiveNavigatorRecordV3>({ ...active, completedVoyages });
    this.replaceActiveNavigator(navigator);

    if (completedVoyages < NAVIGATOR_VOYAGE_LIMIT) {
      return Object.freeze({
        status: "recorded",
        previousCompletedVoyages,
        completedVoyages,
        remainingVoyages: NAVIGATOR_VOYAGE_LIMIT - completedVoyages,
        tenureCompleted: false,
        navigator,
      });
    }

    const begun = this.beginSuccession("tenure", active.generation);
    if (begun.status !== "begun") {
      throw new RangeError("Navigator tenure succession was not begun exactly once");
    }
    const completed = this.completeSuccession(begun.transition.key);
    const terminal = this.navigatorsValue[this.navigatorsValue.length - 2];
    if (terminal?.state !== "completed" || completed.navigator.state !== "active") {
      throw new RangeError("Navigator tenure succession produced inconsistent lifecycle records");
    }
    return Object.freeze({
      status: "tenure-completed",
      previousCompletedVoyages,
      completedVoyages: NAVIGATOR_VOYAGE_LIMIT,
      remainingVoyages: 0,
      tenureCompleted: true,
      navigator: terminal,
      successor: completed.navigator,
      transition: completed.transition,
    });
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
    this.validateSuccessionChoice(active, reason);
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
          state: "completed",
          successionReason: "tenure",
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
      completedVoyages: 0,
    });
    this.navigatorsValue = Object.freeze([...this.navigatorsValue, navigator]);
    this.pendingSuccessionValue = null;
    return Object.freeze({ status: "completed", transition: pending, navigator });
  }

  snapshot(): NavigatorLineageSnapshotV3 {
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
    transition: Readonly<NavigatorSuccessionTransitionV2>;
    navigator: Readonly<NavigatorRecordV3>;
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

  private requireActiveNavigator(): Readonly<ActiveNavigatorRecordV3> {
    const active = this.activeNavigator;
    if (!active) throw new RangeError("Navigator lineage has no active navigator");
    return active;
  }

  private replaceActiveNavigator(navigator: Readonly<ActiveNavigatorRecordV3>): void {
    this.navigatorsValue = Object.freeze([
      ...this.navigatorsValue.slice(0, -1),
      navigator,
    ]);
  }

  private validateSuccessionChoice(
    active: Readonly<ActiveNavigatorRecordV3>,
    reason: NavigatorSuccessionReason,
  ): void {
    if (reason === "tenure") {
      if (active.completedVoyages !== NAVIGATOR_VOYAGE_LIMIT) {
        throw new RangeError("Navigator has not completed the four-voyage tenure");
      }
      return;
    }
    if (active.completedVoyages >= NAVIGATOR_VOYAGE_LIMIT) {
      throw new RangeError("A navigator cannot wreck after completing the four-voyage tenure");
    }
  }
}

function parsePendingSuccession(value: unknown): Readonly<NavigatorSuccessionTransitionV2> {
  const path = "navigatorLineage.pendingSuccession";
  const item = record(value, path);
  const key = currentSuccessionKey(item.key, `${path}.key`);
  const parsedKey = parseNavigatorSuccessionKey(key);
  if (!parsedKey) fail("has an invalid key", `${path}.key`);
  if (!isSuccessionReason(item.reason)) fail("must be wreck or tenure", `${path}.reason`);
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

function freezeNavigator<T extends NavigatorRecordV3>(recordValue: T): Readonly<T> {
  return Object.freeze(recordValue);
}

function freezeTransition(
  transition: NavigatorSuccessionTransitionV2,
): Readonly<NavigatorSuccessionTransitionV2> {
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
  return value === "wreck" || value === "tenure";
}

function navigatorVoyageCount(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > NAVIGATOR_VOYAGE_LIMIT) {
    fail(`must be an integer from 0 through ${NAVIGATOR_VOYAGE_LIMIT}`, path);
  }
  return value as number;
}

function validateVoyageCountForState(
  state: NavigatorLifecycleState,
  completedVoyages: number,
  path: string,
): void {
  if (state === "completed") {
    if (completedVoyages !== NAVIGATOR_VOYAGE_LIMIT) {
      fail(`must equal ${NAVIGATOR_VOYAGE_LIMIT} for a completed tenure`, `${path}.completedVoyages`);
    }
    return;
  }
  if (completedVoyages >= NAVIGATOR_VOYAGE_LIMIT) {
    fail(`must be less than ${NAVIGATOR_VOYAGE_LIMIT} for an ${state} navigator`, `${path}.completedVoyages`);
  }
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
