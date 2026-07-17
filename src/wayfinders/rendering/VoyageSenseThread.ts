import type { WorldGrid } from "../world/WorldGrid";

export interface ThreadPoint {
  readonly x: number;
  readonly y: number;
}

export type VoyageSenseThreadSegment = Readonly<
  | { kind: "line"; from: ThreadPoint; to: ThreadPoint }
  | { kind: "curve"; from: ThreadPoint; control: ThreadPoint; to: ThreadPoint }
>;

export interface VoyageSenseThreadGeometry {
  readonly segments: readonly VoyageSenseThreadSegment[];
  readonly segmentsByChunk: ReadonlyMap<string, readonly VoyageSenseThreadSegment[]>;
}

function pointOnSegment(from: ThreadPoint, to: ThreadPoint, distanceFromTo: number): ThreadPoint {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const scale = Math.min(distanceFromTo, length / 2) / length;
  return { x: to.x + dx * scale, y: to.y + dy * scale };
}

function samePoint(left: ThreadPoint, right: ThreadPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function segmentBounds(segment: VoyageSenseThreadSegment, padding: number) {
  const points = segment.kind === "curve"
    ? [segment.from, segment.control, segment.to]
    : [segment.from, segment.to];
  return {
    minX: Math.min(...points.map(({ x }) => x)) - padding,
    maxX: Math.max(...points.map(({ x }) => x)) + padding,
    minY: Math.min(...points.map(({ y }) => y)) - padding,
    maxY: Math.max(...points.map(({ y }) => y)) + padding,
  };
}

/**
 * Adapts the authoritative ordered return route into renderer-neutral rounded
 * segments. Curves consume at most half of either adjacent cardinal edge, so
 * they stay inside the traversable tile envelope around each turn.
 */
export function buildVoyageSenseThread(
  world: WorldGrid,
  pathIndices: readonly number[],
  tileSize: number,
  curveRadius: number,
  strokePadding: number,
): VoyageSenseThreadGeometry {
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new RangeError("Voyage Sense tile size must be positive");
  }
  if (!Number.isFinite(curveRadius) || curveRadius < 0) {
    throw new RangeError("Voyage Sense curve radius must be non-negative");
  }
  if (!Number.isFinite(strokePadding) || strokePadding < 0) {
    throw new RangeError("Voyage Sense stroke padding must be non-negative");
  }

  const points = pathIndices.map((index) => {
    const { x, y } = world.pointFromIndex(index);
    return { x: (x + 0.5) * tileSize, y: (y + 0.5) * tileSize };
  });
  const segments: VoyageSenseThreadSegment[] = [];
  let cursor = points[0];
  if (cursor) {
    for (let index = 1; index < points.length - 1; index++) {
      const previous = points[index - 1];
      const current = points[index];
      const next = points[index + 1];
      const incomingX = current.x - previous.x;
      const incomingY = current.y - previous.y;
      const outgoingX = next.x - current.x;
      const outgoingY = next.y - current.y;
      if (
        incomingX * outgoingY === incomingY * outgoingX
        && incomingX * outgoingX + incomingY * outgoingY > 0
      ) continue;
      const entry = pointOnSegment(previous, current, curveRadius);
      const exit = pointOnSegment(next, current, curveRadius);
      if (!samePoint(cursor, entry)) segments.push({ kind: "line", from: cursor, to: entry });
      segments.push({ kind: "curve", from: entry, control: current, to: exit });
      cursor = exit;
    }
    const last = points[points.length - 1];
    if (last && !samePoint(cursor, last)) segments.push({ kind: "line", from: cursor, to: last });
  }

  const mutableByChunk = new Map<string, VoyageSenseThreadSegment[]>();
  const chunkWorldSize = world.chunkSize * tileSize;
  const maxChunkX = Math.ceil(world.width / world.chunkSize) - 1;
  const maxChunkY = Math.ceil(world.height / world.chunkSize) - 1;
  for (const segment of segments) {
    const bounds = segmentBounds(segment, strokePadding);
    const minChunkX = Math.max(0, Math.floor(bounds.minX / chunkWorldSize));
    const maxSegmentChunkX = Math.min(maxChunkX, Math.floor(bounds.maxX / chunkWorldSize));
    const minChunkY = Math.max(0, Math.floor(bounds.minY / chunkWorldSize));
    const maxSegmentChunkY = Math.min(maxChunkY, Math.floor(bounds.maxY / chunkWorldSize));
    for (let chunkY = minChunkY; chunkY <= maxSegmentChunkY; chunkY++) {
      for (let chunkX = minChunkX; chunkX <= maxSegmentChunkX; chunkX++) {
        const key = `${chunkX},${chunkY}`;
        const bucket = mutableByChunk.get(key) ?? [];
        bucket.push(segment);
        mutableByChunk.set(key, bucket);
      }
    }
  }

  return { segments, segmentsByChunk: mutableByChunk };
}
