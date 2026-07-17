import { ReturnRiskLevel } from "../exploration/ReturnPathSystem";

export type CargoCommitmentKind = "uncommitted" | "return" | "survey" | "depleted";

export interface CargoBundleSlice {
  readonly kind: CargoCommitmentKind;
  /** Inclusive horizontal position within one bundle, from zero to one. */
  readonly start: number;
  /** Exclusive horizontal position within one bundle, from zero to one. */
  readonly end: number;
}

export interface CargoBundlePresentation {
  readonly index: number;
  readonly slices: readonly CargoBundleSlice[];
}

export interface CargoSurveyCommitment {
  readonly cost: number;
  readonly projectedReturnRiskLevel: ReturnRiskLevel;
}

export interface CargoPresentationInput {
  readonly physicalBundles: number;
  readonly availableProvisionUnits: number;
  readonly returnCost: number | null;
  readonly returnRiskLevel: ReturnRiskLevel;
  readonly survey?: Readonly<CargoSurveyCommitment>;
}

export interface CargoPresentationModel {
  readonly physicalBundles: number;
  readonly availableProvisionUnits: number;
  readonly returnCost: number | null;
  readonly returnRiskLevel: ReturnRiskLevel;
  readonly surveyCost: number;
  readonly surveyShortfall: number;
  readonly returnShortfall: number;
  readonly uncommittedProvisionUnits: number;
  readonly bundles: readonly CargoBundlePresentation[];
  readonly statusText: string;
  readonly signature: string;
}

interface CommitmentInterval {
  readonly kind: CargoCommitmentKind;
  readonly start: number;
  readonly end: number;
}

const EPSILON = 1e-9;

/** Cool sea-glass cyan, intentionally outside the Voyage Sense risk palette. */
export const CARGO_SURVEY_COLOR = 0x65cfe0;

export function cargoReturnColor(level: ReturnRiskLevel): number {
  switch (level) {
    case ReturnRiskLevel.Comfortable: return 0x5bb874;
    case ReturnRiskLevel.Warning: return 0xe2c44a;
    case ReturnRiskLevel.Critical: return 0xee7d24;
    case ReturnRiskLevel.Impossible: return 0xc42624;
    case ReturnRiskLevel.Hidden: return 0x72573c;
  }
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function displayUnits(value: number): string {
  return value.toFixed(3).replace(/\.000$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function bundleSlices(index: number, intervals: readonly CommitmentInterval[]): CargoBundleSlice[] {
  const slices: CargoBundleSlice[] = [];
  for (const interval of intervals) {
    const start = bounded(interval.start - index, 0, 1);
    const end = bounded(interval.end - index, 0, 1);
    if (end - start <= EPSILON) continue;
    slices.push(Object.freeze({ kind: interval.kind, start, end }));
  }
  return slices;
}

export function buildCargoPresentation(input: Readonly<CargoPresentationInput>): CargoPresentationModel {
  if (!Number.isSafeInteger(input.physicalBundles) || input.physicalBundles < 0) {
    throw new RangeError("Physical provision bundles must be a non-negative safe integer");
  }
  if (!Number.isFinite(input.availableProvisionUnits) || input.availableProvisionUnits < 0) {
    throw new RangeError("Available provision units must be finite and non-negative");
  }
  if (input.survey && (!Number.isFinite(input.survey.cost) || input.survey.cost <= 0)) {
    throw new RangeError("Survey commitment cost must be finite and positive");
  }
  if (input.returnCost !== null && (!Number.isFinite(input.returnCost) || input.returnCost < 0)) {
    throw new RangeError("Return commitment cost must be finite and non-negative");
  }

  const physicalBundles = input.physicalBundles;
  const available = bounded(input.availableProvisionUnits, 0, physicalBundles);
  const surveyCost = input.survey?.cost ?? 0;
  const surveyStart = Math.max(0, available - surveyCost);
  const surveyShortfall = Math.max(0, surveyCost - available);
  const knownReturn = input.returnCost !== null && input.returnRiskLevel !== ReturnRiskLevel.Hidden;
  const returnCost = knownReturn ? input.returnCost : null;
  const returnBudgetEnd = input.survey ? surveyStart : available;
  const returnStart = returnCost === null ? returnBudgetEnd : Math.max(0, returnBudgetEnd - returnCost);
  const returnShortfall = returnCost === null ? 0 : Math.max(0, returnCost - returnBudgetEnd);
  const returnRiskLevel = input.survey
    ? input.survey.projectedReturnRiskLevel
    : input.returnRiskLevel;
  const intervals: CommitmentInterval[] = [];
  if (returnStart > EPSILON) intervals.push({ kind: "uncommitted", start: 0, end: returnStart });
  if (returnCost !== null && returnBudgetEnd - returnStart > EPSILON) {
    intervals.push({ kind: "return", start: returnStart, end: returnBudgetEnd });
  } else if (returnBudgetEnd - returnStart > EPSILON) {
    intervals.push({ kind: "uncommitted", start: returnStart, end: returnBudgetEnd });
  }
  if (input.survey && available - surveyStart > EPSILON) {
    intervals.push({ kind: "survey", start: surveyStart, end: available });
  }
  if (physicalBundles - available > EPSILON) {
    intervals.push({ kind: "depleted", start: available, end: physicalBundles });
  }

  const bundles = Array.from({ length: physicalBundles }, (_, index) => Object.freeze({
    index,
    slices: Object.freeze(bundleSlices(index, intervals)),
  }));
  const statusParts = [
    `${physicalBundles} provision ${physicalBundles === 1 ? "bundle" : "bundles"} aboard`,
    `${displayUnits(available)} usable`,
  ];
  if (returnCost === null) {
    statusParts.push(input.returnRiskLevel === ReturnRiskLevel.Hidden
      ? "already in safe water"
      : "shortest known return unavailable");
  } else {
    statusParts.push(`${displayUnits(returnCost)} committed to the shortest known return`);
    if (returnShortfall > EPSILON) statusParts.push(`${displayUnits(returnShortfall)} return shortfall`);
  }
  if (input.survey) {
    statusParts.push(`${displayUnits(surveyCost)} offered survey cost`);
    if (surveyShortfall > EPSILON) statusParts.push(`${displayUnits(surveyShortfall)} survey shortfall`);
  }
  const uncommittedProvisionUnits = returnStart;
  statusParts.push(`${displayUnits(uncommittedProvisionUnits)} uncommitted`);
  const signature = [
    physicalBundles,
    available.toFixed(6),
    returnCost?.toFixed(6) ?? "unknown",
    returnRiskLevel,
    surveyCost.toFixed(6),
    surveyShortfall.toFixed(6),
    returnShortfall.toFixed(6),
  ].join(":");

  return Object.freeze({
    physicalBundles,
    availableProvisionUnits: available,
    returnCost,
    returnRiskLevel,
    surveyCost,
    surveyShortfall,
    returnShortfall,
    uncommittedProvisionUnits,
    bundles: Object.freeze(bundles),
    statusText: `${statusParts.join("; ")}.`,
    signature,
  });
}
