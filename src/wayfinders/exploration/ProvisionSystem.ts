import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import type { ShipState, TravelSegment } from "../core/types";
import { KnowledgeState } from "../world/TileData";
import { WorldGrid } from "../world/WorldGrid";

const BUNDLE_EPSILON = 1e-10;

export interface PreparedProvisionCharge {
  /** Knowledge captured before visibility turns Unknown water into Personal water. */
  segmentKnowledge: Uint8Array;
  distanceByKnowledge: Float64Array;
  totalTileDistance: number;
  totalCost: number;
}

export interface ProvisionChargeResult {
  cost: number;
  consumedBundles: number;
  provisions: number;
  provisionAccumulator: number;
  availableProvisionUnits: number;
}

export function knowledgeTravelCost(state: KnowledgeState, config: PrototypeConfig = prototypeConfig): number {
  let cost: number;
  switch (state) {
    case KnowledgeState.Supported:
      cost = config.provisions.supportedCost;
      break;
    case KnowledgeState.Personal:
      cost = config.provisions.personalCost;
      break;
    case KnowledgeState.Unknown:
      cost = config.provisions.unknownCost;
      break;
    default:
      throw new RangeError(`Unknown knowledge state ${String(state)}`);
  }
  if (!Number.isFinite(cost) || cost < 0) throw new RangeError("Provision movement costs must be finite and non-negative");
  return cost;
}

/** Remaining physical-bundle capacity, including fractional progress in use. */
export function availableProvisionUnits(ship: Pick<ShipState, "provisions" | "provisionAccumulator">): number {
  if (!Number.isFinite(ship.provisions) || !Number.isFinite(ship.provisionAccumulator)) {
    throw new RangeError("Ship provision values must be finite");
  }
  return Math.max(0, ship.provisions - ship.provisionAccumulator);
}

export class ProvisionSystem {
  constructor(
    private world: WorldGrid,
    private readonly config: PrototypeConfig = prototypeConfig,
  ) {}

  setWorld(world: WorldGrid): void {
    this.world = world;
  }

  /**
   * Capture this before KnowledgeSystem applies the matching visibility update.
   * Applying the returned charge later cannot retroactively discount Unknown travel.
   */
  prepareMovement(segments: readonly TravelSegment[]): PreparedProvisionCharge {
    const tileSize = this.config.navigation.tileSize;
    if (!Number.isFinite(tileSize) || tileSize <= 0) throw new RangeError("navigation.tileSize must be positive");

    const segmentKnowledge = new Uint8Array(segments.length);
    const distanceByKnowledge = new Float64Array(3);
    let totalTileDistance = 0;
    let totalCost = 0;

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (!Number.isFinite(segment.distancePixels) || segment.distancePixels < 0) {
        throw new RangeError("Movement segment distances must be finite and non-negative");
      }
      if (!this.world.inBounds(segment.tileX, segment.tileY)) {
        throw new RangeError(`Movement segment tile (${segment.tileX}, ${segment.tileY}) is outside the world`);
      }

      const knowledge = this.world.getKnowledge(segment.tileX, segment.tileY);
      const tileDistance = segment.distancePixels / tileSize;
      segmentKnowledge[index] = knowledge;
      distanceByKnowledge[knowledge] += tileDistance;
      totalTileDistance += tileDistance;
      totalCost += tileDistance * knowledgeTravelCost(knowledge, this.config);
    }

    return { segmentKnowledge, distanceByKnowledge, totalTileDistance, totalCost };
  }

  applyPreparedMovement(
    ship: ShipState,
    prepared: PreparedProvisionCharge,
    onBundleConsumed?: (remainingBundles: number) => void,
  ): ProvisionChargeResult {
    if (!Number.isFinite(prepared.totalCost) || prepared.totalCost < 0) {
      throw new RangeError("Prepared provision cost must be finite and non-negative");
    }
    if (!Number.isInteger(ship.provisions) || ship.provisions < 0) {
      throw new RangeError("Ship provisions must be a non-negative integer");
    }
    if (!Number.isFinite(ship.provisionAccumulator) || ship.provisionAccumulator < 0) {
      throw new RangeError("Ship provisionAccumulator must be finite and non-negative");
    }

    ship.provisionAccumulator += prepared.totalCost;
    let consumedBundles = 0;
    while (ship.provisionAccumulator >= 1 - BUNDLE_EPSILON && ship.provisions > 0) {
      ship.provisionAccumulator -= 1;
      if (Math.abs(ship.provisionAccumulator) < BUNDLE_EPSILON) ship.provisionAccumulator = 0;
      ship.provisions--;
      consumedBundles++;
      onBundleConsumed?.(ship.provisions);
    }

    return {
      cost: prepared.totalCost,
      consumedBundles,
      provisions: ship.provisions,
      provisionAccumulator: ship.provisionAccumulator,
      availableProvisionUnits: availableProvisionUnits(ship),
    };
  }

  chargeMovement(
    ship: ShipState,
    segments: readonly TravelSegment[],
    onBundleConsumed?: (remainingBundles: number) => void,
  ): ProvisionChargeResult {
    return this.applyPreparedMovement(ship, this.prepareMovement(segments), onBundleConsumed);
  }
}
