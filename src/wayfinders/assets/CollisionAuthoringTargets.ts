import {
  AUTHORED_ASSET_IDS,
  authoredCellBlocksMovement,
  validateAuthoredAssetMetadata,
  type AuthoredFishingShoalMetadata,
  type AuthoredHomeIslandMetadata,
  type AuthoredPlayerBoatMetadata,
} from "./AuthoredAssetContracts";
import {
  RUNTIME_COLLISION_OBJECT_KINDS,
  RuntimeCollisionProfileRegistry,
  type RuntimeCollisionObjectKind,
  type RuntimeCollisionProfile,
} from "./CollisionProfileRegistry";
import { prototypeConfig, type PrototypeConfig } from "../config/prototypeConfig";
import { EMPTY_COLLISION_MASK, FULL_COLLISION_MASK } from "../world/CollisionMask";
import fishingShoalPackage from "./packages/fishing-shoal.json";
import homeIslandPackage from "./packages/home-island.json";
import playerBoatPackage from "./packages/player-boat.json";

export type CollisionAuthoringMode = "hybrid-grid" | "box" | "explicit-empty" | "read-only";

export interface CollisionAuthoringAnchor {
  readonly id: string;
  readonly label: string;
  /** Navigation-grid coordinate; rendered at the cell centre. */
  readonly x: number;
  readonly y: number;
  readonly requiredClearance: boolean;
}

export interface CollisionAuthoringTarget {
  readonly objectKind: RuntimeCollisionObjectKind;
  readonly label: string;
  readonly source: "authored-package" | "developer-metadata" | "legacy-fallback";
  readonly editing: CollisionAuthoringMode;
  readonly editingNote: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** One uniform coarse fallback mask per navigation cell, row-major. */
  readonly baseMasks: readonly number[];
  readonly profile: RuntimeCollisionProfile;
  readonly anchors: readonly Readonly<CollisionAuthoringAnchor>[];
  readonly visualBounds: Readonly<{ width: number; height: number }>;
  readonly packageMetadata?: Readonly<
    AuthoredHomeIslandMetadata | AuthoredPlayerBoatMetadata | AuthoredFishingShoalMetadata
  >;
}

export interface CollisionAuthoringMetadataOverrides {
  readonly homeIsland?: Readonly<AuthoredHomeIslandMetadata>;
  readonly playerBoat?: Readonly<AuthoredPlayerBoatMetadata>;
  readonly fishingShoal?: Readonly<AuthoredFishingShoalMetadata>;
}

function pilotMetadata(): Required<CollisionAuthoringMetadataOverrides> {
  const homeIsland = validateAuthoredAssetMetadata(homeIslandPackage);
  const playerBoat = validateAuthoredAssetMetadata(playerBoatPackage);
  const fishingShoal = validateAuthoredAssetMetadata(fishingShoalPackage);
  if (homeIsland.kind !== "home-island") throw new TypeError("Pilot home-island package kind mismatch");
  if (playerBoat.kind !== "player-boat") throw new TypeError("Pilot player-boat package kind mismatch");
  if (fishingShoal.kind !== "fishing-shoal") throw new TypeError("Pilot fishing-shoal package kind mismatch");
  return { homeIsland, playerBoat, fishingShoal };
}

const PILOT_METADATA = pilotMetadata();

function uniformMasks(width: number, height: number, mask = EMPTY_COLLISION_MASK): number[] {
  return Array.from({ length: width * height }, () => mask);
}

function frozenMasks(masks: readonly number[]): readonly number[] {
  return Object.freeze([...masks]);
}

function homeTarget(
  metadata: Readonly<AuthoredHomeIslandMetadata>,
  registry: RuntimeCollisionProfileRegistry,
): CollisionAuthoringTarget {
  const registryEntry = registry.get("home-island");
  const masks = uniformMasks(metadata.grid.width, metadata.grid.height);
  for (const cell of metadata.grid.cells) {
    masks[cell.y * metadata.grid.width + cell.x] = authoredCellBlocksMovement(cell)
      ? FULL_COLLISION_MASK
      : EMPTY_COLLISION_MASK;
  }
  return Object.freeze({
    objectKind: "home-island",
    label: "Home island",
    source: registryEntry.source,
    editing: "hybrid-grid",
    editingNote: `Paint sparse 8 px shoreline solids over the authored ${metadata.tileSize} px terrain grid.`,
    width: metadata.grid.width,
    height: metadata.grid.height,
    tileSize: metadata.tileSize,
    baseMasks: frozenMasks(masks),
    profile: registryEntry.profile,
    anchors: Object.freeze(Object.entries(metadata.anchors).map(([id, point]) => Object.freeze({
      id,
      label: id.replace(/([A-Z])/gu, " $1").toLowerCase(),
      x: point.x,
      y: point.y,
      requiredClearance: id !== "homeCenter",
    }))),
    visualBounds: Object.freeze({ ...metadata.render.pixelSize }),
    packageMetadata: metadata,
  });
}

function playerTarget(
  metadata: Readonly<AuthoredPlayerBoatMetadata>,
  registry: RuntimeCollisionProfileRegistry,
): CollisionAuthoringTarget {
  const registryEntry = registry.get("player-ship");
  return Object.freeze({
    objectKind: "player-ship",
    label: "Player ship",
    source: metadata.collision ? "authored-package" : "legacy-fallback",
    editing: "box",
    editingNote: "Edit the centered square gameplay hull; origin remains locked to the package placement point.",
    width: 1,
    height: 1,
    tileSize: metadata.tileSize,
    baseMasks: frozenMasks(uniformMasks(1, 1)),
    profile: registryEntry.profile,
    anchors: Object.freeze([Object.freeze({
      id: "origin",
      label: "placement origin",
      x: 0,
      y: 0,
      requiredClearance: false,
    })]),
    visualBounds: Object.freeze({
      width: metadata.visual.frameSize.width * metadata.visual.scale,
      height: metadata.visual.frameSize.height * metadata.visual.scale,
    }),
    packageMetadata: metadata,
  });
}

function shoalTarget(
  metadata: Readonly<AuthoredFishingShoalMetadata>,
  registry: RuntimeCollisionProfileRegistry,
): CollisionAuthoringTarget {
  const registryEntry = registry.get("fishing-shoal");
  return Object.freeze({
    objectKind: "fishing-shoal",
    label: "Fishing shoal",
    source: metadata.collision ? "authored-package" : "legacy-fallback",
    editing: "explicit-empty",
    editingNote: "This interaction cue is deliberately passable; the empty profile is explicit metadata.",
    width: 1,
    height: 1,
    tileSize: metadata.tileSize,
    baseMasks: frozenMasks(uniformMasks(1, 1)),
    profile: registryEntry.profile,
    anchors: Object.freeze([Object.freeze({
      id: "service",
      label: "service anchor",
      x: metadata.grid.serviceAnchor.x,
      y: metadata.grid.serviceAnchor.y,
      requiredClearance: true,
    })]),
    visualBounds: Object.freeze({
      width: metadata.visual.pixelSize.width * metadata.visual.scale,
      height: metadata.visual.pixelSize.height * metadata.visual.scale,
    }),
    packageMetadata: metadata,
  });
}

function generatedIslandTarget(
  registry: RuntimeCollisionProfileRegistry,
  tileSize: number,
): CollisionAuthoringTarget {
  const width = 7;
  const height = 7;
  const masks = uniformMasks(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x - 3, y - 3) <= 2.45) masks[y * width + x] = FULL_COLLISION_MASK;
    }
  }
  const entry = registry.get("generated-island");
  return Object.freeze({
    objectKind: "generated-island",
    label: "Generated island policy",
    source: entry.source,
    editing: "read-only",
    editingNote: "Procedural islands have per-instance terrain, so no single finite mask can be authored here.",
    width,
    height,
    tileSize,
    baseMasks: frozenMasks(masks),
    profile: entry.profile,
    anchors: Object.freeze([]),
    visualBounds: Object.freeze({ width: width * tileSize, height: height * tileSize }),
  });
}

const READ_ONLY_DETAILS = Object.freeze({
  wreck: ["Wreck", 64, 64],
  "survey-site": ["Survey site", 32, 32],
  "survey-service": ["Survey service", 19.2, 19.2],
  "island-approach": ["Island approach", 19.2, 19.2],
  "home-dock": ["Home dock", 19.2, 19.2],
} satisfies Record<
  Exclude<RuntimeCollisionObjectKind, "home-island" | "generated-island" | "player-ship" | "fishing-shoal">,
  readonly [string, number, number]
>);

function developerTarget(
  objectKind: keyof typeof READ_ONLY_DETAILS,
  registry: RuntimeCollisionProfileRegistry,
  tileSize: number,
): CollisionAuthoringTarget {
  const entry = registry.get(objectKind);
  const [label, width, height] = READ_ONLY_DETAILS[objectKind];
  const role = objectKind === "wreck" || objectKind === "survey-site" ? "item" : "service";
  return Object.freeze({
    objectKind,
    label,
    source: entry.source,
    editing: "read-only",
    editingNote: `Current ${role} bounds are inspectable; blocking geometry waits for runtime dynamic-collider authority.`,
    width: 1,
    height: 1,
    tileSize,
    baseMasks: frozenMasks(uniformMasks(1, 1)),
    profile: entry.profile,
    anchors: Object.freeze([Object.freeze({
      id: role,
      label: `${role} anchor`,
      x: 0,
      y: 0,
      requiredClearance: role === "service",
    })]),
    visualBounds: Object.freeze({ width, height }),
  });
}

export function createCollisionAuthoringTargets(
  overrides: CollisionAuthoringMetadataOverrides = {},
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
): readonly Readonly<CollisionAuthoringTarget>[] {
  const metadata = { ...PILOT_METADATA, ...overrides };
  const registry = new RuntimeCollisionProfileRegistry(metadata, config);
  const byKind: Record<RuntimeCollisionObjectKind, () => CollisionAuthoringTarget> = {
    "home-island": () => homeTarget(metadata.homeIsland, registry),
    "generated-island": () => generatedIslandTarget(registry, config.navigation.tileSize),
    "player-ship": () => playerTarget(metadata.playerBoat, registry),
    wreck: () => developerTarget("wreck", registry, config.navigation.tileSize),
    "fishing-shoal": () => shoalTarget(metadata.fishingShoal, registry),
    "survey-site": () => developerTarget("survey-site", registry, config.navigation.tileSize),
    "survey-service": () => developerTarget("survey-service", registry, config.navigation.tileSize),
    "island-approach": () => developerTarget("island-approach", registry, config.navigation.tileSize),
    "home-dock": () => developerTarget("home-dock", registry, config.navigation.tileSize),
  };
  return Object.freeze(RUNTIME_COLLISION_OBJECT_KINDS.map((kind) => byKind[kind]()));
}

export function createCollisionAuthoringTarget(
  objectKind: RuntimeCollisionObjectKind,
  overrides: CollisionAuthoringMetadataOverrides = {},
  config: Pick<PrototypeConfig, "navigation" | "movement"> = prototypeConfig,
): Readonly<CollisionAuthoringTarget> {
  const target = createCollisionAuthoringTargets(overrides, config)
    .find((candidate) => candidate.objectKind === objectKind);
  if (!target) throw new RangeError(`No collision authoring target exists for ${objectKind}`);
  return target;
}

export function authoredAssetIdForCollisionObject(
  objectKind: RuntimeCollisionObjectKind,
): (typeof AUTHORED_ASSET_IDS)[keyof typeof AUTHORED_ASSET_IDS] | undefined {
  switch (objectKind) {
    case "home-island": return AUTHORED_ASSET_IDS.homeIsland;
    case "player-ship": return AUTHORED_ASSET_IDS.playerBoat;
    case "fishing-shoal": return AUTHORED_ASSET_IDS.fishingShoal;
    default: return undefined;
  }
}
