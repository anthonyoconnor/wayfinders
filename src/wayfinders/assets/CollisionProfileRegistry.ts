import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import {
  validateAuthoredAssetMetadata,
  type AuthoredCollisionProfile,
  type AuthoredFishingShoalMetadata,
  type AuthoredHomeIslandMetadata,
  type AuthoredPlayerBoatMetadata,
} from "./AuthoredAssetContracts";
import fishingShoalPackage from "./packages/fishing-shoal.json";
import homeIslandPackage from "./packages/home-island.json";
import playerBoatPackage from "./packages/player-boat.json";

export const RUNTIME_COLLISION_OBJECT_KINDS = Object.freeze([
  "home-island",
  "generated-island",
  "player-ship",
  "wreck",
  "fishing-shoal",
  "survey-site",
  "survey-service",
  "island-approach",
  "home-dock",
] as const);

export type RuntimeCollisionObjectKind = (typeof RUNTIME_COLLISION_OBJECT_KINDS)[number];

export interface CoarseGridCollisionProfile {
  readonly kind: "coarse-grid";
}

export type RuntimeCollisionProfile = Readonly<AuthoredCollisionProfile> | CoarseGridCollisionProfile;

export interface RuntimeCollisionProfileEntry {
  readonly objectKind: RuntimeCollisionObjectKind;
  readonly source: "authored-package" | "developer-metadata" | "legacy-fallback";
  readonly profile: RuntimeCollisionProfile;
}

export interface RuntimeCollisionProfilePackages {
  readonly homeIsland: Readonly<AuthoredHomeIslandMetadata>;
  readonly playerBoat: Readonly<AuthoredPlayerBoatMetadata>;
  readonly fishingShoal: Readonly<AuthoredFishingShoalMetadata>;
}

const EMPTY = Object.freeze({ kind: "empty" } as const);
const COARSE_GRID = Object.freeze({ kind: "coarse-grid" } as const);

function entry(
  objectKind: RuntimeCollisionObjectKind,
  source: RuntimeCollisionProfileEntry["source"],
  profile: RuntimeCollisionProfile,
): RuntimeCollisionProfileEntry {
  return Object.freeze({ objectKind, source, profile: Object.freeze(profile) });
}

/**
 * One exhaustive registry for authored assets and developer-rendered objects.
 * Empty profiles are deliberate: these objects currently provide interactions
 * or presentation but do not obstruct ship movement.
 */
export class RuntimeCollisionProfileRegistry {
  readonly entries: readonly Readonly<RuntimeCollisionProfileEntry>[];
  private readonly byKind: ReadonlyMap<RuntimeCollisionObjectKind, RuntimeCollisionProfileEntry>;

  constructor(
    packages: Readonly<RuntimeCollisionProfilePackages>,
    config: Pick<PrototypeConfig, "movement"> = prototypeConfig,
  ) {
    const homeProfile = packages.homeIsland.collision ?? COARSE_GRID;
    const playerProfile = packages.playerBoat.collision ?? Object.freeze({
      kind: "box" as const,
      offset: Object.freeze({ x: 0, y: 0 }),
      halfSize: Object.freeze({
        width: config.movement.shipCollisionHalfExtent,
        height: config.movement.shipCollisionHalfExtent,
      }),
    });
    const shoalProfile = packages.fishingShoal.collision ?? EMPTY;
    const authoredSource = (present: boolean): RuntimeCollisionProfileEntry["source"] => (
      present ? "authored-package" : "legacy-fallback"
    );
    const entries = [
      entry("home-island", authoredSource(packages.homeIsland.collision !== undefined), homeProfile),
      entry("generated-island", "developer-metadata", COARSE_GRID),
      entry("player-ship", authoredSource(packages.playerBoat.collision !== undefined), playerProfile),
      entry("wreck", "developer-metadata", EMPTY),
      entry("fishing-shoal", authoredSource(packages.fishingShoal.collision !== undefined), shoalProfile),
      entry("survey-site", "developer-metadata", EMPTY),
      entry("survey-service", "developer-metadata", EMPTY),
      entry("island-approach", "developer-metadata", EMPTY),
      entry("home-dock", "developer-metadata", EMPTY),
    ];
    this.entries = Object.freeze(entries);
    this.byKind = new Map(entries.map((value) => [value.objectKind, value]));
    if (this.byKind.size !== RUNTIME_COLLISION_OBJECT_KINDS.length) {
      throw new Error("Runtime collision profile registry is incomplete or contains duplicate kinds");
    }
  }

  get(objectKind: RuntimeCollisionObjectKind): Readonly<RuntimeCollisionProfileEntry> {
    const value = this.byKind.get(objectKind);
    if (!value) throw new RangeError(`Unknown runtime collision object kind ${objectKind}`);
    return value;
  }

  /** Validates the shape consumed by the square-hull movement implementation. */
  assertMovementConfigCompatible(_config: Pick<PrototypeConfig, "movement">): void {
    const profile = this.get("player-ship").profile;
    if (
      profile.kind !== "box"
      || profile.offset.x !== 0
      || profile.offset.y !== 0
      || profile.halfSize.width !== profile.halfSize.height
    ) {
      throw new RangeError(
        "Player-ship collision profile must define a centered square half-size",
      );
    }
  }

  /**
   * Keeps the authored hull authoritative even though PrototypeConfig's other
   * movement tuning remains intentionally live and mutable. PrototypeConfig's
   * hull is consulted only when a legacy package omits collision metadata.
   */
  createAuthoritativeMovementView(
    movement: PrototypeConfig["movement"],
  ): PrototypeConfig["movement"] {
    this.assertMovementConfigCompatible({ movement });
    const profile = this.get("player-ship").profile;
    if (profile.kind !== "box") throw new TypeError("Player-ship collision profile must be a box");
    const authoredHalfExtent = profile.halfSize.width;
    const view = {} as PrototypeConfig["movement"];
    Object.defineProperties(view, {
      shipSpeed: {
        enumerable: true,
        get: () => movement.shipSpeed,
        set: (value: number) => { movement.shipSpeed = value; },
      },
      turnRate: {
        enumerable: true,
        get: () => movement.turnRate,
        set: (value: number) => { movement.turnRate = value; },
      },
      shipCollisionHalfExtent: {
        enumerable: true,
        configurable: false,
        writable: false,
        value: authoredHalfExtent,
      },
      collisionEpsilon: {
        enumerable: true,
        get: () => movement.collisionEpsilon,
        set: (value: number) => { movement.collisionEpsilon = value; },
      },
    });
    return view;
  }
}

function validatedPilotPackages(): RuntimeCollisionProfilePackages {
  const homeIsland = validateAuthoredAssetMetadata(homeIslandPackage);
  const playerBoat = validateAuthoredAssetMetadata(playerBoatPackage);
  const fishingShoal = validateAuthoredAssetMetadata(fishingShoalPackage);
  if (homeIsland.kind !== "home-island") throw new TypeError("Pilot home package kind mismatch");
  if (playerBoat.kind !== "player-boat") throw new TypeError("Pilot player package kind mismatch");
  if (fishingShoal.kind !== "fishing-shoal") throw new TypeError("Pilot shoal package kind mismatch");
  return Object.freeze({ homeIsland, playerBoat, fishingShoal });
}

export const PILOT_COLLISION_PROFILE_REGISTRY = new RuntimeCollisionProfileRegistry(
  validatedPilotPackages(),
);
