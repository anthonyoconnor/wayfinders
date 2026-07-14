export interface GreatHallAccessContext {
  readonly atDock: boolean;
  readonly expeditionActive: boolean;
  readonly wreckPresentationActive: boolean;
  readonly generationHandoverActive: boolean;
  readonly greatHallOpen: boolean;
}

/**
 * The permanent archive is a home-place interaction. Required succession
 * presentation uses the same view but deliberately bypasses this optional
 * access policy.
 */
export function canVisitGreatHall(
  context: Readonly<GreatHallAccessContext>,
): boolean {
  return context.atDock
    && !context.expeditionActive
    && !context.wreckPresentationActive
    && !context.generationHandoverActive
    && !context.greatHallOpen;
}
