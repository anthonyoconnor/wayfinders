import {
  isCurrentFishingShoalId,
  type FishingShoalId,
} from "../fishing";
import {
  isCurrentIdolLocationId,
  type IdolLocationId,
} from "../../exploration/IdolLocationContracts";
import {
  isCurrentSurveySiteId,
  type SurveySiteId,
} from "../../exploration/SurveySiteContracts";
import {
  PROSPERITY_SCORE_CONTRACT_VERSION,
  PROSPERITY_SCORE_SCHEDULE_V1,
  PROSPERITY_SCORE_SCHEDULE_VERSION,
  type PreparedProsperitySettlementV1,
  type PreparedProsperitySourceV1,
  type ProsperityCommitResultV1,
  type ProsperityLedgerEntryV1,
  type ProsperityScoreCatalogV1,
  type ProsperityScoreSnapshotV1,
  type ProsperitySettlementInputV1,
  type ProsperitySourceKey,
  type ProsperitySourceKind,
  type ProsperitySourceRefV1,
} from "./ProsperityScoreContracts";

type ProsperityTarget = ProsperitySourceRefV1 & Readonly<{
  readonly key: ProsperitySourceKey;
  readonly targetValue: number;
}>;

const SETTLEMENT_FIELDS = Object.freeze([
  "confirmedWreckIds",
  "contractVersion",
  "fishingLeadIds",
  "fishingSurveyIds",
  "idolLocationIds",
  "islandDossierIds",
  "islandLeadIds",
  "surveySiteLeadIds",
  "surveySiteReportIds",
] as const);

export class ProsperityScoreValidationError extends RangeError {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "ProsperityScoreValidationError";
  }
}

/** Authoritative, session-scoped hidden Prosperity score and monotonic source ledger. */
export class ProsperityScoreSystem {
  private readonly islandFinalValueById = new Map<number, number>();
  private readonly surveySiteIds = new Set<SurveySiteId>();
  private readonly fishingFinalValueById = new Map<FishingShoalId, number>();
  private readonly idolLocationIds = new Set<IdolLocationId>();
  private ledgerValue = new Map<ProsperitySourceKey, Readonly<ProsperityLedgerEntryV1>>();
  private scoreValue = 0;
  private revisionValue = 0;
  private snapshotValue: Readonly<ProsperityScoreSnapshotV1>;

  constructor(catalog: Readonly<ProsperityScoreCatalogV1>) {
    this.validateCatalog(catalog);
    this.snapshotValue = this.buildSnapshot();
  }

  get score(): number {
    return this.scoreValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  snapshot(): Readonly<ProsperityScoreSnapshotV1> {
    return this.snapshotValue;
  }

  /** Pure with respect to score authority: validates and freezes a prospective exact-return plan. */
  prepareSettlement(
    input: Readonly<ProsperitySettlementInputV1>,
  ): Readonly<PreparedProsperitySettlementV1> {
    const targets = this.targetsFor(input);
    const sources = targets.map((target): Readonly<PreparedProsperitySourceV1> => {
      const previousValue = this.ledgerValue.get(target.key)?.value ?? 0;
      const delta = Math.max(0, target.targetValue - previousValue);
      return Object.freeze({
        key: target.key,
        kind: target.kind,
        sourceId: target.sourceId,
        previousValue,
        targetValue: target.targetValue,
        delta,
      }) as Readonly<PreparedProsperitySourceV1>;
    });
    const delta = sources.reduce(
      (total, source, index) => safeAdd(total, source.delta, `settlement.sources[${index}].delta`),
      0,
    );
    const score = safeAdd(this.scoreValue, delta, "settlement.score");
    if (delta > 0) safeIncrement(this.revisionValue, "settlement.revision");
    return Object.freeze({
      contractVersion: PROSPERITY_SCORE_CONTRACT_VERSION,
      scheduleVersion: PROSPERITY_SCORE_SCHEDULE_VERSION,
      baseRevision: this.revisionValue,
      previousScore: this.scoreValue,
      score,
      delta,
      sources: Object.freeze(sources),
    });
  }

  /** Applies one already-prepared exact-dock settlement without partial mutation. */
  commitSettlement(
    prepared: Readonly<PreparedProsperitySettlementV1>,
  ): Readonly<ProsperityCommitResultV1> {
    const plan = this.validatePreparedSettlement(prepared);
    const stale = plan.baseRevision !== this.revisionValue || plan.previousScore !== this.scoreValue;
    if (stale) {
      const alreadyApplied = plan.sources.every((source) => (
        (this.ledgerValue.get(source.key)?.value ?? 0) >= source.targetValue
      ));
      if (alreadyApplied) return this.unchangedResult();
      fail("was prepared from stale Prosperity authority", "settlement.baseRevision");
    }

    const nextLedger = new Map(this.ledgerValue);
    const changedSources: Readonly<ProsperityLedgerEntryV1>[] = [];
    let delta = 0;
    for (let index = 0; index < plan.sources.length; index++) {
      const source = plan.sources[index];
      const currentValue = this.ledgerValue.get(source.key)?.value ?? 0;
      if (currentValue !== source.previousValue) {
        fail("does not match the current source ledger", `settlement.sources[${index}].previousValue`);
      }
      if (source.targetValue <= currentValue) continue;
      const sourceDelta = source.targetValue - currentValue;
      delta = safeAdd(delta, sourceDelta, `settlement.sources[${index}].delta`);
      const entry = Object.freeze({
        key: source.key,
        kind: source.kind,
        sourceId: source.sourceId,
        value: source.targetValue,
      }) as Readonly<ProsperityLedgerEntryV1>;
      nextLedger.set(source.key, entry);
      changedSources.push(entry);
    }
    if (delta !== plan.delta) fail("delta no longer matches its prepared sources", "settlement.delta");
    if (delta === 0) return this.unchangedResult();

    const nextScore = safeAdd(this.scoreValue, delta, "settlement.score");
    if (nextScore !== plan.score) fail("score no longer matches its prepared sources", "settlement.score");
    const nextRevision = safeIncrement(this.revisionValue, "settlement.revision");
    const previousScore = this.scoreValue;
    this.ledgerValue = nextLedger;
    this.scoreValue = nextScore;
    this.revisionValue = nextRevision;
    this.snapshotValue = this.buildSnapshot();
    return Object.freeze({
      status: "applied",
      previousScore,
      score: this.scoreValue,
      delta,
      revision: this.revisionValue,
      changedSources: Object.freeze(changedSources),
      snapshot: this.snapshotValue,
    });
  }

  private targetsFor(input: Readonly<ProsperitySettlementInputV1>): ProsperityTarget[] {
    const root = asRecord(input, "settlement");
    validateExactFields(root, SETTLEMENT_FIELDS, "settlement");
    if (root.contractVersion !== PROSPERITY_SCORE_CONTRACT_VERSION) {
      fail(`must use contract version ${PROSPERITY_SCORE_CONTRACT_VERSION}`, "settlement.contractVersion");
    }
    const targets = new Map<ProsperitySourceKey, ProsperityTarget>();
    const add = (ref: ProsperitySourceRefV1, targetValue: number): void => {
      const key = createSourceKey(ref.kind, ref.sourceId);
      const previous = targets.get(key);
      if (previous && previous.targetValue >= targetValue) return;
      targets.set(key, { ...ref, key, targetValue } as ProsperityTarget);
    };

    for (const islandId of numberIds(root.islandLeadIds, "settlement.islandLeadIds")) {
      this.islandValue(islandId, "settlement.islandLeadIds");
      add({ kind: "island", sourceId: islandId }, PROSPERITY_SCORE_SCHEDULE_V1.island.lead);
    }
    for (const islandId of numberIds(root.islandDossierIds, "settlement.islandDossierIds")) {
      add({ kind: "island", sourceId: islandId }, this.islandValue(islandId, "settlement.islandDossierIds"));
    }
    for (const id of surveySiteIds(root.surveySiteLeadIds, "settlement.surveySiteLeadIds")) {
      this.requireSurveySite(id, "settlement.surveySiteLeadIds");
      add({ kind: "survey-site", sourceId: id }, PROSPERITY_SCORE_SCHEDULE_V1.surveySite.lead);
    }
    for (const id of surveySiteIds(root.surveySiteReportIds, "settlement.surveySiteReportIds")) {
      this.requireSurveySite(id, "settlement.surveySiteReportIds");
      add({ kind: "survey-site", sourceId: id }, PROSPERITY_SCORE_SCHEDULE_V1.surveySite.report);
    }
    for (const id of fishingShoalIds(root.fishingLeadIds, "settlement.fishingLeadIds")) {
      this.fishingValue(id, "settlement.fishingLeadIds");
      add({ kind: "fishing-shoal", sourceId: id }, PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.lead);
    }
    for (const id of fishingShoalIds(root.fishingSurveyIds, "settlement.fishingSurveyIds")) {
      add({ kind: "fishing-shoal", sourceId: id }, this.fishingValue(id, "settlement.fishingSurveyIds"));
    }
    for (const wreckId of numberIds(root.confirmedWreckIds, "settlement.confirmedWreckIds")) {
      add(
        { kind: "navigator-wreck", sourceId: wreckId },
        PROSPERITY_SCORE_SCHEDULE_V1.navigatorWreck.confirmedReport,
      );
    }
    for (const id of idolLocationIds(root.idolLocationIds, "settlement.idolLocationIds")) {
      if (!this.idolLocationIds.has(id)) fail(`references unknown idol location ${id}`, "settlement.idolLocationIds");
      add({ kind: "idol-location", sourceId: id }, PROSPERITY_SCORE_SCHEDULE_V1.idolLocation.returned);
    }
    return [...targets.values()].sort((left, right) => compareKeys(left.key, right.key));
  }

  private validatePreparedSettlement(
    prepared: Readonly<PreparedProsperitySettlementV1>,
  ): Readonly<PreparedProsperitySettlementV1> {
    const root = asRecord(prepared, "settlement");
    validateExactFields(root, [
      "baseRevision", "contractVersion", "delta", "previousScore", "scheduleVersion", "score", "sources",
    ], "settlement");
    if (root.contractVersion !== PROSPERITY_SCORE_CONTRACT_VERSION) {
      fail(`must use contract version ${PROSPERITY_SCORE_CONTRACT_VERSION}`, "settlement.contractVersion");
    }
    if (root.scheduleVersion !== PROSPERITY_SCORE_SCHEDULE_VERSION) {
      fail(`must use schedule version ${PROSPERITY_SCORE_SCHEDULE_VERSION}`, "settlement.scheduleVersion");
    }
    const baseRevision = nonNegativeSafeInteger(root.baseRevision, "settlement.baseRevision");
    const previousScore = nonNegativeSafeInteger(root.previousScore, "settlement.previousScore");
    const score = nonNegativeSafeInteger(root.score, "settlement.score");
    const declaredDelta = nonNegativeSafeInteger(root.delta, "settlement.delta");
    if (!Array.isArray(root.sources)) fail("must be an array", "settlement.sources");
    const seen = new Set<string>();
    let previousKey: string | undefined;
    let delta = 0;
    const sources = root.sources.map((raw, index): Readonly<PreparedProsperitySourceV1> => {
      const path = `settlement.sources[${index}]`;
      const source = asRecord(raw, path);
      validateExactFields(source, [
        "delta", "key", "kind", "previousValue", "sourceId", "targetValue",
      ], path);
      const ref = this.validateSourceRef(source.kind, source.sourceId, path);
      const key = createSourceKey(ref.kind, ref.sourceId);
      if (source.key !== key) fail(`must use canonical key ${key}`, `${path}.key`);
      if (seen.has(key)) fail("duplicates a prepared source", `${path}.key`);
      if (previousKey !== undefined && compareKeys(previousKey, key) >= 0) {
        fail("must use stable source-key order", "settlement.sources");
      }
      seen.add(key);
      previousKey = key;
      const previousValue = nonNegativeSafeInteger(source.previousValue, `${path}.previousValue`);
      const targetValue = nonNegativeSafeInteger(source.targetValue, `${path}.targetValue`);
      this.validateCanonicalTarget(ref, targetValue, `${path}.targetValue`);
      const sourceDelta = nonNegativeSafeInteger(source.delta, `${path}.delta`);
      if (sourceDelta !== Math.max(0, targetValue - previousValue)) {
        fail("must equal the monotonic cumulative-value increase", `${path}.delta`);
      }
      delta = safeAdd(delta, sourceDelta, `${path}.delta`);
      return Object.freeze({
        key,
        kind: ref.kind,
        sourceId: ref.sourceId,
        previousValue,
        targetValue,
        delta: sourceDelta,
      }) as Readonly<PreparedProsperitySourceV1>;
    });
    if (delta !== declaredDelta) fail("does not match its prepared sources", "settlement.delta");
    if (safeAdd(previousScore, delta, "settlement.score") !== score) {
      fail("must equal previousScore plus delta", "settlement.score");
    }
    return Object.freeze({
      contractVersion: PROSPERITY_SCORE_CONTRACT_VERSION,
      scheduleVersion: PROSPERITY_SCORE_SCHEDULE_VERSION,
      baseRevision,
      previousScore,
      score,
      delta,
      sources: Object.freeze(sources),
    });
  }

  private validateSourceRef(kind: unknown, sourceId: unknown, path: string): ProsperitySourceRefV1 {
    if (kind === "island") {
      const id = positiveSafeInteger(sourceId, `${path}.sourceId`);
      this.islandValue(id, `${path}.sourceId`);
      return Object.freeze({ kind, sourceId: id });
    }
    if (kind === "survey-site") {
      if (!isCurrentSurveySiteId(sourceId)) fail("must use a current survey-site ID", `${path}.sourceId`);
      this.requireSurveySite(sourceId, `${path}.sourceId`);
      return Object.freeze({ kind, sourceId });
    }
    if (kind === "fishing-shoal") {
      if (!isCurrentFishingShoalId(sourceId)) fail("must use a current fishing-shoal ID", `${path}.sourceId`);
      this.fishingValue(sourceId, `${path}.sourceId`);
      return Object.freeze({ kind, sourceId });
    }
    if (kind === "navigator-wreck") {
      return Object.freeze({ kind, sourceId: positiveSafeInteger(sourceId, `${path}.sourceId`) });
    }
    if (kind === "idol-location") {
      if (!isCurrentIdolLocationId(sourceId)) fail("must use a current idol-location ID", `${path}.sourceId`);
      if (!this.idolLocationIds.has(sourceId)) fail(`references unknown idol location ${sourceId}`, `${path}.sourceId`);
      return Object.freeze({ kind, sourceId });
    }
    fail("has an unsupported source kind", `${path}.kind`);
  }

  private validateCanonicalTarget(ref: ProsperitySourceRefV1, targetValue: number, path: string): void {
    let values: readonly number[];
    switch (ref.kind) {
      case "island":
        values = [PROSPERITY_SCORE_SCHEDULE_V1.island.lead, this.islandValue(ref.sourceId, path)];
        break;
      case "survey-site":
        values = [PROSPERITY_SCORE_SCHEDULE_V1.surveySite.lead, PROSPERITY_SCORE_SCHEDULE_V1.surveySite.report];
        break;
      case "fishing-shoal":
        values = [PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.lead, this.fishingValue(ref.sourceId, path)];
        break;
      case "navigator-wreck":
        values = [PROSPERITY_SCORE_SCHEDULE_V1.navigatorWreck.confirmedReport];
        break;
      case "idol-location":
        values = [PROSPERITY_SCORE_SCHEDULE_V1.idolLocation.returned];
        break;
    }
    if (!values.includes(targetValue)) fail("is not a canonical cumulative source value", path);
  }

  private validateCatalog(catalog: Readonly<ProsperityScoreCatalogV1>): void {
    const root = asRecord(catalog, "catalog");
    validateExactFields(root, ["fishingShoals", "idolLocations", "islandDossiers", "surveySites"], "catalog");
    if (!Array.isArray(root.islandDossiers)) fail("must be an array", "catalog.islandDossiers");
    for (let index = 0; index < root.islandDossiers.length; index++) {
      const path = `catalog.islandDossiers[${index}]`;
      const definition = asRecord(root.islandDossiers[index], path);
      const islandId = positiveSafeInteger(definition.islandId, `${path}.islandId`);
      const finalValue = PROSPERITY_SCORE_SCHEDULE_V1.island.dossierBySize[
        definition.size as keyof typeof PROSPERITY_SCORE_SCHEDULE_V1.island.dossierBySize
      ];
      if (finalValue === undefined) fail("has an unsupported island size", `${path}.size`);
      if (this.islandFinalValueById.has(islandId)) fail(`duplicates island ${islandId}`, `${path}.islandId`);
      this.islandFinalValueById.set(islandId, finalValue);
    }
    if (!Array.isArray(root.surveySites)) fail("must be an array", "catalog.surveySites");
    for (let index = 0; index < root.surveySites.length; index++) {
      const path = `catalog.surveySites[${index}].id`;
      const definition = asRecord(root.surveySites[index], `catalog.surveySites[${index}]`);
      if (!isCurrentSurveySiteId(definition.id)) fail("must use a current survey-site ID", path);
      if (this.surveySiteIds.has(definition.id)) fail(`duplicates survey site ${definition.id}`, path);
      this.surveySiteIds.add(definition.id);
    }
    if (!Array.isArray(root.fishingShoals)) fail("must be an array", "catalog.fishingShoals");
    for (let index = 0; index < root.fishingShoals.length; index++) {
      const path = `catalog.fishingShoals[${index}]`;
      const definition = asRecord(root.fishingShoals[index], path);
      if (!isCurrentFishingShoalId(definition.id)) fail("must use a current fishing-shoal ID", `${path}.id`);
      const finalValue = PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.surveyByQuality[
        definition.quality as keyof typeof PROSPERITY_SCORE_SCHEDULE_V1.fishingShoal.surveyByQuality
      ];
      if (finalValue === undefined) fail("has an unsupported fishing quality", `${path}.quality`);
      if (this.fishingFinalValueById.has(definition.id)) fail(`duplicates fishing shoal ${definition.id}`, `${path}.id`);
      this.fishingFinalValueById.set(definition.id, finalValue);
    }
    if (!Array.isArray(root.idolLocations)) fail("must be an array", "catalog.idolLocations");
    for (let index = 0; index < root.idolLocations.length; index++) {
      const path = `catalog.idolLocations[${index}].id`;
      const definition = asRecord(root.idolLocations[index], `catalog.idolLocations[${index}]`);
      if (!isCurrentIdolLocationId(definition.id)) fail("must use a current idol-location ID", path);
      if (this.idolLocationIds.has(definition.id)) fail(`duplicates idol location ${definition.id}`, path);
      this.idolLocationIds.add(definition.id);
    }
  }

  private islandValue(id: number, path: string): number {
    const value = this.islandFinalValueById.get(id);
    if (value === undefined) fail(`references unknown island ${id}`, path);
    return value;
  }

  private requireSurveySite(id: SurveySiteId, path: string): void {
    if (!this.surveySiteIds.has(id)) fail(`references unknown survey site ${id}`, path);
  }

  private fishingValue(id: FishingShoalId, path: string): number {
    const value = this.fishingFinalValueById.get(id);
    if (value === undefined) fail(`references unknown fishing shoal ${id}`, path);
    return value;
  }

  private unchangedResult(): Readonly<ProsperityCommitResultV1> {
    return Object.freeze({
      status: "unchanged",
      previousScore: this.scoreValue,
      score: this.scoreValue,
      delta: 0,
      revision: this.revisionValue,
      changedSources: Object.freeze([]),
      snapshot: this.snapshotValue,
    });
  }

  private buildSnapshot(): Readonly<ProsperityScoreSnapshotV1> {
    const ledger = [...this.ledgerValue.values()]
      .sort((left, right) => compareKeys(left.key, right.key))
      .map((entry) => Object.freeze({ ...entry }) as Readonly<ProsperityLedgerEntryV1>);
    return Object.freeze({
      contractVersion: PROSPERITY_SCORE_CONTRACT_VERSION,
      scheduleVersion: PROSPERITY_SCORE_SCHEDULE_VERSION,
      score: this.scoreValue,
      revision: this.revisionValue,
      ledger: Object.freeze(ledger),
    });
  }
}

function createSourceKey(kind: ProsperitySourceKind, sourceId: number | string): ProsperitySourceKey {
  return `prosperity:v${PROSPERITY_SCORE_CONTRACT_VERSION}:${kind}:${sourceId}` as ProsperitySourceKey;
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function numberIds(value: unknown, path: string): readonly number[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  return value.map((id, index) => positiveSafeInteger(id, `${path}[${index}]`));
}

function surveySiteIds(value: unknown, path: string): readonly SurveySiteId[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  return value.map((id, index) => {
    if (!isCurrentSurveySiteId(id)) fail("must use a current survey-site ID", `${path}[${index}]`);
    return id;
  });
}

function fishingShoalIds(value: unknown, path: string): readonly FishingShoalId[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  return value.map((id, index) => {
    if (!isCurrentFishingShoalId(id)) fail("must use a current fishing-shoal ID", `${path}[${index}]`);
    return id;
  });
}

function idolLocationIds(value: unknown, path: string): readonly IdolLocationId[] {
  if (!Array.isArray(value)) fail("must be an array", path);
  return value.map((id, index) => {
    if (!isCurrentIdolLocationId(id)) fail("must use a current idol-location ID", `${path}[${index}]`);
    return id;
  });
}

function validateExactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    const unsupported = actual.filter((field) => !expected.includes(field));
    if (unsupported.length > 0) fail(`contains unsupported field ${unsupported[0]}`, `${path}.${unsupported[0]}`);
    const missing = expected.find((field) => !actual.includes(field));
    fail(`is missing required field ${String(missing)}`, path);
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("must be an object", path);
  return value as Record<string, unknown>;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail("must be a positive safe integer", path);
  return value as number;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("must be a non-negative safe integer", path);
  return value as number;
}

function safeAdd(left: number, right: number, path: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) fail("must remain a non-negative safe integer", path);
  return result;
}

function safeIncrement(value: number, path: string): number {
  return safeAdd(value, 1, path);
}

function fail(message: string, path: string): never {
  throw new ProsperityScoreValidationError(message, path);
}
