import type { GridPoint } from "../core/types";
import { gridToWorld } from "../world/CoordinateSystem";
import type { RuntimeCollisionObjectKind } from "../assets/CollisionProfileRegistry";
import type { ActiveChunkEntry } from "./activation";

export type DebugEntityBoundsRole = "ship-collider" | "item" | "service";

export type DebugEntityBoundsKind = Exclude<
  RuntimeCollisionObjectKind,
  "home-island" | "generated-island"
>;

export interface DebugEntityBounds {
  readonly kind: DebugEntityBoundsKind;
  readonly role: DebugEntityBoundsRole;
  readonly centerX: number;
  readonly centerY: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export interface DebugEntityBoundsSource {
  readonly ship: { readonly worldX: number; readonly worldY: number };
  readonly wrecks: readonly { readonly worldX: number; readonly worldY: number }[];
  readonly fishingShoals: readonly { readonly tile: Readonly<GridPoint> }[];
  readonly surveySites: readonly {
    readonly tile: Readonly<GridPoint>;
    readonly serviceAnchor: Readonly<GridPoint>;
  }[];
  readonly islandDossiers: readonly { readonly canonicalApproach: Readonly<GridPoint> }[];
  readonly homeDock: Readonly<GridPoint>;
}

function tileBounds(
  kind: DebugEntityBoundsKind,
  role: DebugEntityBoundsRole,
  tile: Readonly<GridPoint>,
  tileSize: number,
  halfExtent = tileSize / 2,
): DebugEntityBounds {
  const center = gridToWorld(tile, tileSize);
  return Object.freeze({
    kind,
    role,
    centerX: center.x,
    centerY: center.y,
    halfWidth: halfExtent,
    halfHeight: halfExtent,
  });
}

/** Collects every authoritative world-item bound shown by the developer collision overlay. */
export function collectDebugEntityBounds(
  source: Readonly<DebugEntityBoundsSource>,
  tileSize: number,
  shipHalfExtent: number,
): readonly Readonly<DebugEntityBounds>[] {
  const serviceHalfExtent = tileSize * 0.3;
  const bounds: DebugEntityBounds[] = [{
    kind: "player-ship",
    role: "ship-collider",
    centerX: source.ship.worldX,
    centerY: source.ship.worldY,
    halfWidth: shipHalfExtent,
    halfHeight: shipHalfExtent,
  }];

  for (const wreck of source.wrecks) {
    bounds.push({
      kind: "wreck",
      role: "item",
      centerX: wreck.worldX,
      centerY: wreck.worldY,
      halfWidth: shipHalfExtent,
      halfHeight: shipHalfExtent,
    });
  }
  for (const shoal of source.fishingShoals) {
    bounds.push(tileBounds("fishing-shoal", "item", shoal.tile, tileSize));
  }
  for (const site of source.surveySites) {
    bounds.push(tileBounds("survey-site", "item", site.tile, tileSize));
    bounds.push(tileBounds("survey-service", "service", site.serviceAnchor, tileSize, serviceHalfExtent));
  }
  for (const dossier of source.islandDossiers) {
    bounds.push(tileBounds(
      "island-approach",
      "service",
      dossier.canonicalApproach,
      tileSize,
      serviceHalfExtent,
    ));
  }
  bounds.push(tileBounds("home-dock", "service", source.homeDock, tileSize, serviceHalfExtent));

  return Object.freeze(bounds.map((bound) => Object.freeze(bound)));
}

/**
 * Projects canonical diagnostic records into the same capacity-bounded periodic image
 * set as terrain and markers. It creates presentation records only; collision
 * ownership and picking remain canonical.
 */
export function projectDebugEntityBoundsToActiveImages(
  bounds: readonly Readonly<DebugEntityBounds>[],
  activeImages: readonly Readonly<ActiveChunkEntry>[],
  chunkSizePixels: number,
): readonly Readonly<DebugEntityBounds>[] {
  if (!Number.isFinite(chunkSizePixels) || chunkSizePixels <= 0) {
    throw new RangeError("debug chunk size must be positive");
  }
  const imagesByCanonicalChunk = new Map<string, Readonly<ActiveChunkEntry>[]>();
  for (const image of activeImages) {
    const key = `${image.canonicalChunk.x},${image.canonicalChunk.y}`;
    const images = imagesByCanonicalChunk.get(key) ?? [];
    images.push(image);
    imagesByCanonicalChunk.set(key, images);
  }

  const projected: DebugEntityBounds[] = [];
  for (const bound of bounds) {
    const chunkX = Math.floor(bound.centerX / chunkSizePixels);
    const chunkY = Math.floor(bound.centerY / chunkSizePixels);
    for (const image of imagesByCanonicalChunk.get(`${chunkX},${chunkY}`) ?? []) {
      projected.push({
        ...bound,
        centerX: bound.centerX + image.imageOffset.x,
        centerY: bound.centerY + image.imageOffset.y,
      });
    }
  }
  return Object.freeze(projected.map((bound) => Object.freeze(bound)));
}
