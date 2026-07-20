import Phaser from "phaser";
import type { ProsperityTrafficRouteKind } from "../../features/prosperity";
import {
  PROSPERITY_TRAFFIC_FISHING_ALPHA,
  PROSPERITY_TRAFFIC_TRADE_ALPHA,
} from "./ProsperityTrafficCraftContracts";

export interface ProsperityTrafficCraftGraphics {
  readonly wake: Phaser.GameObjects.Graphics;
  readonly fishingCraft: Phaser.GameObjects.Graphics;
  readonly tradeCraft: Phaser.GameObjects.Graphics;
}

/**
 * Creates the complete code-native traffic visual set. Runtime pool slots and
 * the view-only asset workspace share this factory so the preview cannot drift
 * from the craft that actually sail in the world.
 */
export function createProsperityTrafficCraftGraphics(
  scene: Phaser.Scene,
): Readonly<ProsperityTrafficCraftGraphics> {
  const wake = scene.add.graphics();
  wake.lineStyle(1, 0xa8e4e4, 0.3);
  wake.beginPath();
  wake.moveTo(-7, -2.5);
  wake.lineTo(-15, -5);
  wake.moveTo(-7, 2.5);
  wake.lineTo(-15, 5);
  wake.strokePath();

  const fishingCraft = scene.add.graphics();
  fishingCraft.fillStyle(0x3a2922, 1);
  fishingCraft.fillTriangle(10, 0, -8, -4, -8, 4);
  fishingCraft.lineStyle(1.25, 0x9b7247, 1);
  fishingCraft.strokeTriangle(10, 0, -8, -4, -8, 4);
  fishingCraft.lineStyle(1, 0x8c7755, 0.9);
  fishingCraft.lineBetween(-4, 3, -4, 8);
  fishingCraft.lineBetween(4, 2.5, 4, 8);
  fishingCraft.lineStyle(2, 0x6c5438, 1);
  fishingCraft.lineBetween(-7, 8, 7, 8);
  fishingCraft.fillStyle(0x4faaa5, 0.9);
  fishingCraft.fillCircle(-1, 0, 2.5);
  fishingCraft.lineStyle(1, 0xb9d8b6, 0.7);
  fishingCraft.strokeCircle(-1, 0, 3.5);
  fishingCraft.lineStyle(1.2, 0xc7b078, 0.9);
  fishingCraft.lineBetween(-7, -3, -11, -8);

  const tradeCraft = scene.add.graphics();
  tradeCraft.fillStyle(0x39271f, 1);
  tradeCraft.fillTriangle(12, 0, -10, -5, -10, 5);
  tradeCraft.lineStyle(1.4, 0xa07745, 1);
  tradeCraft.strokeTriangle(12, 0, -10, -5, -10, 5);
  tradeCraft.lineStyle(1, 0x8c7755, 0.86);
  tradeCraft.lineBetween(-5, 4, -5, 9);
  tradeCraft.lineBetween(5, 3, 5, 9);
  tradeCraft.lineStyle(2, 0x6c5438, 1);
  tradeCraft.lineBetween(-8, 9, 8, 9);
  tradeCraft.fillStyle(0xb7793f, 0.95);
  tradeCraft.fillRect(-7, -3, 5, 3);
  tradeCraft.fillRect(-1, 1, 5, 3);
  tradeCraft.fillStyle(0xd8c99e, 0.94);
  tradeCraft.fillTriangle(-1, -2, -1, -12, 7, -2);
  tradeCraft.lineStyle(1, 0x9b7247, 1);
  tradeCraft.lineBetween(-1, -12, -1, 4);
  tradeCraft.lineBetween(-1, -12, 7, -2);

  return Object.freeze({ wake, fishingCraft, tradeCraft });
}

export function setProsperityTrafficCraftState(
  graphics: Readonly<ProsperityTrafficCraftGraphics>,
  kind: ProsperityTrafficRouteKind,
  wakeVisible: boolean,
): void {
  graphics.wake.setVisible(wakeVisible);
  graphics.fishingCraft.setVisible(kind === "fishing");
  graphics.tradeCraft.setVisible(kind === "trade");
}

export function prosperityTrafficCraftAlpha(kind: ProsperityTrafficRouteKind): number {
  return kind === "fishing"
    ? PROSPERITY_TRAFFIC_FISHING_ALPHA
    : PROSPERITY_TRAFFIC_TRADE_ALPHA;
}
