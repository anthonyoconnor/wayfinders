import type { AuthoredHomeIslandMetadata } from "./AuthoredAssetContracts";

export interface AssetViewerDisplayBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface AssetViewerPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Aligns the rendered Home slice union with the same centred grid canvas used
 * by the collision editor. Render source pixels are deliberately irrelevant:
 * only the displayed slice bounds and their represented grid cells matter.
 */
export function authoredHomeViewerOrigin(
  metadata: Readonly<AuthoredHomeIslandMetadata>,
  displayBounds: Readonly<AssetViewerDisplayBounds>,
  previewCenter: Readonly<AssetViewerPoint>,
): Readonly<AssetViewerPoint> {
  const slices = metadata.render.slices;
  const gridLeft = Math.min(...slices.map((slice) => slice.gridBounds.x));
  const gridTop = Math.min(...slices.map((slice) => slice.gridBounds.y));
  const gridRight = Math.max(...slices.map(
    (slice) => slice.gridBounds.x + slice.gridBounds.width,
  ));
  const gridBottom = Math.max(...slices.map(
    (slice) => slice.gridBounds.y + slice.gridBounds.height,
  ));
  const canvasLeft = previewCenter.x - metadata.grid.width * metadata.tileSize / 2;
  const canvasTop = previewCenter.y - metadata.grid.height * metadata.tileSize / 2;
  const targetCenterX = canvasLeft + (gridLeft + (gridRight - gridLeft) / 2) * metadata.tileSize;
  const targetCenterY = canvasTop + (gridTop + (gridBottom - gridTop) / 2) * metadata.tileSize;

  return Object.freeze({
    x: targetCenterX - (displayBounds.left + displayBounds.width / 2),
    y: targetCenterY - (displayBounds.top + displayBounds.height / 2),
  });
}
