export interface SurveyBudgetReadModel {
  readonly surveyCost: number;
  readonly availableProvisionUnits: number;
  readonly remainingProvisionUnits: number;
  readonly returnCost: number | null;
  readonly projectedReturnMargin: number | null;
  readonly canAfford: boolean;
}

export function createSurveyBudget(
  surveyCost: number,
  availableUnits: number,
  returnCost: number,
): Readonly<SurveyBudgetReadModel> {
  if (!Number.isSafeInteger(surveyCost) || surveyCost <= 0) {
    throw new RangeError("Survey cost must be a positive safe integer");
  }
  if (!Number.isFinite(availableUnits) || availableUnits < 0) {
    throw new RangeError("Available provision units must be finite and non-negative");
  }
  const finiteReturnCost = Number.isFinite(returnCost) ? returnCost : null;
  const remainingProvisionUnits = Math.max(0, availableUnits - surveyCost);
  return Object.freeze({
    surveyCost,
    availableProvisionUnits: availableUnits,
    remainingProvisionUnits,
    returnCost: finiteReturnCost,
    projectedReturnMargin: finiteReturnCost === null ? null : remainingProvisionUnits - finiteReturnCost,
    canAfford: availableUnits >= surveyCost,
  });
}
