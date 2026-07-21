import {
  validateAuthoredIslandCatalog,
  type AuthoredIslandCatalog,
  type AuthoredIslandCatalogEntry,
} from "../../world/AuthoredIslandCatalog";
import type { AuthoredMapDefinitionV1, AuthoredMapDiagnosticV1 } from "./AuthoredMapContracts";

export class AuthoredMapCatalogProjectionError extends Error {
  readonly diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[];

  constructor(diagnostics: readonly Readonly<AuthoredMapDiagnosticV1>[]) {
    super(diagnostics.map(({ message }) => message).join("; "));
    this.name = "AuthoredMapCatalogProjectionError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

/** Resolves every unique referenced collision asset and nothing unrelated. */
export function projectAuthoredMapCollisionCatalogV1(
  definition: Readonly<AuthoredMapDefinitionV1>,
  availableCatalog: Readonly<AuthoredIslandCatalog>,
): Readonly<AuthoredIslandCatalog> {
  const available = validateAuthoredIslandCatalog(availableCatalog);
  const byId = new Map(available.islands.map((entry) => [entry.assetId, entry] as const));
  const expectedRevisions = new Map<string, { revision: string; path: string }>();
  const diagnostics: AuthoredMapDiagnosticV1[] = [];
  for (const [index, island] of definition.world.islands.entries()) {
    const path = `$.world.islands[${index}]`;
    const previous = expectedRevisions.get(island.authoredAssetId);
    if (previous && previous.revision !== island.assetRevision) {
      diagnostics.push({
        stage: "catalog-projection",
        code: "inconsistent-island-asset-revision",
        path: `${path}.assetRevision`,
        message: `island asset ${island.authoredAssetId} is referenced with both ${previous.revision} and ${island.assetRevision}`,
        sourceId: island.sourceId,
        tile: Object.freeze({ ...island.center }),
      });
      continue;
    }
    expectedRevisions.set(island.authoredAssetId, { revision: island.assetRevision, path });
  }

  const islands: Readonly<AuthoredIslandCatalogEntry>[] = [];
  for (const [assetId, expected] of [...expectedRevisions].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const entry = byId.get(assetId);
    if (!entry) {
      diagnostics.push({
        stage: "catalog-projection",
        code: "missing-island-asset",
        path: `${expected.path}.authoredAssetId`,
        message: `available collision catalog has no island ${assetId}`,
      });
      continue;
    }
    if (entry.revision !== expected.revision) {
      diagnostics.push({
        stage: "catalog-projection",
        code: "stale-island-asset",
        path: `${expected.path}.assetRevision`,
        message: `island ${assetId} requires revision ${expected.revision}; current revision is ${entry.revision}`,
      });
      continue;
    }
    islands.push(entry);
  }
  if (diagnostics.length > 0) throw new AuthoredMapCatalogProjectionError(diagnostics);

  return validateAuthoredIslandCatalog({
    revision: projectionRevision(islands),
    islands,
  });
}

function projectionRevision(islands: readonly Readonly<AuthoredIslandCatalogEntry>[]): string {
  const semantic = JSON.stringify(islands.map((entry) => ({
    assetId: entry.assetId,
    revision: entry.revision,
    name: entry.name,
    gridWidth: entry.gridWidth,
    gridHeight: entry.gridHeight,
    solidSubcells: entry.solidSubcells,
  })));
  const bytes = new TextEncoder().encode(semantic);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `map-collision-fnv1a32-${hash.toString(16).padStart(8, "0")}`;
}
