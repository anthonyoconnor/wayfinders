import Phaser from "phaser";
import type { ProsperityTrafficRouteReadModelV1 } from "../features/prosperity";
import type { WorldPoint } from "../core/types";
import type { WorldTopology } from "../world/WorldTopology";
import type { ActiveChunkEntry } from "./activation";
import {
  ProsperityTrafficPresentationScheduler,
  prosperityTrafficPlayerFadeAlpha,
  type ProsperityTrafficVesselPresentation,
} from "./prosperity";

export const PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS = 3 as const;
export const PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS = 8 as const;
export const PROSPERITY_TRAFFIC_HOME_AREA_TILES = 2.25 as const;
export const PROSPERITY_TRAFFIC_DEPTH = 1.8 as const;

const FISHING_ALPHA = 0.66;
const TRADE_ALPHA = 0.72;

interface ProsperityTrafficView {
  readonly container: Phaser.GameObjects.Container;
  readonly wake: Phaser.GameObjects.Graphics;
  readonly fishingCraft: Phaser.GameObjects.Graphics;
  readonly tradeCraft: Phaser.GameObjects.Graphics;
}

interface TrafficCandidate {
  readonly vessel: Readonly<ProsperityTrafficVesselPresentation>;
  readonly canonicalWorld: Readonly<WorldPoint>;
  readonly alpha: number;
  readonly entries: readonly Readonly<ActiveChunkEntry>[];
  readonly visible: boolean;
}

interface TrafficViewRequest {
  readonly candidate: Readonly<TrafficCandidate>;
  readonly entry: Readonly<ActiveChunkEntry>;
}

export interface ProsperityTrafficRendererTelemetry {
  readonly capacity: typeof PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS;
  readonly allocatedViews: typeof PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS;
  readonly frames: number;
  readonly routeRevision: number;
  readonly routeCount: number;
  readonly selectionEpoch: number;
  readonly scheduledVessels: number;
  readonly visibleCanonicalVessels: number;
  readonly activeViews: number;
  readonly peakActiveViews: number;
  readonly stableFrameGameObjectAllocations: 0;
  readonly reducedMotion: boolean;
}

/**
 * Fixed-capacity, presentation-only fishing and trade traffic.
 *
 * All Phaser objects are allocated at construction. Sync samples at most four
 * descriptors and projects them into the existing ActiveChunkSet images; it
 * owns no physics, input, gameplay event, timer, or world mutation.
 */
export class ProsperityTrafficRenderer {
  private readonly views: readonly ProsperityTrafficView[];
  private readonly scheduler = new ProsperityTrafficPresentationScheduler();
  private activeChunks: readonly Readonly<ActiveChunkEntry>[] = Object.freeze([]);
  private frames = 0;
  private routeRevision = 0;
  private routeCount = 0;
  private selectionEpoch = 0;
  private scheduledVessels = 0;
  private visibleCanonicalVessels = 0;
  private activeViews = 0;
  private peakActiveViews = 0;
  private reducedMotion = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.views = Object.freeze(Array.from(
      { length: PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS },
      () => this.createView(),
    ));
  }

  applyActiveChunks(chunks: readonly Readonly<ActiveChunkEntry>[]): void {
    this.activeChunks = chunks;
  }

  sync(
    routes: Readonly<ProsperityTrafficRouteReadModelV1>,
    topology: WorldTopology,
    tileSize: number,
    elapsedMilliseconds: number,
    playerWorld: Readonly<WorldPoint>,
    reducedMotion = false,
  ): void {
    if (!Number.isFinite(tileSize) || tileSize <= 0) {
      throw new RangeError("Prosperity traffic tile size must be finite and positive");
    }
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
      throw new RangeError("Prosperity traffic elapsed milliseconds must be finite and non-negative");
    }

    const frame = this.scheduler.sample(
      routes,
      elapsedMilliseconds / 1_000,
      reducedMotion,
    );
    const candidates = this.selectCandidates(
      fairAdmissionOrder(frame.vessels, frame.selectionEpoch),
      topology,
      tileSize,
      playerWorld,
    );
    const requests = this.viewRequests(candidates);

    for (let index = 0; index < this.views.length; index++) {
      const view = this.views[index];
      const request = requests[index];
      if (!request) {
        view.container
          .setActive(false)
          .setVisible(false)
          .setName("prosperity-traffic:pooled");
        continue;
      }
      this.updateView(view, request, tileSize);
    }

    this.frames++;
    this.routeRevision = routes.revision;
    this.routeCount = routes.routes.length;
    this.selectionEpoch = frame.selectionEpoch;
    this.scheduledVessels = frame.vessels.length;
    this.visibleCanonicalVessels = candidates.filter(({ visible }) => visible).length;
    this.activeViews = requests.length;
    this.peakActiveViews = Math.max(this.peakActiveViews, requests.length);
    this.reducedMotion = reducedMotion;
  }

  getTelemetry(): Readonly<ProsperityTrafficRendererTelemetry> {
    return Object.freeze({
      capacity: PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS,
      allocatedViews: PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS,
      frames: this.frames,
      routeRevision: this.routeRevision,
      routeCount: this.routeCount,
      selectionEpoch: this.selectionEpoch,
      scheduledVessels: this.scheduledVessels,
      visibleCanonicalVessels: this.visibleCanonicalVessels,
      activeViews: this.activeViews,
      peakActiveViews: this.peakActiveViews,
      stableFrameGameObjectAllocations: 0,
      reducedMotion: this.reducedMotion,
    });
  }

  destroy(): void {
    for (const view of this.views) view.container.destroy(true);
    this.activeChunks = Object.freeze([]);
    this.activeViews = 0;
  }

  private selectCandidates(
    vessels: readonly Readonly<ProsperityTrafficVesselPresentation>[],
    topology: WorldTopology,
    tileSize: number,
    playerWorld: Readonly<WorldPoint>,
  ): readonly Readonly<TrafficCandidate>[] {
    const candidates: TrafficCandidate[] = [];
    let homeAreaOccupied = false;
    let visibleCount = 0;
    for (const vessel of vessels) {
      const canonicalWorld = topology.canonicalizeWorld(
        vessel.liftedTileX * tileSize,
        vessel.liftedTileY * tileSize,
      );
      if (!canonicalWorld) continue;
      const playerDistanceTiles = Math.sqrt(topology.minimumImageWorldDistanceSquared(
        playerWorld,
        canonicalWorld,
      )) / tileSize;
      const alpha = prosperityTrafficPlayerFadeAlpha(playerDistanceTiles);
      if (alpha <= 0) continue;

      const canonicalHomeWorld = topology.canonicalizeWorld(
        vessel.homeCanonicalTileX * tileSize,
        vessel.homeCanonicalTileY * tileSize,
      );
      if (!canonicalHomeWorld) continue;
      const homeDistanceTiles = Math.sqrt(topology.minimumImageWorldDistanceSquared(
        canonicalHomeWorld,
        canonicalWorld,
      )) / tileSize;

      const canonicalTileX = Math.floor(canonicalWorld.x / tileSize);
      const canonicalTileY = Math.floor(canonicalWorld.y / tileSize);
      const chunkX = Math.floor(canonicalTileX / topology.chunkSize);
      const chunkY = Math.floor(canonicalTileY / topology.chunkSize);
      const entries = this.activeChunks.filter(({ canonicalChunk }) => (
        canonicalChunk.x === chunkX && canonicalChunk.y === chunkY
      ));
      if (entries.length === 0) continue;

      const inHomeArea = homeDistanceTiles < PROSPERITY_TRAFFIC_HOME_AREA_TILES;
      if (inHomeArea && homeAreaOccupied) continue;
      const visible = entries.some(({ band }) => band === "visible");
      if (visible && visibleCount >= PROSPERITY_TRAFFIC_MAX_VISIBLE_VESSELS) continue;

      candidates.push(Object.freeze({
        vessel,
        canonicalWorld: Object.freeze({ ...canonicalWorld }),
        alpha,
        entries,
        visible,
      }));
      if (inHomeArea) homeAreaOccupied = true;
      if (visible) visibleCount++;
    }
    return Object.freeze(candidates);
  }

  private viewRequests(
    candidates: readonly Readonly<TrafficCandidate>[],
  ): readonly Readonly<TrafficViewRequest>[] {
    const requests: TrafficViewRequest[] = [];
    let aliasIndex = 0;
    while (requests.length < PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS) {
      let added = false;
      for (const candidate of candidates) {
        const entry = candidate.entries[aliasIndex];
        if (!entry) continue;
        requests.push(Object.freeze({ candidate, entry }));
        added = true;
        if (requests.length === PROSPERITY_TRAFFIC_MAX_PERIODIC_VIEWS) break;
      }
      if (!added) break;
      aliasIndex++;
    }
    return Object.freeze(requests);
  }

  private updateView(
    view: ProsperityTrafficView,
    request: Readonly<TrafficViewRequest>,
    tileSize: number,
  ): void {
    const { candidate, entry } = request;
    const { vessel } = candidate;
    const baseAlpha = vessel.kind === "fishing" ? FISHING_ALPHA : TRADE_ALPHA;
    view.container
      .setActive(true)
      .setVisible(true)
      .setName(`${vessel.id}@${entry.viewKey}`)
      .setPosition(
        candidate.canonicalWorld.x + entry.imageOffset.x,
        candidate.canonicalWorld.y + entry.imageOffset.y,
      )
      .setRotation(Phaser.Math.DegToRad(vessel.headingDegrees))
      .setScale(tileSize / 32)
      .setAlpha(baseAlpha * candidate.alpha);
    view.wake.setVisible(vessel.wakeVisible);
    view.fishingCraft.setVisible(vessel.kind === "fishing");
    view.tradeCraft.setVisible(vessel.kind === "trade");
  }

  private createView(): ProsperityTrafficView {
    const wake = this.scene.add.graphics();
    wake.lineStyle(1, 0xa8e4e4, 0.3);
    wake.beginPath();
    wake.moveTo(-7, -2.5);
    wake.lineTo(-15, -5);
    wake.moveTo(-7, 2.5);
    wake.lineTo(-15, 5);
    wake.strokePath();

    const fishingCraft = this.scene.add.graphics();
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

    const tradeCraft = this.scene.add.graphics();
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

    const container = this.scene.add.container(0, 0, [wake, fishingCraft, tradeCraft])
      .setDepth(PROSPERITY_TRAFFIC_DEPTH)
      .setActive(false)
      .setVisible(false)
      .setName("prosperity-traffic:pooled");
    return { container, wake, fishingCraft, tradeCraft };
  }
}

/**
 * The shared three-vessel cap rotates family and slot priority only at a
 * completed service-round handoff. With four visible descriptors, the dropped
 * slot cycles across all four instead of permanently starving one family.
 */
function fairAdmissionOrder(
  vessels: readonly Readonly<ProsperityTrafficVesselPresentation>[],
  selectionEpoch: number,
): readonly Readonly<ProsperityTrafficVesselPresentation>[] {
  const fishing = vessels.filter(({ kind }) => kind === "fishing");
  const trade = vessels.filter(({ kind }) => kind === "trade");
  const rotateSlots = Math.floor(selectionEpoch / 2) % 2 === 1;
  if (rotateSlots) {
    if (fishing.length > 1) fishing.push(fishing.shift()!);
    if (trade.length > 1) trade.push(trade.shift()!);
  }
  const ordered: Readonly<ProsperityTrafficVesselPresentation>[] = [];
  if (selectionEpoch % 2 === 0) {
    const slots = Math.max(fishing.length, trade.length);
    for (let index = 0; index < slots; index++) {
      if (fishing[index]) ordered.push(fishing[index]!);
      if (trade[index]) ordered.push(trade[index]!);
    }
  } else {
    const slots = Math.max(fishing.length, trade.length);
    for (let index = slots - 1; index >= 0; index--) {
      if (trade[index]) ordered.push(trade[index]!);
      if (fishing[index]) ordered.push(fishing[index]!);
    }
  }
  return Object.freeze(ordered);
}
