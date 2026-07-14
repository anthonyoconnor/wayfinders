import type { AuthoredPlayerBoatMetadata } from "../assets/AuthoredAssetContracts";

export interface ShipAnimationState {
  boatFrame: number;
  boatRotationDegrees: number;
  boatScale: number;
  wake: {
    frame: number;
    visible: boolean;
    rotationDegrees: number;
    offsetX: number;
    offsetY: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Pure presentation state: no animation value can influence simulation rules. */
export function resolveShipAnimationState(
  metadata: Readonly<AuthoredPlayerBoatMetadata>,
  headingDegrees: number,
  signedSpeedPixelsPerSecond: number,
  nowMilliseconds: number,
): Readonly<ShipAnimationState> {
  const speed = Math.abs(signedSpeedPixelsPerSecond);
  const speedRatio = clamp(speed / metadata.wake.fullSpeedPixelsPerSecond, 0, 1);
  const reverse = signedSpeedPixelsPerSecond < 0;
  const travelHeading = wrapDegrees(headingDegrees + (reverse ? 180 : 0));
  const wakeRotationDegrees = wrapDegrees(travelHeading - metadata.wake.sourceHeadingDegrees);
  const wakeRadians = wakeRotationDegrees * Math.PI / 180;
  const boatPhase = nowMilliseconds / 1_000 * metadata.visual.framesPerSecond * Math.PI / 2;
  const wakePhase = nowMilliseconds / 1_000 * metadata.wake.framesPerSecond * Math.PI / 2;
  const boatPulse = Math.sin(boatPhase);
  const wakePulse = Math.sin(wakePhase);
  const boatMotionAmount = 0.004 + speedRatio * 0.006;
  const wakeBaseAlpha = 0.22 + speedRatio * 0.58;

  const moving = speed >= metadata.wake.minimumSpeedPixelsPerSecond;
  const motionFrame = moving
    ? Math.floor(nowMilliseconds / 1_000 * metadata.visual.framesPerSecond)
      % metadata.visual.motionFramesPerDirection
    : 0;
  const directionStep = 360 / metadata.visual.directionCount;
  const directionFrame = metadata.visual.headingMode === "directional"
    ? Math.round(wrapDegrees(headingDegrees - metadata.visual.sourceHeadingDegrees) / directionStep)
      % metadata.visual.directionCount
    : 0;

  return {
    boatFrame: directionFrame * metadata.visual.motionFramesPerDirection + motionFrame,
    boatRotationDegrees: metadata.visual.headingMode === "rotate"
      ? wrapDegrees(headingDegrees - metadata.visual.sourceHeadingDegrees)
      : 0,
    boatScale: metadata.visual.scale * (1 + boatPulse * boatMotionAmount),
    wake: {
      frame: Math.floor(nowMilliseconds / 1_000 * metadata.wake.framesPerSecond)
        % metadata.wake.frameCount,
      visible: moving,
      rotationDegrees: wakeRotationDegrees,
      offsetX: metadata.wake.offset.x * Math.cos(wakeRadians)
        - metadata.wake.offset.y * Math.sin(wakeRadians),
      offsetY: metadata.wake.offset.x * Math.sin(wakeRadians)
        + metadata.wake.offset.y * Math.cos(wakeRadians),
      alpha: clamp(wakeBaseAlpha * (0.88 + wakePulse * 0.12), 0, 1),
      scaleX: metadata.wake.scale * (0.78 + speedRatio * 0.22) * (1 + wakePulse * 0.04),
      scaleY: metadata.wake.scale * (0.9 + speedRatio * 0.1) * (1 - wakePulse * 0.04),
    },
  };
}
