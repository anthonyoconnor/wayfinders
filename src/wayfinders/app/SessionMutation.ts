import type { GameSimulation } from "../core/GameSimulation";
import type { GridPoint } from "../core/types";

export type SessionCommandName =
  | "advance"
  | "teleport"
  | "regenerate"
  | "set-provisions"
  | "add-provisions"
  | "refresh-guidance"
  | "fishing.interact"
  | "survey.interact"
  | "dossier.interact"
  | "wreck.interact"
  | "force-wreck"
  | "acknowledge-handover"
  | "continue-world"
  | "start-new-game";

/** Stable revision vector consumed by presentation and diagnostics adapters. */
export interface SessionRevisions {
  readonly simulation: number;
  readonly overlays: number;
  readonly lifecycle: number;
  readonly wrecks: number;
  readonly knowledge: number;
  readonly visibility: number;
  readonly supportedTopology: number;
  readonly terrain: number;
  readonly collision: number;
  readonly islandDossiers: number;
  readonly surveySites: number;
  readonly fishingShoals: number;
}

/** Typed invalidation flags; consumers subscribe only to the fields they use. */
export interface SessionChangeFlags {
  readonly simulation: boolean;
  readonly overlays: boolean;
  readonly lifecycle: boolean;
  readonly wrecks: boolean;
  readonly knowledge: boolean;
  readonly visibility: boolean;
  readonly topology: boolean;
  readonly terrain: boolean;
  readonly collision: boolean;
  readonly islandDossiers: boolean;
  readonly surveySites: boolean;
  readonly fishingShoals: boolean;
}

export interface SessionMutation {
  readonly command: SessionCommandName;
  readonly before: SessionRevisions;
  readonly after: SessionRevisions;
  readonly changed: SessionChangeFlags;
  readonly shipTile?: {
    readonly from: Readonly<GridPoint>;
    readonly to: Readonly<GridPoint>;
  };
  /** Logical chunks directly affected by the command's ship-tile transition. */
  readonly changedChunkKeys: readonly string[];
  readonly changedEntities: readonly Readonly<SessionChangedEntity>[];
}

export interface SessionChangedEntity {
  readonly kind: "fishing-shoal" | "survey-site" | "island-dossier" | "wreck";
  readonly id: string | number;
}

export interface SessionMutationEffects {
  readonly changedChunkKeys?: readonly string[];
  readonly changedEntities?: readonly Readonly<SessionChangedEntity>[];
}

export interface SessionCommandResult<T> {
  readonly value: T;
  readonly mutation: SessionMutation;
}

export function captureSessionRevisions(simulation: GameSimulation): SessionRevisions {
  return Object.freeze({
    simulation: simulation.revision,
    overlays: simulation.overlaysRevision,
    lifecycle: simulation.lifecycleResolutionRevision,
    wrecks: simulation.wrecksRevision,
    knowledge: simulation.world.knowledgeVersion,
    visibility: simulation.world.visibilityVersion,
    supportedTopology: simulation.world.supportedTopologyVersion,
    terrain: simulation.world.terrainVersion,
    collision: simulation.world.collisionVersion,
    islandDossiers: simulation.islandDossierRecordsRevision,
    surveySites: simulation.surveySiteRecordsRevision,
    fishingShoals: simulation.fishingShoalRecordsRevision,
  });
}

export function createSessionMutation(
  command: SessionCommandName,
  simulation: GameSimulation,
  before: SessionRevisions,
  from: Readonly<GridPoint>,
  effects: Readonly<SessionMutationEffects> = {},
): SessionMutation {
  const after = captureSessionRevisions(simulation);
  const to = Object.freeze({
    x: simulation.ship.currentTileX,
    y: simulation.ship.currentTileY,
  });
  const tileChanged = from.x !== to.x || from.y !== to.y;
  const changedChunkKeys = Object.freeze([...new Set([
    ...(tileChanged ? [from, to].map((tile) => {
      const chunkX = Math.floor(tile.x / simulation.world.chunkSize);
      const chunkY = Math.floor(tile.y / simulation.world.chunkSize);
      return `${chunkX},${chunkY}`;
    }) : []),
    ...(effects.changedChunkKeys ?? []),
  ])]);

  return Object.freeze({
    command,
    before,
    after,
    changed: Object.freeze({
      simulation: before.simulation !== after.simulation,
      overlays: before.overlays !== after.overlays,
      lifecycle: before.lifecycle !== after.lifecycle,
      wrecks: before.wrecks !== after.wrecks,
      knowledge: before.knowledge !== after.knowledge,
      visibility: before.visibility !== after.visibility,
      topology: before.supportedTopology !== after.supportedTopology,
      terrain: before.terrain !== after.terrain,
      collision: before.collision !== after.collision,
      islandDossiers: before.islandDossiers !== after.islandDossiers,
      surveySites: before.surveySites !== after.surveySites,
      fishingShoals: before.fishingShoals !== after.fishingShoals,
    }),
    shipTile: tileChanged ? Object.freeze({ from: Object.freeze({ ...from }), to }) : undefined,
    changedChunkKeys,
    changedEntities: Object.freeze((effects.changedEntities ?? []).map((entity) => (
      Object.freeze({ ...entity })
    ))),
  });
}
