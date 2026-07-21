/** Shared configuration shapes with no dependency on either default owner. */
export interface PrototypeConfig {
  navigation: {
    tileSize: number;
    artTileSize: number;
    sightRadius: number;
    chunkSize: number;
  };
  world: {
    width: number;
    height: number;
    seed: number;
    homeIslandRadius: number;
    supportedWaterRadius: number;
    supportedBoundaryNoise: number;
    supportedNoiseScale: number;
    shallowWaterRadius: number;
    hiddenObstacleRadius: number;
    hiddenObstacleDistance: number;
    /** Maximum eight-connected Unknown pocket filled after a successful return. */
    maxEnclosedUnknownTiles: number;
    /** Lost idol locations hidden among the world's eligible survey locations. */
    idolCount: number;
    /** Maximum fishing shoals placed in the generated world. */
    fishingShoalCount: number;
  };
  islands: {
    count: number;
    minRadius: number;
    maxRadius: number;
    apronWidth: number;
    minimumChannelWidth: number;
    homeClearance: number;
    placementAttempts: number;
    /** Number of deterministic scatter centres; zero selects fully dispersed placement. */
    archipelagoClusters: number;
    /** Maximum tile radius used when sampling around an archipelago centre. */
    archipelagoRadius: number;
    /** Fraction of bounded placement attempts that prefer an archipelago centre. */
    archipelagoBias: number;
    edgeNoise: number;
    safeCorridorHalfWidth: number;
    highIslandWeight: number;
    lowCayWeight: number;
    atollWeight: number;
    rockySkerryWeight: number;
  };
  provisions: {
    startingBundles: number;
    surveyCost: number;
    supportedCost: number;
    personalCost: number;
    unknownCost: number;
  };
  returnRisk: {
    comfortable: number;
    warning: number;
    critical: number;
  };
  overlays: {
    fogNoise: number;
    fogBlend: number;
    forwardOverlayOpacity: number;
    returnOverlayOpacity: number;
    /** Voyage Sense thread width in world pixels. */
    returnThreadWidth: number;
    /** Maximum world-pixel radius used to round each return-path turn. */
    returnThreadCurveRadius: number;
    /** Half-angle of the heading-centred forward presentation cone. */
    forwardConeHalfAngleDegrees: number;
    /** Cardinal passable-water padding around the minimum-cost return path. */
    returnPathPadding: number;
  };
  movement: {
    shipSpeed: number;
    turnRate: number;
    /** Axis-aligned half-size of the ship's square gameplay collision footprint, in world pixels. */
    shipCollisionHalfExtent: number;
    collisionEpsilon: number;
  };
  simulation: {
    fixedStepMs: number;
    maxFrameDeltaMs: number;
    wreckPresentationSeconds: number;
  };
}

export type PrototypeConfigSection = keyof PrototypeConfig;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
