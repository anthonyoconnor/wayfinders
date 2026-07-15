import type {
  FishingShoalInteractionCommandV1,
  FishingShoalInteractionResultV1,
} from "../exploration/FishingShoalContracts";
import type {
  IslandDossierInteractionCommandV1,
  IslandDossierInteractionResultV1,
} from "../exploration/IslandDossierContracts";
import type {
  SurveySiteInteractionCommand,
  SurveySiteInteractionResult,
} from "../exploration/SurveySiteContracts";
import type {
  WreckSurveyInteractionCommandV1,
  WreckSurveyInteractionResultV1,
} from "../exploration/WreckSurveyContracts";
import type { SessionConfig } from "../config/SessionConfig";
import {
  GameSimulation,
  type GameSimulationOptions,
  type SimulationSnapshot,
} from "../core/GameSimulation";
import type { GameEventMap, GameEventName } from "../core/GameEvents";
import type { SimulationTraceSink } from "../core/SimulationTrace";
import type { GridPoint, MovementInput, MovementResult } from "../core/types";
import { SessionBuilder, type SessionDefinition } from "./SessionBuilder";
import {
  captureSessionRevisions,
  createSessionMutation,
  type SessionCommandName,
  type SessionCommandResult,
  type SessionRevisions,
} from "./SessionMutation";

export interface GameSessionReadModel {
  readonly snapshot: SimulationSnapshot;
  readonly revisions: SessionRevisions;
}

/**
 * Command/read-model boundary around the legacy GameSimulation facade.
 * New callers should depend on this class; existing rendering can migrate via
 * `compatibilitySimulation` without a flag-day rewrite.
 */
export class GameSession {
  readonly config: SessionConfig;
  private readonly simulation: GameSimulation;

  constructor(
    definition: SessionDefinition = new SessionBuilder().build(),
    options: Readonly<GameSimulationOptions> = {},
    trace?: SimulationTraceSink,
  ) {
    this.config = definition.config;
    this.simulation = new GameSimulation(definition.config, trace, options);
  }

  /** Transitional escape hatch for presentation that has not moved to read models. */
  get compatibilitySimulation(): GameSimulation {
    return this.simulation;
  }

  read(): GameSessionReadModel {
    return Object.freeze({
      snapshot: this.simulation.snapshot(),
      revisions: captureSessionRevisions(this.simulation),
    });
  }

  on<K extends GameEventName>(name: K, listener: (payload: GameEventMap[K]) => void): () => void {
    return this.simulation.events.on(name, listener);
  }

  advance(input: MovementInput, deltaSeconds: number): SessionCommandResult<MovementResult> {
    return this.execute("advance", () => this.simulation.update(input, deltaSeconds));
  }

  teleport(tile: GridPoint): SessionCommandResult<boolean> {
    return this.execute("teleport", () => this.simulation.teleport(tile));
  }

  regenerate(seed: number): SessionCommandResult<void> {
    return this.execute("regenerate", () => this.simulation.regenerate(seed));
  }

  setProvisions(value: number): SessionCommandResult<void> {
    return this.execute("set-provisions", () => this.simulation.setProvisions(value));
  }

  addProvisions(delta: number): SessionCommandResult<void> {
    return this.execute("add-provisions", () => this.simulation.addProvisions(delta));
  }

  advanceForwardGuidance(): SessionCommandResult<boolean> {
    return this.execute("refresh-guidance", () => this.simulation.advanceForwardGuidance());
  }

  interactWithFishingShoal(
    command: Readonly<FishingShoalInteractionCommandV1>,
  ): SessionCommandResult<FishingShoalInteractionResultV1> {
    return this.execute("fishing.interact", () => this.simulation.interactWithFishingShoal(command));
  }

  interactWithSurveySite(
    command: Readonly<SurveySiteInteractionCommand>,
  ): SessionCommandResult<SurveySiteInteractionResult> {
    return this.execute("survey.interact", () => this.simulation.interactWithSurveySite(command));
  }

  interactWithIslandDossier(
    command: Readonly<IslandDossierInteractionCommandV1>,
  ): SessionCommandResult<IslandDossierInteractionResultV1> {
    return this.execute("dossier.interact", () => this.simulation.interactWithIslandDossier(command));
  }

  interactWithWreck(
    command: Readonly<WreckSurveyInteractionCommandV1>,
  ): SessionCommandResult<WreckSurveyInteractionResultV1> {
    return this.execute("wreck.interact", () => this.simulation.interactWithWreck(command));
  }

  forceWreck(): SessionCommandResult<boolean> {
    return this.execute("force-wreck", () => this.simulation.forceWreck());
  }

  acknowledgeGenerationHandover(): SessionCommandResult<boolean> {
    return this.execute(
      "acknowledge-handover",
      () => this.simulation.acknowledgeGenerationHandover(),
    );
  }

  continueCompletedWorld(): SessionCommandResult<boolean> {
    return this.execute("continue-world", () => this.simulation.continueCompletedWorld());
  }

  startNewGame(): SessionCommandResult<number | undefined> {
    return this.execute("start-new-game", () => this.simulation.startNewGame());
  }

  private execute<T>(command: SessionCommandName, operation: () => T): SessionCommandResult<T> {
    const before = captureSessionRevisions(this.simulation);
    const from = Object.freeze({
      x: this.simulation.ship.currentTileX,
      y: this.simulation.ship.currentTileY,
    });
    const value = operation();
    return Object.freeze({
      value,
      mutation: createSessionMutation(command, this.simulation, before, from),
    });
  }
}
