import type { MovementResult, WorldPoint } from "../core/types";
import type { WorldTopology } from "../world/WorldTopology";

const POSITION_EPSILON = 1e-7;

/**
 * Scene-owned physical image of one canonical simulation pose.
 *
 * Movement supplies the accepted short displacement and wrap offset. Canonical
 * endpoints are used only to remove floating-point drift or to place an
 * explicit relocation in the nearest image; direction is never inferred from
 * two canonical poses.
 */
export class LiftedViewAnchor {
  private liftedX: number;
  private liftedY: number;
  private canonicalX: number;
  private canonicalY: number;

  constructor(
    private readonly topology: WorldTopology,
    canonicalPose: Readonly<WorldPoint>,
  ) {
    this.assertCanonical(canonicalPose);
    this.liftedX = canonicalPose.x;
    this.liftedY = canonicalPose.y;
    this.canonicalX = canonicalPose.x;
    this.canonicalY = canonicalPose.y;
  }

  get point(): Readonly<WorldPoint> {
    return { x: this.liftedX, y: this.liftedY };
  }

  /** Applies one accepted authoritative movement result. */
  advance(
    canonicalFinal: Readonly<WorldPoint>,
    movement: Readonly<MovementResult>,
  ): Readonly<WorldPoint> {
    this.assertCanonical(canonicalFinal);
    const moved = movement.liftedDisplacement.x !== 0 || movement.liftedDisplacement.y !== 0;
    if (!moved) return this.relocate(canonicalFinal);

    const previousImageOffsetX = this.liftedX - this.canonicalX;
    const previousImageOffsetY = this.liftedY - this.canonicalY;
    const displacedX = this.liftedX + movement.liftedDisplacement.x;
    const displacedY = this.liftedY + movement.liftedDisplacement.y;
    const offsetX = canonicalFinal.x + previousImageOffsetX + movement.worldImageOffset.x;
    const offsetY = canonicalFinal.y + previousImageOffsetY + movement.worldImageOffset.y;

    // The offset form lands exactly on the canonical image and avoids drift;
    // the displacement form remains the physical authority and catches stale
    // or inconsistent movement results.
    this.liftedX = nearlyEqual(displacedX, offsetX) ? offsetX : displacedX;
    this.liftedY = nearlyEqual(displacedY, offsetY) ? offsetY : displacedY;
    this.canonicalX = canonicalFinal.x;
    this.canonicalY = canonicalFinal.y;
    this.reconcileToCanonicalImage();
    return this.point;
  }

  /** Places a teleport/regeneration target in the image nearest `near`. */
  relocate(
    canonicalTarget: Readonly<WorldPoint>,
    near: Readonly<WorldPoint> = this.point,
  ): Readonly<WorldPoint> {
    this.assertCanonical(canonicalTarget);
    const offset = this.topology.nearestWorldImageOffset(near, canonicalTarget);
    this.liftedX = canonicalTarget.x + offset.x;
    this.liftedY = canonicalTarget.y + offset.y;
    this.canonicalX = canonicalTarget.x;
    this.canonicalY = canonicalTarget.y;
    return this.point;
  }

  /** Resets to the primary canonical image for a new world/session. */
  reset(canonicalPose: Readonly<WorldPoint>): Readonly<WorldPoint> {
    this.assertCanonical(canonicalPose);
    this.liftedX = canonicalPose.x;
    this.liftedY = canonicalPose.y;
    this.canonicalX = canonicalPose.x;
    this.canonicalY = canonicalPose.y;
    return this.point;
  }

  /**
   * Keeps long-running view coordinates numerically small. The returned offset
   * must also be subtracted from the camera and cached interpolated poses in the
   * same presentation transaction.
   */
  rebaseIfNeeded(maximumImageMagnitude = 4): Readonly<WorldPoint> {
    if (!Number.isSafeInteger(maximumImageMagnitude) || maximumImageMagnitude < 1) {
      throw new RangeError("maximumImageMagnitude must be a positive safe integer");
    }
    const shiftX = rebaseAxis(
      this.liftedX,
      this.topology.pixelWidth,
      this.topology.wrapsX,
      maximumImageMagnitude,
    );
    const shiftY = rebaseAxis(
      this.liftedY,
      this.topology.pixelHeight,
      this.topology.wrapsY,
      maximumImageMagnitude,
    );
    this.liftedX -= shiftX;
    this.liftedY -= shiftY;
    return { x: shiftX, y: shiftY };
  }

  private reconcileToCanonicalImage(): void {
    const normalized = this.topology.normalizeWorld(this.liftedX, this.liftedY);
    if (nearlyEqual(normalized.x, this.canonicalX) && nearlyEqual(normalized.y, this.canonicalY)) return;
    const offset = this.topology.nearestWorldImageOffset(this.point, {
      x: this.canonicalX,
      y: this.canonicalY,
    });
    this.liftedX = this.canonicalX + offset.x;
    this.liftedY = this.canonicalY + offset.y;
  }

  private assertCanonical(point: Readonly<WorldPoint>): void {
    if (!this.topology.isCanonicalWorld(point.x, point.y)) {
      throw new RangeError(`Canonical view pose (${point.x}, ${point.y}) is outside the world`);
    }
  }
}

function rebaseAxis(
  value: number,
  span: number,
  wraps: boolean,
  maximumImageMagnitude: number,
): number {
  if (!wraps || Math.abs(value) < span * maximumImageMagnitude) return 0;
  return Math.floor(value / span) * span;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= POSITION_EPSILON;
}
