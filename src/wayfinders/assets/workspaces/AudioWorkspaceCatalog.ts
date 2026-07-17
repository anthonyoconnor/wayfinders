import {
  AUDIO_CATEGORIES,
  resolveAudioAssetUrl,
  type AudioCatalogLoadResult,
} from "../../audio";
import type { AudioPreviewAsset } from "../audioPreview/AudioPreviewPlayer";

export interface AudioWorkspaceCategory {
  readonly id: string;
  readonly displayName: string;
}

export interface AudioWorkspaceCatalog {
  readonly libraryId: string;
  readonly categories: readonly Readonly<AudioWorkspaceCategory>[];
  readonly assets: readonly Readonly<AudioPreviewAsset>[];
}

/** A non-throwing composition result. An error source renders in-place. */
export interface AudioWorkspaceCatalogSource {
  readonly catalog?: Readonly<AudioWorkspaceCatalog>;
  readonly error?: string;
}

/** Adapts the validated shared runtime catalog into the preview-only view. */
export function audioWorkspaceCatalogSource(
  result: AudioCatalogLoadResult | undefined,
): Readonly<AudioWorkspaceCatalogSource> {
  if (!result) return Object.freeze({ error: "The audio catalog has not been loaded." });
  if (!result.ok) return Object.freeze({ error: result.error.message });
  const catalog = result.catalog;
  return Object.freeze({
    catalog: Object.freeze({
      libraryId: catalog.libraryId,
      categories: Object.freeze(AUDIO_CATEGORIES.map((id) => Object.freeze({
        id,
        displayName: catalog.categories[id].displayName,
      }))),
      assets: Object.freeze(catalog.assets.map((asset) => Object.freeze({
        id: asset.id,
        displayName: asset.displayName,
        description: asset.description,
        category: asset.category,
        sourceUrl: resolveAudioAssetUrl(asset),
        loop: asset.loop,
      }))),
    }),
  });
}

export interface AudioWorkspaceGroup {
  readonly category: Readonly<AudioWorkspaceCategory>;
  readonly assets: readonly Readonly<AudioPreviewAsset>[];
}

export function groupAudioWorkspaceAssets(
  catalog: Readonly<AudioWorkspaceCatalog>,
): readonly Readonly<AudioWorkspaceGroup>[] {
  const categoryIds = new Set(catalog.categories.map((category) => category.id));
  for (const asset of catalog.assets) {
    if (!categoryIds.has(asset.category)) {
      throw new RangeError(`Audio workspace asset ${asset.id} has unknown category ${asset.category}`);
    }
  }
  return Object.freeze(catalog.categories.map((category) => Object.freeze({
    category,
    assets: Object.freeze(catalog.assets.filter((asset) => asset.category === category.id)),
  })));
}
