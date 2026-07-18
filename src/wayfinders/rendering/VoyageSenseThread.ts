import type { ReturnPathEdge } from "../exploration/ReturnPathSystem";
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
  /** Short segments in one continuous lifted path image. */
  readonly segments: readonly VoyageSenseThreadSegment[];
  /** Canonical texture-local copies, keyed by canonical chunk coordinate. */
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

function translateSegment(
  segment: VoyageSenseThreadSegment,
  offsetX: number,
  offsetY: number,
): VoyageSenseThreadSegment {
  const translate = ({ x, y }: ThreadPoint): ThreadPoint => ({
    x: x - offsetX,
    y: y - offsetY,
  });
  return segment.kind === "curve"
    ? {
      kind: "curve",
      from: translate(segment.from),
      control: translate(segment.control),
      to: translate(segment.to),
    }
    : { kind: "line", from: translate(segment.from), to: translate(segment.to) };
}

function segmentIdentity(segment: VoyageSenseThreadSegment): string {
  return segment.kind === "curve"
    ? `c:${segment.from.x},${segment.from.y}:${segment.control.x},${segment.control.y}:${segment.to.x},${segment.to.y}`
    : `l:${segment.from.x},${segment.from.y}:${segment.to.x},${segment.to.y}`;
}

/**
 * Adapts retained direction-preserving return edges into rounded lifted
 * segments. Every seam edge stays one tile long. Canonical chunk buckets hold
 * translated copies for shared textures, so aliases never draw a cross-map
 * chord and width-two directional winding remains visible.
 */
export function buildVoyageSenseThread(
  world: WorldGrid,
  pathEdges: readonly Readonly<ReturnPathEdge>[],
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
  if (pathEdges.length === 0) return { segments: [], segmentsByChunk: new Map() };

  const points: ThreadPoint[] = [{
    x: (pathEdges[0]!.liftedFrom.x + 0.5) * tileSize,
    y: (pathEdges[0]!.liftedFrom.y + 0.5) * tileSize,
  }];
  for (const edge of pathEdges) {
    points.push({
      x: (edge.liftedTo.x + 0.5) * tileSize,
      y: (edge.liftedTo.y + 0.5) * tileSize,
    });
  }

  const turns = new Map<number, Readonly<{ entry: ThreadPoint; exit: ThreadPoint }>>();
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incomingX = current.x - previous.x;
    const incomingY = current.y - previous.y;
    const outgoingX = next.x - current.x;
    const outgoingY = next.y - current.y;
    if (
      incomingX * outgoingY === incomingY * outgoingX
      && incomingX * outgoingX + incomingY * outgoingY > 0
    ) continue;
    turns.set(index, {
      entry: pointOnSegment(previous, current, curveRadius),
      exit: pointOnSegment(next, current, curveRadius),
    });
  }
  const segments: VoyageSenseThreadSegment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const from = turns.get(index)?.exit ?? points[index]!;
    const to = turns.get(index + 1)?.entry ?? points[index + 1]!;
    if (!samePoint(from, to)) segments.push({ kind: "line", from, to });
    const nextTurn = turns.get(index + 1);
    if (nextTurn) {
      segments.push({
        kind: "curve",
        from: nextTurn.entry,
        control: points[index + 1]!,
        to: nextTurn.exit,
      });
    }
  }

  const mutableByChunk = new Map<string, VoyageSenseThreadSegment[]>();
  const identitiesByChunk = new Map<string, Set<string>>();
  for (const segment of segments) {
    const bounds = segmentBounds(segment, strokePadding);
    const tileBounds = {
      minX: Math.floor(bounds.minX / tileSize),
      minY: Math.floor(bounds.minY / tileSize),
      maxX: Math.floor(bounds.maxX / tileSize),
      maxY: Math.floor(bounds.maxY / tileSize),
    };
    for (const image of world.topology.periodicChunkImagesForBounds(tileBounds)) {
      const translated = translateSegment(segment, image.imageOffset.x, image.imageOffset.y);
      const key = `${image.canonicalChunk.x},${image.canonicalChunk.y}`;
      const identity = segmentIdentity(translated);
      const identities = identitiesByChunk.get(key) ?? new Set<string>();
      if (identities.has(identity)) continue;
      identities.add(identity);
      identitiesByChunk.set(key, identities);
      const bucket = mutableByChunk.get(key) ?? [];
      bucket.push(translated);
      mutableByChunk.set(key, bucket);
    }
  }

  return {
    segments: Object.freeze(segments),
    segmentsByChunk: new Map(
      [...mutableByChunk].map(([key, bucket]) => [key, Object.freeze(bucket)] as const),
    ),
  };
}
