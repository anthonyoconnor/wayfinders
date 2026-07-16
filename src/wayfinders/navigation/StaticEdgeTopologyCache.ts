import type { PrototypeConfig } from "../config/prototypeConfig";
import type { WorldGrid } from "../world/WorldGrid";

export const STATIC_EDGE_BLOCKER = Object.freeze({
  source: 1 << 0,
  destination: 1 << 1,
  otherTile: 1 << 2,
  worldBounds: 1 << 3,
});

export interface StaticEdgeTopologyStats {
  readonly collisionVersion: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly classifiedEdges: number;
}

interface StaticTopologyData {
  readonly collisionVersion: number;
  readonly nodeStates: Uint8Array;
  readonly knownEdges: Uint8Array;
  readonly edgeBlockers: Uint8Array;
  cacheHits: number;
  cacheMisses: number;
  classifiedEdges: number;
}

const topologyCaches = new WeakMap<WorldGrid, Map<string, StaticTopologyData>>();

function cacheKey(config: Pick<PrototypeConfig, "navigation" | "movement">): string {
  return config.navigation.tileSize + ":" + config.movement.shipCollisionHalfExtent;
}

function topologyData(
  world: WorldGrid,
  config: Pick<PrototypeConfig, "navigation" | "movement">,
): StaticTopologyData {
  let byConfig = topologyCaches.get(world);
  if (!byConfig) {
    byConfig = new Map();
    topologyCaches.set(world, byConfig);
  }
  const key = cacheKey(config);
  let data = byConfig.get(key);
  if (!data || data.collisionVersion !== world.collisionVersion) {
    data = {
      collisionVersion: world.collisionVersion,
      nodeStates: new Uint8Array(world.tileCount),
      knownEdges: new Uint8Array(world.tileCount * 4),
      edgeBlockers: new Uint8Array(world.tileCount * 4),
      cacheHits: 0,
      cacheMisses: 0,
      classifiedEdges: 0,
    };
    byConfig.set(key, data);
  }
  return data;
}

export class StaticEdgeTopologyCache {
  private data: StaticTopologyData;

  constructor(
    private readonly world: WorldGrid,
    private readonly config: Pick<PrototypeConfig, "navigation" | "movement">,
  ) {
    this.data = topologyData(world, config);
  }

  nodeState(index: number): number {
    return this.currentData().nodeStates[index];
  }

  setNodeState(index: number, passable: boolean): void {
    this.currentData().nodeStates[index] = passable ? 2 : 1;
  }

  edgeBlockersAt(from: number, direction: number): number | undefined {
    const slot = from * 4 + direction;
    const data = this.currentData();
    if (data.knownEdges[slot] === 0) {
      data.cacheMisses++;
      return undefined;
    }
    data.cacheHits++;
    return data.edgeBlockers[slot];
  }

  setEdgeBlockersAt(
    from: number,
    direction: number,
    to: number,
    reverseDirection: number,
    blockers: number,
  ): void {
    const slot = from * 4 + direction;
    const reverseSlot = to * 4 + reverseDirection;
    const data = this.currentData();
    data.knownEdges[slot] = 1;
    data.edgeBlockers[slot] = blockers;
    data.knownEdges[reverseSlot] = 1;
    data.edgeBlockers[reverseSlot] = this.reverseBlockers(blockers);
    data.classifiedEdges++;
  }

  stats(): StaticEdgeTopologyStats {
    const data = this.currentData();
    return {
      collisionVersion: data.collisionVersion,
      cacheHits: data.cacheHits,
      cacheMisses: data.cacheMisses,
      classifiedEdges: data.classifiedEdges,
    };
  }

  private reverseBlockers(blockers: number): number {
    let reversed = blockers & (STATIC_EDGE_BLOCKER.otherTile | STATIC_EDGE_BLOCKER.worldBounds);
    if ((blockers & STATIC_EDGE_BLOCKER.source) !== 0) reversed |= STATIC_EDGE_BLOCKER.destination;
    if ((blockers & STATIC_EDGE_BLOCKER.destination) !== 0) reversed |= STATIC_EDGE_BLOCKER.source;
    return reversed;
  }

  private currentData(): StaticTopologyData {
    if (this.data.collisionVersion !== this.world.collisionVersion) {
      this.data = topologyData(this.world, this.config);
    }
    return this.data;
  }
}
