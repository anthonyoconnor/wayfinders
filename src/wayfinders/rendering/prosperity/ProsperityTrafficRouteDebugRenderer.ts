import Phaser from "phaser";
import { prototypeConfig } from "../../config/prototypeConfig";
import type {
  ProsperityTrafficRouteReadModelV1,
  ProsperityTrafficRouteV1,
} from "../../features/prosperity";
import type { WorldGrid } from "../../world/WorldGrid";
import {
  buildVoyageSenseThread,
  type VoyageSenseThreadGeometry,
  type VoyageSenseThreadSegment,
} from "../VoyageSenseThread";
import type { ActiveChunkEntry } from "../activation";

export const PROSPERITY_FISHING_ROUTE_DEBUG_COLOR = 0x43d6ce as const;
export const PROSPERITY_TRADE_ROUTE_DEBUG_COLOR = 0xe2a34b as const;
export const PROSPERITY_TRAFFIC_ROUTE_DEBUG_DEPTH = 69 as const;

const FISHING_CORE_WIDTH = 3;
const FISHING_HALO_WIDTH = 7;
const TRADE_CORE_WIDTH = 5;
const TRADE_HALO_WIDTH = 9;
const CURVE_STEPS = 5;

interface CachedRouteGeometry {
  readonly route: Readonly<ProsperityTrafficRouteV1>;
  readonly geometry: Readonly<VoyageSenseThreadGeometry>;
}

export interface ProsperityTrafficRouteDebugTelemetry {
  readonly allocatedGraphics: 1;
  readonly visible: boolean;
  readonly fishingVisible: boolean;
  readonly tradeVisible: boolean;
  readonly routeRevision: number;
  readonly routeCount: number;
  readonly geometryBuilds: number;
  readonly redraws: number;
  readonly drawnSegments: number;
}

/**
 * Scene-owned diagnostic projection of the already-authoritative traffic paths.
 * It never searches, mutates route state, or filters the immutable route model
 * down to the craft currently admitted by the presentation scheduler.
 */
export class ProsperityTrafficRouteDebugRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private activeChunks: readonly Readonly<ActiveChunkEntry>[] = Object.freeze([]);
  private readModel?: Readonly<ProsperityTrafficRouteReadModelV1>;
  private world?: WorldGrid;
  private tileSize = 0;
  private curveRadius = Number.NaN;
  private cachedRoutes: readonly Readonly<CachedRouteGeometry>[] = Object.freeze([]);
  private dirty = true;
  private fishingVisible = false;
  private tradeVisible = false;
  private routeRevision = 0;
  private routeCount = 0;
  private geometryBuilds = 0;
  private redraws = 0;
  private drawnSegments = 0;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
      .setDepth(PROSPERITY_TRAFFIC_ROUTE_DEBUG_DEPTH)
      .setName("prosperity-traffic-route-debug")
      .setVisible(false);
  }

  applyActiveChunks(chunks: readonly Readonly<ActiveChunkEntry>[]): void {
    if (this.activeChunks === chunks) return;
    this.activeChunks = chunks;
    this.dirty = true;
  }

  sync(
    routes: Readonly<ProsperityTrafficRouteReadModelV1>,
    world: WorldGrid,
    tileSize: number,
    fishingVisible: boolean,
    tradeVisible: boolean,
  ): void {
    if (!Number.isFinite(tileSize) || tileSize <= 0) {
      throw new RangeError("Prosperity traffic route debug tile size must be finite and positive");
    }
    const curveRadius = prototypeConfig.overlays.returnThreadCurveRadius;
    const geometryChanged = this.readModel !== routes
      || this.world !== world
      || this.tileSize !== tileSize
      || this.curveRadius !== curveRadius;
    if (geometryChanged) {
      this.readModel = routes;
      this.world = world;
      this.tileSize = tileSize;
      this.curveRadius = curveRadius;
      this.cachedRoutes = Object.freeze([]);
      this.dirty = true;
    }
    if (
      this.fishingVisible !== fishingVisible
      || this.tradeVisible !== tradeVisible
    ) {
      this.fishingVisible = fishingVisible;
      this.tradeVisible = tradeVisible;
      this.dirty = true;
    }
    this.routeRevision = routes.revision;
    this.routeCount = routes.routes.length;
    if (!this.dirty) return;

    const visible = fishingVisible || tradeVisible;
    this.graphics.clear().setVisible(visible);
    this.drawnSegments = 0;
    this.redraws++;
    this.dirty = false;
    if (!visible) return;

    if (this.cachedRoutes.length === 0 && routes.routes.length > 0) {
      const strokePadding = Math.max(FISHING_HALO_WIDTH, TRADE_HALO_WIDTH) / 2;
      this.cachedRoutes = Object.freeze(routes.routes.map((route) => Object.freeze({
        route,
        geometry: buildVoyageSenseThread(
          world,
          route.pathEdges,
          tileSize,
          curveRadius,
          strokePadding,
        ),
      })));
      this.geometryBuilds++;
    }

    // The wider trade line goes down first. A shared Home stem therefore keeps
    // an ochre edge around the narrower turquoise fishing core.
    this.drawFamily("trade", PROSPERITY_TRADE_ROUTE_DEBUG_COLOR, TRADE_HALO_WIDTH, TRADE_CORE_WIDTH);
    this.drawFamily("fishing", PROSPERITY_FISHING_ROUTE_DEBUG_COLOR, FISHING_HALO_WIDTH, FISHING_CORE_WIDTH);
  }

  getTelemetry(): Readonly<ProsperityTrafficRouteDebugTelemetry> {
    return Object.freeze({
      allocatedGraphics: 1,
      visible: this.fishingVisible || this.tradeVisible,
      fishingVisible: this.fishingVisible,
      tradeVisible: this.tradeVisible,
      routeRevision: this.routeRevision,
      routeCount: this.routeCount,
      geometryBuilds: this.geometryBuilds,
      redraws: this.redraws,
      drawnSegments: this.drawnSegments,
    });
  }

  destroy(): void {
    this.graphics.destroy();
    this.activeChunks = Object.freeze([]);
    this.cachedRoutes = Object.freeze([]);
    this.drawnSegments = 0;
  }

  private drawFamily(
    kind: ProsperityTrafficRouteV1["kind"],
    color: number,
    haloWidth: number,
    coreWidth: number,
  ): void {
    if (kind === "fishing" ? !this.fishingVisible : !this.tradeVisible) return;
    const projected: VoyageSenseThreadSegment[] = [];
    const identities = new Set<string>();
    for (const cached of this.cachedRoutes) {
      if (cached.route.kind !== kind) continue;
      for (const segment of this.projectVisibleSegments(cached.geometry)) {
        const identity = segmentIdentity(segment);
        if (identities.has(identity)) continue;
        identities.add(identity);
        projected.push(segment);
      }
    }
    if (projected.length === 0) return;
    this.drawnSegments += projected.length;
    this.strokeSegments(projected, haloWidth, color, 0.2);
    this.strokeSegments(projected, coreWidth, color, 0.88);
  }

  private projectVisibleSegments(
    geometry: Readonly<VoyageSenseThreadGeometry>,
  ): readonly Readonly<VoyageSenseThreadSegment>[] {
    const projected: VoyageSenseThreadSegment[] = [];
    const identities = new Set<string>();
    for (const entry of this.activeChunks) {
      const key = `${entry.canonicalChunk.x},${entry.canonicalChunk.y}`;
      const bucket = geometry.segmentsByChunk.get(key);
      if (!bucket) continue;
      for (const segment of bucket) {
        const translated = translateSegment(segment, entry.imageOffset.x, entry.imageOffset.y);
        const identity = segmentIdentity(translated);
        if (identities.has(identity)) continue;
        identities.add(identity);
        projected.push(translated);
      }
    }
    return Object.freeze(projected);
  }

  private strokeSegments(
    segments: readonly Readonly<VoyageSenseThreadSegment>[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    this.graphics.lineStyle(width, color, alpha).beginPath();
    for (const segment of segments) {
      this.graphics.moveTo(segment.from.x, segment.from.y);
      if (segment.kind === "line") {
        this.graphics.lineTo(segment.to.x, segment.to.y);
        continue;
      }
      for (let step = 1; step <= CURVE_STEPS; step++) {
        const progress = step / CURVE_STEPS;
        const inverse = 1 - progress;
        this.graphics.lineTo(
          inverse * inverse * segment.from.x
            + 2 * inverse * progress * segment.control.x
            + progress * progress * segment.to.x,
          inverse * inverse * segment.from.y
            + 2 * inverse * progress * segment.control.y
            + progress * progress * segment.to.y,
        );
      }
    }
    this.graphics.strokePath();
  }
}

function translateSegment(
  segment: Readonly<VoyageSenseThreadSegment>,
  offsetX: number,
  offsetY: number,
): VoyageSenseThreadSegment {
  const translate = ({ x, y }: Readonly<{ x: number; y: number }>) => ({
    x: x + offsetX,
    y: y + offsetY,
  });
  return segment.kind === "curve"
    ? Object.freeze({
      kind: "curve" as const,
      from: Object.freeze(translate(segment.from)),
      control: Object.freeze(translate(segment.control)),
      to: Object.freeze(translate(segment.to)),
    })
    : Object.freeze({
      kind: "line" as const,
      from: Object.freeze(translate(segment.from)),
      to: Object.freeze(translate(segment.to)),
    });
}

function segmentIdentity(segment: Readonly<VoyageSenseThreadSegment>): string {
  return segment.kind === "curve"
    ? `c:${segment.from.x},${segment.from.y}:${segment.control.x},${segment.control.y}:${segment.to.x},${segment.to.y}`
    : `l:${segment.from.x},${segment.from.y}:${segment.to.x},${segment.to.y}`;
}
