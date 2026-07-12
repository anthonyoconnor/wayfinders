import type { GridPoint } from "./types";

export interface GameEventMap {
  shipEnteredTile: GridPoint;
  knowledgeChanged: { count: number };
  provisionConsumed: { remaining: number };
  provisionsChanged: { previous: number; current: number };
  returnStateChanged: undefined;
  worldRegenerated: { seed: number };
  shipTeleported: GridPoint;
}

export type GameEventName = keyof GameEventMap;

type Listener<T> = (payload: T) => void;

/** Small typed event bus shared by the headless simulation and adapters. */
export class GameEvents {
  private readonly listeners = new Map<GameEventName, Set<Listener<never>>>();

  on<K extends GameEventName>(name: K, listener: Listener<GameEventMap[K]>): () => void {
    let group = this.listeners.get(name);
    if (!group) {
      group = new Set();
      this.listeners.set(name, group);
    }
    group.add(listener as Listener<never>);
    return () => group?.delete(listener as Listener<never>);
  }

  emit<K extends GameEventName>(name: K, payload: GameEventMap[K]): void {
    const group = this.listeners.get(name);
    if (!group) return;
    for (const listener of group) (listener as Listener<GameEventMap[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
