import {
  isCurrentFishingShoalId,
  type FishingShoalId,
} from "../exploration/FishingShoalContracts";

export const NAVIGATOR_LINEAGE_CONTRACT_VERSION = 5 as const;
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

export interface NavigatorVoyageAchievementInputV2 {
  readonly expeditionId: number;
  readonly supportedTileCount: number;
  readonly closedUnknownTileCount: number;
  readonly islandLeadIds: readonly number[];
  readonly islandDossierIds: readonly number[];
  readonly fishingLeadIds: readonly FishingShoalId[];
  readonly fishingSurveyIds: readonly FishingShoalId[];
  readonly wreckIds: readonly number[];
}

export interface NavigatorVoyageAchievementRecordV2 extends NavigatorVoyageAchievementInputV2 {
  readonly voyageNumber: number;
}

interface NavigatorRecordBaseV5 {
  id: NavigatorId;
  generation: number;
  /** Null only for the first navigator in the current lineage. */
  createdBySuccessionKey: NavigatorSuccessionKey | null;
  completedVoyages: number;
  /** Exact-dock-committed results, in numbered voyage order. */
  successfulVoyages: readonly Readonly<NavigatorVoyageAchievementRecordV2>[];
}

export interface ActiveNavigatorRecordV5 extends NavigatorRecordBaseV5 {
  state: "active";
  successionReason?: never;
  endedBySuccessionKey?: never;
}

export interface CompletedNavigatorRecordV5 extends NavigatorRecordBaseV5 {
  state: "completed";
  successionReason: "tenure";
  endedBySuccessionKey: NavigatorSuccessionKey;
}

export interface LostNavigatorRecordV5 extends NavigatorRecordBaseV5 {
  state: "lost";
  successionReason: "wreck";
  endedBySuccessionKey: NavigatorSuccessionKey;
}

export type NavigatorRecordV5 =
  | ActiveNavigatorRecordV5
  | CompletedNavigatorRecordV5
  | LostNavigatorRecordV5;

/** Persisted between the visible end of one navigator and creation of the next. */
export interface NavigatorSuccessionTransitionV2 {
  key: NavigatorSuccessionKey;
  reason: NavigatorSuccessionReason;
  resolutionId: number;
  fromNavigatorId: NavigatorId;
  fromGeneration: number;
  nextGeneration: number;
}

export interface NavigatorLineageSnapshotV5 {
  contractVersion: typeof NAVIGATOR_LINEAGE_CONTRACT_VERSION;
  navigators: readonly Readonly<NavigatorRecordV5>[];
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
      voyage: Readonly<NavigatorVoyageAchievementRecordV2>;
      navigator: Readonly<ActiveNavigatorRecordV5>;
    }
  | {
      status: "tenure-completed";
      previousCompletedVoyages: number;
      completedVoyages: typeof NAVIGATOR_VOYAGE_LIMIT;
      remainingVoyages: 0;
      tenureCompleted: true;
      voyage: Readonly<NavigatorVoyageAchievementRecordV2>;
      navigator: Readonly<CompletedNavigatorRecordV5>;
      successor: Readonly<ActiveNavigatorRecordV5>;
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
      navigator: Readonly<NavigatorRecordV5>;
    };

export interface NavigatorSuccessionCompleteResult {
  status: "completed" | "already-completed";
  transition: Readonly<NavigatorSuccessionTransitionV2>;
  navigator: Readonly<NavigatorRecordV5>;
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
export function parseNavigatorLineageSnapshot(value: unknown): NavigatorLineageSnapshotV5 {
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

  const navigators: Readonly<NavigatorRecordV5>[] = [];
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
    const successfulVoyages = parseSuccessfulVoyages(item.successfulVoyages, completedVoyages, path);
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
        successfulVoyages,
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
      successfulVoyages,
    } as CompletedNavigatorRecordV5 | LostNavigatorRecordV5));
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
  validateVoyageExpeditionOrder(navigators);
  validateIslandAchievementOrder(navigators);

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
  private navigatorsValue: readonly Readonly<NavigatorRecordV5>[];
  private pendingSuccessionValue: Readonly<NavigatorSuccessionTransitionV2> | null = null;

  constructor() {
    this.navigatorsValue = Object.freeze([
      freezeNavigator({
        id: createNavigatorId(1),
        generation: 1,
        state: "active",
        createdBySuccessionKey: null,
        completedVoyages: 0,
        successfulVoyages: Object.freeze([]),
      }),
    ]);
  }

  static fromSnapshot(value: unknown): NavigatorLineageSystem {
    const system = new NavigatorLineageSystem();
    system.restore(value);
    return system;
  }

  get navigators(): readonly Readonly<NavigatorRecordV5>[] {
    return this.navigatorsValue;
  }

  /** The latest record, including the outgoing navigator during a succession hold. */
  get currentNavigator(): Readonly<NavigatorRecordV5> {
    return this.navigatorsValue[this.navigatorsValue.length - 1];
  }

  get activeNavigator(): Readonly<ActiveNavigatorRecordV5> | undefined {
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

  completeSuccessfulVoyage(
    achievements: Readonly<NavigatorVoyageAchievementInputV2>,
  ): NavigatorSuccessfulVoyageResult {
    const active = this.requireActiveNavigator();
    if (active.completedVoyages >= NAVIGATOR_VOYAGE_LIMIT) {
      throw new RangeError("Navigator has already completed the four-voyage tenure");
    }
    const previousCompletedVoyages = active.completedVoyages;
    const completedVoyages = previousCompletedVoyages + 1;
    const successfulVoyage = freezeVoyageAchievementInput(achievements, completedVoyages);
    const expectedExpeditionId = validateVoyageExpeditionOrder(this.navigatorsValue);
    if (successfulVoyage.expeditionId !== expectedExpeditionId) {
      throw new RangeError(
        `Successful voyage must use chronological expedition ${expectedExpeditionId}`,
      );
    }
    validateIslandAchievementOrder(this.navigatorsValue, successfulVoyage);
    const navigator = freezeNavigator<ActiveNavigatorRecordV5>({
      ...active,
      completedVoyages,
      successfulVoyages: Object.freeze([...active.successfulVoyages, successfulVoyage]),
    });
    this.replaceActiveNavigator(navigator);

    if (completedVoyages < NAVIGATOR_VOYAGE_LIMIT) {
      return Object.freeze({
        status: "recorded",
        previousCompletedVoyages,
        completedVoyages,
        remainingVoyages: NAVIGATOR_VOYAGE_LIMIT - completedVoyages,
        tenureCompleted: false,
        voyage: successfulVoyage,
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
      voyage: successfulVoyage,
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
      successfulVoyages: Object.freeze([]),
    });
    this.navigatorsValue = Object.freeze([...this.navigatorsValue, navigator]);
    this.pendingSuccessionValue = null;
    return Object.freeze({ status: "completed", transition: pending, navigator });
  }

  snapshot(): NavigatorLineageSnapshotV5 {
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
    navigator: Readonly<NavigatorRecordV5>;
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

  private requireActiveNavigator(): Readonly<ActiveNavigatorRecordV5> {
    const active = this.activeNavigator;
    if (!active) throw new RangeError("Navigator lineage has no active navigator");
    return active;
  }

  private replaceActiveNavigator(navigator: Readonly<ActiveNavigatorRecordV5>): void {
    this.navigatorsValue = Object.freeze([
      ...this.navigatorsValue.slice(0, -1),
      navigator,
    ]);
  }

  private validateSuccessionChoice(
    active: Readonly<ActiveNavigatorRecordV5>,
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

function parseSuccessfulVoyages(
  value: unknown,
  completedVoyages: number,
  navigatorPath: string,
): readonly Readonly<NavigatorVoyageAchievementRecordV2>[] {
  const path = `${navigatorPath}.successfulVoyages`;
  if (!Array.isArray(value)) fail("must be an array", path);
  if (value.length !== completedVoyages) {
    fail("length must equal completedVoyages", path);
  }
  return Object.freeze(value.map((voyage, index) => (
    parseVoyageAchievement(voyage, index + 1, `${path}[${index}]`)
  )));
}

function parseVoyageAchievement(
  value: unknown,
  expectedVoyageNumber: number,
  path: string,
): Readonly<NavigatorVoyageAchievementRecordV2> {
  const item = record(value, path);
  const voyageNumber = positiveSafeInteger(item.voyageNumber, `${path}.voyageNumber`);
  if (voyageNumber !== expectedVoyageNumber) {
    fail(`must be voyage ${expectedVoyageNumber}`, `${path}.voyageNumber`);
  }
  const expeditionId = positiveUint32(item.expeditionId, `${path}.expeditionId`);
  const supportedTileCount = nonNegativeSafeInteger(
    item.supportedTileCount,
    `${path}.supportedTileCount`,
  );
  const closedUnknownTileCount = nonNegativeSafeInteger(
    item.closedUnknownTileCount,
    `${path}.closedUnknownTileCount`,
  );
  const islandLeadIds = positiveIntegerArray(item.islandLeadIds, `${path}.islandLeadIds`);
  const islandDossierIds = positiveIntegerArray(item.islandDossierIds, `${path}.islandDossierIds`);
  const fishingLeadIds = fishingShoalIdArray(item.fishingLeadIds, `${path}.fishingLeadIds`);
  const fishingSurveyIds = fishingShoalIdArray(item.fishingSurveyIds, `${path}.fishingSurveyIds`);
  const wreckIds = positiveIntegerArray(item.wreckIds, `${path}.wreckIds`);
  const islandLeads = new Set<number>(islandLeadIds);
  for (const id of islandDossierIds) {
    if (islandLeads.has(id)) {
      fail("cannot also be recorded as an island lead", `${path}.islandDossierIds`);
    }
  }
  const leadIds = new Set<string>(fishingLeadIds);
  for (const id of fishingSurveyIds) {
    if (leadIds.has(id)) fail("cannot also be recorded as a fishing lead", `${path}.fishingSurveyIds`);
  }
  return Object.freeze({
    expeditionId,
    voyageNumber,
    supportedTileCount,
    closedUnknownTileCount,
    islandLeadIds,
    islandDossierIds,
    fishingLeadIds,
    fishingSurveyIds,
    wreckIds,
  });
}

function freezeVoyageAchievementInput(
  input: Readonly<NavigatorVoyageAchievementInputV2>,
  voyageNumber: number,
): Readonly<NavigatorVoyageAchievementRecordV2> {
  return parseVoyageAchievement(
    { ...input, voyageNumber },
    voyageNumber,
    `successfulVoyage[${voyageNumber - 1}]`,
  );
}

function validateVoyageExpeditionOrder(
  navigators: readonly Readonly<NavigatorRecordV5>[],
): number {
  let expectedExpeditionId = 1;
  for (let navigatorIndex = 0; navigatorIndex < navigators.length; navigatorIndex++) {
    const navigator = navigators[navigatorIndex];
    for (let voyageIndex = 0; voyageIndex < navigator.successfulVoyages.length; voyageIndex++) {
      const voyage = navigator.successfulVoyages[voyageIndex];
      if (voyage.expeditionId !== expectedExpeditionId) {
        fail(
          `must follow lineage chronology with expedition ${expectedExpeditionId}`,
          `navigatorLineage.navigators[${navigatorIndex}].successfulVoyages[${voyageIndex}].expeditionId`,
        );
      }
      expectedExpeditionId = nextExpeditionId(expectedExpeditionId);
    }
    if (navigator.state === "lost") expectedExpeditionId = nextExpeditionId(expectedExpeditionId);
  }
  return expectedExpeditionId;
}

/**
 * Returned achievements are transition credits, not a restatement of known
 * island state. Keep each transition idempotent across the full lineage while
 * still allowing an earlier lead to become a dossier on a later voyage.
 */
function validateIslandAchievementOrder(
  navigators: readonly Readonly<NavigatorRecordV5>[],
  appendedVoyage?: Readonly<NavigatorVoyageAchievementRecordV2>,
): void {
  const creditedLeadIds = new Set<number>();
  const creditedDossierIds = new Set<number>();
  for (let navigatorIndex = 0; navigatorIndex < navigators.length; navigatorIndex++) {
    const navigator = navigators[navigatorIndex];
    for (let voyageIndex = 0; voyageIndex < navigator.successfulVoyages.length; voyageIndex++) {
      validateIslandAchievementCredits(
        navigator.successfulVoyages[voyageIndex],
        `navigatorLineage.navigators[${navigatorIndex}].successfulVoyages[${voyageIndex}]`,
        creditedLeadIds,
        creditedDossierIds,
      );
    }
  }
  if (appendedVoyage !== undefined) {
    validateIslandAchievementCredits(
      appendedVoyage,
      `successfulVoyage[${appendedVoyage.voyageNumber - 1}]`,
      creditedLeadIds,
      creditedDossierIds,
    );
  }
}

function validateIslandAchievementCredits(
  voyage: Readonly<NavigatorVoyageAchievementRecordV2>,
  path: string,
  creditedLeadIds: Set<number>,
  creditedDossierIds: Set<number>,
): void {
  for (let index = 0; index < voyage.islandLeadIds.length; index++) {
    const id = voyage.islandLeadIds[index];
    const idPath = `${path}.islandLeadIds[${index}]`;
    if (creditedDossierIds.has(id)) {
      fail("cannot record an island lead after its dossier was returned", idPath);
    }
    if (creditedLeadIds.has(id)) {
      fail("must not repeat an island lead returned by an earlier voyage", idPath);
    }
    creditedLeadIds.add(id);
  }
  for (let index = 0; index < voyage.islandDossierIds.length; index++) {
    const id = voyage.islandDossierIds[index];
    if (creditedDossierIds.has(id)) {
      fail(
        "must not repeat an island dossier returned by an earlier voyage",
        `${path}.islandDossierIds[${index}]`,
      );
    }
    creditedDossierIds.add(id);
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

function freezeNavigator<T extends NavigatorRecordV5>(recordValue: T): Readonly<T> {
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

function positiveIntegerArray(value: unknown, path: string): readonly number[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  const result = value.map((item, index) => positiveSafeInteger(item, `${path}[${index}]`));
  validateCanonicalOrder(result, path);
  return Object.freeze(result);
}

function fishingShoalIdArray(value: unknown, path: string): readonly FishingShoalId[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  const result = value.map((item, index) => {
    if (!isCurrentFishingShoalId(item)) fail("must contain current fishing-shoal IDs", `${path}[${index}]`);
    return item;
  });
  validateCanonicalOrder(result, path);
  return Object.freeze(result);
}

function validateCanonicalOrder(values: readonly (number | string)[], path: string): void {
  for (let index = 1; index < values.length; index++) {
    if (values[index - 1] >= values[index]) {
      fail("must be sorted with no duplicates", path);
    }
  }
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

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("must be a non-negative safe integer", path);
  }
  return value as number;
}

function positiveUint32(value: unknown, path: string): number {
  const result = positiveSafeInteger(value, path);
  if (result > 0xffff_ffff) fail("must fit an unsigned 32-bit integer", path);
  return result;
}

function nextExpeditionId(expeditionId: number): number {
  return expeditionId === 0xffff_ffff ? 1 : expeditionId + 1;
}

function fail(message: string, path: string): never {
  throw new NavigatorLineageValidationError(message, path);
}
