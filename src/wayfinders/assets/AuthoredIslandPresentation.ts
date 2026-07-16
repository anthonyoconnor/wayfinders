import type Phaser from "phaser";

export interface AuthoredIslandPresentationLayer {
  readonly id: string;
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

export interface AuthoredIslandPresentationDiagnostic {
  readonly assetId: string;
  readonly message: string;
}

export interface AuthoredIslandPresentationRuntime {
  readonly revision: string;
  readonly diagnostics: readonly Readonly<AuthoredIslandPresentationDiagnostic>[];
  entry(assetId: string): Readonly<AuthoredIslandPresentationEntry> | undefined;
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
    entries.set(island.assetId, island);
  }
  return Object.freeze({
    revision: catalog.revision,
    diagnostics: Object.freeze(diagnostics),
    entry: (assetId: string) => entries.get(assetId),
  });
}
