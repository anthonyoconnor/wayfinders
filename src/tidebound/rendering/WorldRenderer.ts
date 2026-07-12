import Phaser from "phaser";
import { prototypeConfig } from "../config/prototypeConfig";
import { gridToWorld } from "../world/CoordinateSystem";
import { seededValue, type GeneratedWorld } from "../world/WorldGenerator";
import { KnowledgeState, TerrainType } from "../world/TileData";

const COLORS = {
  ocean: 0x082f40,
  supported: 0x12536a,
  shallow: 0x2d858b,
  shallowSupported: 0x3b9696,
  wave: 0x8bd0cf,
  sand: 0xd2bb7f,
  land: 0x779459,
  landDark: 0x49683e,
  reef: 0x91b59b,
  rock: 0x626e6e,
  timber: 0x6f442a,
  timberLight: 0xb17c45,
  roof: 0x9b4f32,
  sailcloth: 0xf0d79b,
  buoy: 0xf0c467,
} as const;

/** Developer-art renderer. Gameplay terrain remains owned by WorldGrid. */
export class WorldRenderer {
  private readonly water: Phaser.GameObjects.Graphics;
  private readonly waves: Phaser.GameObjects.Graphics;
  private readonly terrain: Phaser.GameObjects.Graphics;
  private readonly coast: Phaser.GameObjects.Graphics;
  private readonly structures: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.water = scene.add.graphics().setDepth(0);
    this.waves = scene.add.graphics().setDepth(1);
    this.terrain = scene.add.graphics().setDepth(2);
    this.coast = scene.add.graphics().setDepth(3);
    this.structures = scene.add.graphics().setDepth(5);
  }

  render(generated: GeneratedWorld): void {
    const { grid, landmarks, seed } = generated;
    const size = prototypeConfig.navigation.tileSize;
    this.clear();

    this.water.fillStyle(COLORS.ocean, 1);
    this.water.fillRect(0, 0, grid.width * size, grid.height * size);

    grid.forEachTile((x, y) => {
      const tile = grid.getTile(x, y);
      const px = x * size;
      const py = y * size;
      const supported = tile.knowledge === KnowledgeState.Supported;

      let waterColor: number = supported ? COLORS.supported : COLORS.ocean;
      if (tile.terrain === TerrainType.ShallowOcean) {
        waterColor = supported ? COLORS.shallowSupported : COLORS.shallow;
      }
      this.water.fillStyle(waterColor, 1);
      this.water.fillRect(px, py, size + 1, size + 1);

      if (tile.terrain === TerrainType.Land) {
        const variation = seededValue(seed + 401, x, y) > 0.5 ? COLORS.land : COLORS.landDark;
        this.terrain.fillStyle(variation, 1);
        this.terrain.fillRoundedRect(px + 1, py + 1, size - 2, size - 2, size * 0.18);
      } else if (tile.terrain === TerrainType.Rock) {
        this.terrain.fillStyle(COLORS.rock, 1);
        this.terrain.fillTriangle(px + size * 0.12, py + size * 0.84, px + size * 0.52, py + size * 0.12, px + size * 0.9, py + size * 0.84);
      } else if (tile.terrain === TerrainType.Reef) {
        this.terrain.fillStyle(COLORS.reef, 0.9);
        this.terrain.fillCircle(px + size * 0.32, py + size * 0.54, size * 0.15);
        this.terrain.fillCircle(px + size * 0.63, py + size * 0.42, size * 0.12);
      }

      if ((x + y) % 2 === 0 && tile.terrain !== TerrainType.Land) {
        const waveOffset = seededValue(seed + 503, x, y) * size * 0.24;
        this.waves.lineStyle(1, COLORS.wave, supported ? 0.2 : 0.12);
        this.waves.beginPath();
        this.waves.moveTo(px + size * 0.2 + waveOffset, py + size * 0.52);
        this.waves.lineTo(px + size * 0.45 + waveOffset, py + size * 0.46);
        this.waves.lineTo(px + size * 0.7 + waveOffset, py + size * 0.52);
        this.waves.strokePath();
      }

      if (supported && this.touchesUnknown(grid, x, y) && seededValue(seed + 607, x, y) > 0.72) {
        this.structures.fillStyle(COLORS.buoy, 1);
        this.structures.fillCircle(px + size / 2, py + size / 2, size * 0.08);
        this.structures.lineStyle(1, COLORS.timber, 0.9);
        this.structures.lineBetween(px + size / 2, py + size * 0.56, px + size / 2, py + size * 0.75);
      }
    });

    this.drawCoast(generated);
    this.drawHome(generated);

    const labelAt = gridToWorld({ x: landmarks.homeCenter.x, y: landmarks.homeCenter.y - prototypeConfig.world.homeIslandRadius - 2 });
    const label = this.scene.add.text(labelAt.x, labelAt.y, "HOME ISLAND", {
      color: "#f5e4b3",
      fontFamily: "ui-monospace, monospace",
      fontSize: "14px",
      fontStyle: "bold",
      stroke: "#10242a",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);
    this.labels.push(label);
  }

  destroy(): void {
    this.clear();
    this.water.destroy();
    this.waves.destroy();
    this.terrain.destroy();
    this.coast.destroy();
    this.structures.destroy();
  }

  private drawCoast(generated: GeneratedWorld): void {
    const { grid } = generated;
    const size = prototypeConfig.navigation.tileSize;
    this.coast.lineStyle(Math.max(2, size * 0.1), COLORS.sand, 0.95);
    grid.forEachTile((x, y) => {
      if (grid.getTerrain(x, y) !== TerrainType.Land) return;
      const left = x * size;
      const top = y * size;
      if (y === 0 || grid.getTerrain(x, y - 1) !== TerrainType.Land) this.coast.lineBetween(left, top, left + size, top);
      if (x + 1 >= grid.width || grid.getTerrain(x + 1, y) !== TerrainType.Land) this.coast.lineBetween(left + size, top, left + size, top + size);
      if (y + 1 >= grid.height || grid.getTerrain(x, y + 1) !== TerrainType.Land) this.coast.lineBetween(left, top + size, left + size, top + size);
      if (x === 0 || grid.getTerrain(x - 1, y) !== TerrainType.Land) this.coast.lineBetween(left, top, left, top + size);
    });
  }

  private drawHome(generated: GeneratedWorld): void {
    const { homeCenter, harbour, dock } = generated.landmarks;
    const size = prototypeConfig.navigation.tileSize;
    const center = gridToWorld(homeCenter);
    const harbourWorld = gridToWorld(harbour);
    const dockWorld = gridToWorld(dock);

    // A flag and simple huts make the home readable without production art.
    this.structures.lineStyle(3, COLORS.timber, 1);
    this.structures.lineBetween(center.x, center.y - size * 1.45, center.x, center.y - size * 0.2);
    this.structures.fillStyle(COLORS.sailcloth, 1);
    this.structures.fillTriangle(center.x, center.y - size * 1.4, center.x + size * 0.55, center.y - size * 1.15, center.x, center.y - size * 0.95);

    const huts = [
      { x: center.x - size * 1.7, y: center.y - size * 0.6 },
      { x: center.x + size * 0.6, y: center.y + size * 1.4 },
      { x: center.x - size * 0.8, y: center.y + size * 1.7 },
    ];
    for (const hut of huts) {
      this.structures.fillStyle(COLORS.timberLight, 1);
      this.structures.fillRect(hut.x - size * 0.28, hut.y - size * 0.05, size * 0.56, size * 0.42);
      this.structures.fillStyle(COLORS.roof, 1);
      this.structures.fillTriangle(hut.x - size * 0.4, hut.y, hut.x, hut.y - size * 0.42, hut.x + size * 0.4, hut.y);
    }

    // East-facing harbour and a short dock aligned to the generated return tile.
    this.structures.lineStyle(size * 0.18, COLORS.timber, 1);
    this.structures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y, dockWorld.x + size * 0.35, dockWorld.y);
    this.structures.lineStyle(size * 0.08, COLORS.timberLight, 1);
    this.structures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y - size * 0.12, dockWorld.x + size * 0.35, dockWorld.y - size * 0.12);
    this.structures.lineBetween(harbourWorld.x - size * 0.7, harbourWorld.y + size * 0.12, dockWorld.x + size * 0.35, dockWorld.y + size * 0.12);
    for (let x = harbourWorld.x - size * 0.5; x <= dockWorld.x + size * 0.25; x += size * 0.38) {
      this.structures.lineStyle(2, COLORS.timberLight, 1);
      this.structures.lineBetween(x, harbourWorld.y - size * 0.23, x, harbourWorld.y + size * 0.23);
    }
  }

  private touchesUnknown(grid: GeneratedWorld["grid"], x: number, y: number): boolean {
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const;
    return neighbors.some(([nx, ny]) => grid.inBounds(nx, ny) && grid.getKnowledge(nx, ny) === KnowledgeState.Unknown);
  }

  private clear(): void {
    this.water.clear();
    this.waves.clear();
    this.terrain.clear();
    this.coast.clear();
    this.structures.clear();
    for (const label of this.labels) label.destroy();
    this.labels.length = 0;
  }
}
