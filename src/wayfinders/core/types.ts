export interface GridPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export interface ArtPoint {
  x: number;
  y: number;
}

export interface ShipState {
  worldX: number;
  worldY: number;
  /** Degrees, where zero points east and positive rotation points south. */
  heading: number;
  /** Current speed in world pixels per second. */
  speed: number;
  currentTileX: number;
  currentTileY: number;
  provisions: number;
  provisionAccumulator: number;
}

export type ShipwreckSurveyState =
  | { readonly state: "unexamined" }
  | { readonly state: "provisional"; readonly expeditionId: number; readonly generation: number }
  | { readonly state: "returned"; readonly expeditionId: number; readonly generation: number };

/** Persistent record of a ship lost during an expedition. */
export interface ShipwreckState {
  id: number;
  generation: number;
  expeditionId: number;
  worldX: number;
  worldY: number;
  tileX: number;
  tileY: number;
  heading: number;
  discovered: boolean;
  survey: ShipwreckSurveyState;
}

export interface MovementInput {
  /** Normalized steering in the inclusive range -1..1. */
  turn: number;
  /** Normalized thrust in the inclusive range -1..1. */
  throttle: number;
}

export interface TravelSegment {
  fromWorldX: number;
  fromWorldY: number;
  toWorldX: number;
  toWorldY: number;
  distancePixels: number;
  tileX: number;
  tileY: number;
}

export interface MovementResult {
  movedDistancePixels: number;
  collided: boolean;
  enteredTiles: GridPoint[];
  segments: TravelSegment[];
  tileChanged: boolean;
}
