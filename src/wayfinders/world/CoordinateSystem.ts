import { prototypeConfig } from "../config/prototypeConfig";
import type { ArtPoint, GridPoint, WorldPoint } from "../core/types";

export function gridToWorld(point: GridPoint, tileSize = prototypeConfig.navigation.tileSize): WorldPoint {
  return {
    x: point.x * tileSize + tileSize / 2,
    y: point.y * tileSize + tileSize / 2,
  };
}

export function worldToGrid(x: number, y: number, tileSize = prototypeConfig.navigation.tileSize): GridPoint {
  return {
    x: Math.floor(x / tileSize),
    y: Math.floor(y / tileSize),
  };
}

export function gridToArt(point: GridPoint, tileSize = prototypeConfig.navigation.tileSize, artTileSize = prototypeConfig.navigation.artTileSize): ArtPoint {
  const ratio = tileSize / artTileSize;
  return { x: point.x * ratio, y: point.y * ratio };
}

export function gridToChunk(point: GridPoint, chunkSize = prototypeConfig.navigation.chunkSize): GridPoint {
  return {
    x: Math.floor(point.x / chunkSize),
    y: Math.floor(point.y / chunkSize),
  };
}

export function gridToLocal(point: GridPoint, chunkSize = prototypeConfig.navigation.chunkSize): GridPoint {
  return {
    x: ((point.x % chunkSize) + chunkSize) % chunkSize,
    y: ((point.y % chunkSize) + chunkSize) % chunkSize,
  };
}

export function gridDistanceSquared(a: GridPoint, b: GridPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function sameGridPoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}
