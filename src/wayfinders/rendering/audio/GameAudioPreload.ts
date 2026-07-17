import type Phaser from "phaser";
import {
  AUDIO_CATALOG_URL,
  resolveAudioAssetUrl,
  type AudioCatalog,
} from "../../audio";

const AUDIO_CACHE_KEY_PREFIX = "wayfinders.audio.";

export interface GameAudioLoader {
  audio(key: string, urls: string | string[]): unknown;
}

export function phaserAudioCacheKey(assetId: string): string {
  return `${AUDIO_CACHE_KEY_PREFIX}${assetId}`;
}

/** Queues every catalog record; missing/undecodable files remain a runtime no-audio failure. */
export function queueGameAudioCatalog(
  loader: GameAudioLoader,
  catalog: Readonly<AudioCatalog>,
  catalogUrl = AUDIO_CATALOG_URL,
): void {
  for (const asset of catalog.assets) {
    loader.audio(
      phaserAudioCacheKey(asset.id),
      resolveAudioAssetUrl(asset, catalogUrl),
    );
  }
}

export function preloadGameAudioCatalog(
  scene: Phaser.Scene,
  catalog: Readonly<AudioCatalog>,
  catalogUrl = AUDIO_CATALOG_URL,
): void {
  queueGameAudioCatalog(scene.load, catalog, catalogUrl);
}
