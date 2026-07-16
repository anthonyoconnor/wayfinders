export interface PresentationWorkCounters {
  /** Entity records inspected by revision syncs and viewport culling this frame. */
  readonly queriedEntities: number;
  /** Entity records submitted after an authority revision, including removals. */
  readonly changedEntities: number;
  /** Retained marker views participating in viewport culling. */
  readonly activeMarkers: number;
  /** Time spent refreshing the throttled browser diagnostics projection and DOM. */
  readonly diagnosticsMs: number;
}

const finiteNonNegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
  return value;
};

const nonNegativeInteger = (value: number, name: string): number => {
  finiteNonNegative(value, name);
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer`);
  return value;
};

/** Allocation-free frame accumulator; snapshots are created only for diagnostics. */
export class PresentationWorkMonitor {
  private queriedEntitiesValue = 0;
  private changedEntitiesValue = 0;
  private activeMarkersValue = 0;
  private diagnosticsMsValue = 0;

  beginFrame(): void {
    this.queriedEntitiesValue = 0;
    this.changedEntitiesValue = 0;
    this.diagnosticsMsValue = 0;
  }

  recordRevisionSync(previousActive: number, nextActive: number): void {
    previousActive = nonNegativeInteger(previousActive, "previousActive");
    nextActive = nonNegativeInteger(nextActive, "nextActive");
    this.queriedEntitiesValue += previousActive + nextActive;
    this.changedEntitiesValue += nextActive + Math.max(0, previousActive - nextActive);
    this.activeMarkersValue += nextActive - previousActive;
  }

  recordViewportQuery(): void {
    this.queriedEntitiesValue += this.activeMarkersValue;
  }

  recordEntityQueries(entitiesExamined: number): void {
    this.queriedEntitiesValue += nonNegativeInteger(entitiesExamined, "entitiesExamined");
  }

  recordDiagnostics(durationMs: number): void {
    this.diagnosticsMsValue = finiteNonNegative(durationMs, "durationMs");
  }

  snapshot(): Readonly<PresentationWorkCounters> {
    return Object.freeze({
      queriedEntities: this.queriedEntitiesValue,
      changedEntities: this.changedEntitiesValue,
      activeMarkers: this.activeMarkersValue,
      diagnosticsMs: this.diagnosticsMsValue,
    });
  }
}
