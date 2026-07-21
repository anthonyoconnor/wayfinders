import type Phaser from "phaser";
import {
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalog,
} from "../world/AuthoredIslandCatalog";

export type AuthoredIslandPresentationPlane =
  | "water-apron"
  | "land"
  | "island-composite"
  | "shore-effect";

export interface AuthoredIslandPresentationLayer {
  readonly id: string;
  readonly plane: AuthoredIslandPresentationPlane;
  readonly url: string;
  readonly textureKey: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly opacity: number;
  readonly blendMode: "normal" | "multiply" | "screen" | "add";
}

export interface AuthoredIslandPresentationEntry {
  readonly assetId: string;
  readonly name: string;
  readonly revision: string;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly layers: readonly Readonly<AuthoredIslandPresentationLayer>[];
}

export interface AuthoredIslandPresentationCatalog {
  readonly revision: string;
  readonly islands: readonly Readonly<AuthoredIslandPresentationEntry>[];
}

export const EMPTY_AUTHORED_ISLAND_PRESENTATION_CATALOG: Readonly<AuthoredIslandPresentationCatalog> =
  Object.freeze({ revision: "none", islands: Object.freeze([]) });

/**
 * Presentation sibling for a map-scoped collision projection. The collision
 * projection owns the revision so the generated manifest and renderer receive
 * one exact catalog identity.
 */
export function projectAuthoredIslandPresentationCatalog(
  collisionCatalog: Readonly<AuthoredIslandCatalog>,
  availableCatalog: Readonly<AuthoredIslandPresentationCatalog>,
): Readonly<AuthoredIslandPresentationCatalog> {
  const collision = validateAuthoredIslandCatalog(collisionCatalog);
  const availableById = new Map<string, Readonly<AuthoredIslandPresentationEntry>>();
  for (const entry of availableCatalog.islands) {
    if (availableById.has(entry.assetId)) {
      throw new RangeError(`Available presentation catalog repeats island ${entry.assetId}`);
    }
    availableById.set(entry.assetId, entry);
  }
  const islands = collision.islands.map((entry) => {
    const presentation = availableById.get(entry.assetId);
    if (!presentation) {
      throw new RangeError(`Available presentation catalog has no island ${entry.assetId}`);
    }
    if (presentation.revision !== entry.revision) {
      throw new RangeError(
        `Island ${entry.assetId} presentation revision ${presentation.revision} does not match collision revision ${entry.revision}`,
      );
    }
    if (
      presentation.gridWidth !== entry.gridWidth
      || presentation.gridHeight !== entry.gridHeight
    ) {
      throw new RangeError(
        `Island ${entry.assetId} presentation dimensions do not match collision dimensions`,
      );
    }
    return Object.freeze({
      ...presentation,
      layers: Object.freeze(presentation.layers.map((layer) => Object.freeze({ ...layer }))),
    });
  });
  return Object.freeze({
    revision: collision.revision,
    islands: Object.freeze(islands),
  });
}

export interface AuthoredIslandPresentationDiagnostic {
  readonly assetId: string;
  readonly message: string;
}

export interface AuthoredIslandPresentationRuntime {
  readonly revision: string;
  readonly diagnostics: readonly Readonly<AuthoredIslandPresentationDiagnostic>[];
  entry(assetId: string): Readonly<AuthoredIslandPresentationEntry> | undefined;
}

/** A presentation may replace fallback terrain only when it includes authored land. */
export function hasAuthoredIslandLandPlane(
  presentation: Pick<AuthoredIslandPresentationEntry, "layers">,
): boolean {
  return presentation.layers.some(({ plane }) => plane === "land" || plane === "island-composite");
}

/** Water ownership additionally requires a composite or dedicated apron plane. */
export function hasAuthoredIslandWaterPlane(
  presentation: Pick<AuthoredIslandPresentationEntry, "layers">,
): boolean {
  return presentation.layers.some(({ plane }) => plane === "island-composite" || plane === "water-apron");
}

/** Loads the immutable available-island snapshot before scene creation. */
export function preloadAuthoredIslandPresentations(
  scene: Phaser.Scene,
  catalog: Readonly<AuthoredIslandPresentationCatalog>,
): void {
  for (const island of catalog.islands) {
    for (const layer of island.layers) {
      if (!scene.textures.exists(layer.textureKey)) scene.load.image(layer.textureKey, layer.url);
    }
  }
}

/** Keeps only complete entries so a partial load falls back as one coherent island. */
export function createAuthoredIslandPresentationRuntime(
  scene: Phaser.Scene,
  catalog: Readonly<AuthoredIslandPresentationCatalog>,
): Readonly<AuthoredIslandPresentationRuntime> {
  const entries = new Map<string, Readonly<AuthoredIslandPresentationEntry>>();
  const diagnostics: AuthoredIslandPresentationDiagnostic[] = [];
  for (const island of catalog.islands) {
    const missing = island.layers.find((layer) => !scene.textures.exists(layer.textureKey));
    if (missing) {
      diagnostics.push({
        assetId: island.assetId,
        message: `texture ${missing.textureKey} did not load`,
      });
      continue;
    }
    if (!hasAuthoredIslandLandPlane(island)) {
      diagnostics.push({
        assetId: island.assetId,
        message: "presentation has no land or island-composite plane",
      });
      continue;
    }
    entries.set(island.assetId, island);
  }
  return Object.freeze({
    revision: catalog.revision,
    diagnostics: Object.freeze(diagnostics),
    entry: (assetId: string) => entries.get(assetId),
  });
}
