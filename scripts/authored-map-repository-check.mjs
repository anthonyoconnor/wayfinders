import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  authoredMapContentFingerprintV1,
  parseAuthoredMapDefinitionV1,
  serializeAuthoredMapDefinitionV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapCodec.ts";
import { compileAuthoredMapV1 } from "../src/wayfinders/app/authoredMaps/AuthoredMapCompiler.ts";
import {
  AUTHORED_MAP_CONTENT_FINGERPRINT_PATTERN,
  AUTHORED_MAP_STABLE_ID_PATTERN,
  encodeAuthoredMapCatalogV1,
  parseAuthoredMapCatalogV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapRepositoryContracts.ts";
import { prototypeConfig } from "../src/wayfinders/config/prototypeConfig.ts";
import { readFreshAvailableAuthoredIslandCatalog } from "./authored-map-island-catalog.mjs";

const MAP_FILE_PATTERN = /^([a-f0-9]{64})\.map\.json$/u;

export async function checkAuthoredMapRepository(repositoryRoot, {
  readIslandCatalog = readFreshAvailableAuthoredIslandCatalog,
  parseDefinition = parseAuthoredMapDefinitionV1,
  serializeDefinition = serializeAuthoredMapDefinitionV1,
  fingerprintDefinition = authoredMapContentFingerprintV1,
  compileDefinition = compileAuthoredMapV1,
  config = prototypeConfig,
} = {}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  const mapsRoot = path.join(repositoryRoot, "public", "maps");
  const catalogPath = path.join(mapsRoot, "catalog.json");
  await requirePlainFile(catalogPath, "Authored map catalog");
  const catalogBytes = await readFile(catalogPath);
  const catalog = parseAuthoredMapCatalogV1(catalogBytes);
  requireEqualBytes(
    catalogBytes,
    Buffer.from(encodeAuthoredMapCatalogV1(catalog)),
    "Authored map catalog is not canonical",
  );

  const expectedFiles = new Map();
  for (const entry of catalog.maps) {
    for (const fingerprint of entry.retainedFingerprints) {
      expectedFiles.set(`${entry.id}/${fingerprint}.map.json`, { entry, fingerprint });
    }
  }
  const { files: actualFiles, mapIds: actualMapIds } = await enumerateRepositoryFiles(mapsRoot);
  const catalogMapIds = new Set(catalog.maps.map(({ id }) => id));
  for (const mapId of actualMapIds) {
    if (!catalogMapIds.has(mapId)) {
      throw new Error(`Authored map repository contains unlisted map directory v1/${mapId}`);
    }
  }
  const actualDefinitionFiles = actualFiles.filter((relative) => relative.startsWith("v1/"));
  const allowedRootFiles = new Set(["catalog.json", ...expectedFiles.keys()].map((relative) => (
    relative === "catalog.json" ? relative : `v1/${relative}`
  )));
  for (const relative of actualFiles) {
    if (!allowedRootFiles.has(relative)) {
      throw new Error(`Authored map repository contains unlisted or unexpected file ${relative}`);
    }
  }
  for (const relative of expectedFiles.keys()) {
    const repositoryRelative = `v1/${relative}`;
    if (!actualDefinitionFiles.includes(repositoryRelative)) {
      throw new Error(`Authored map repository is missing referenced file ${repositoryRelative}`);
    }
  }

  const normalizedByPath = new Map();
  for (const [relative, expected] of expectedFiles) {
    const repositoryRelative = `v1/${relative}`;
    const filename = safeDefinitionPath(mapsRoot, expected.entry.id, expected.fingerprint);
    await requirePlainFile(filename, `Authored map definition ${repositoryRelative}`);
    const bytes = await readFile(filename);
    const definition = await parseDefinition(bytes);
    if (definition.id !== expected.entry.id) {
      throw new Error(
        `Authored map definition ${repositoryRelative} contains map ID ${String(definition.id)}`,
      );
    }
    if (definition.contentFingerprint !== expected.fingerprint) {
      throw new Error(
        `Authored map definition ${repositoryRelative} contains fingerprint ${String(definition.contentFingerprint)}`,
      );
    }
    if (
      expected.fingerprint === expected.entry.currentFingerprint
      && definition.displayName !== expected.entry.displayName
    ) {
      throw new Error(
        `Authored map catalog display name for ${expected.entry.id} does not match its current definition`,
      );
    }
    const computed = await fingerprintDefinition(definition);
    if (computed !== expected.fingerprint) {
      throw new Error(
        `Authored map definition ${repositoryRelative} hashes to ${computed}, not ${expected.fingerprint}`,
      );
    }
    requireEqualBytes(
      bytes,
      Buffer.from(serializeDefinition(definition), "utf8"),
      `Authored map definition ${repositoryRelative} is not canonical`,
    );
    normalizedByPath.set(relative, definition);
  }

  const islandCatalog = catalog.maps.length === 0
    ? undefined
    : await readIslandCatalog(repositoryRoot);
  for (const entry of catalog.maps) {
    const relative = `${entry.id}/${entry.currentFingerprint}.map.json`;
    const result = await compileDefinition(normalizedByPath.get(relative), {
      config,
      availableAuthoredIslandCatalog: islandCatalog,
    });
    if (!result?.ok) {
      throw new Error(
        `Current authored map ${entry.id}@${entry.currentFingerprint} does not compile: `
        + diagnosticSummary(result?.diagnostics),
      );
    }
  }

  return Object.freeze({
    catalogRevision: catalog.catalogRevision,
    mapCount: catalog.maps.length,
    definitionCount: expectedFiles.size,
    currentHeadCount: catalog.maps.length,
  });
}

async function enumerateRepositoryFiles(mapsRoot) {
  const entries = await readdir(mapsRoot, { withFileTypes: true });
  const files = [];
  const mapIds = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Authored map repository rejects symlink ${entry.name}`);
    if (entry.name === "catalog.json" && entry.isFile()) {
      files.push(entry.name);
      continue;
    }
    if (entry.name !== "v1" || !entry.isDirectory()) {
      throw new Error(`Authored map repository contains unexpected entry ${entry.name}`);
    }
    const mapDirectories = await readdir(path.join(mapsRoot, "v1"), { withFileTypes: true });
    for (const mapDirectory of mapDirectories) {
      const mapLabel = `v1/${mapDirectory.name}`;
      if (mapDirectory.isSymbolicLink()) throw new Error(`Authored map repository rejects symlink ${mapLabel}`);
      if (!mapDirectory.isDirectory() || !AUTHORED_MAP_STABLE_ID_PATTERN.test(mapDirectory.name)) {
        throw new Error(`Authored map repository contains unsafe map directory ${mapLabel}`);
      }
      mapIds.push(mapDirectory.name);
      const definitions = await readdir(path.join(mapsRoot, "v1", mapDirectory.name), {
        withFileTypes: true,
      });
      for (const definition of definitions) {
        const relative = `${mapLabel}/${definition.name}`;
        if (definition.isSymbolicLink()) throw new Error(`Authored map repository rejects symlink ${relative}`);
        const match = definition.isFile() ? MAP_FILE_PATTERN.exec(definition.name) : undefined;
        if (!match || !AUTHORED_MAP_CONTENT_FINGERPRINT_PATTERN.test(match[1])) {
          throw new Error(`Authored map repository contains unsafe definition path ${relative}`);
        }
        files.push(relative);
      }
    }
  }
  if (!files.includes("catalog.json")) throw new Error("Authored map repository is missing catalog.json");
  return { files: files.sort(), mapIds: mapIds.sort() };
}

function safeDefinitionPath(mapsRoot, mapId, fingerprint) {
  if (!AUTHORED_MAP_STABLE_ID_PATTERN.test(mapId)) throw new Error(`Unsafe authored map ID ${mapId}`);
  if (!AUTHORED_MAP_CONTENT_FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error(`Unsafe authored map fingerprint ${fingerprint}`);
  }
  const filename = path.join(mapsRoot, "v1", mapId, `${fingerprint}.map.json`);
  const relative = path.relative(mapsRoot, filename);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Authored map path escapes repository root: ${relative}`);
  }
  return filename;
}

async function requirePlainFile(filename, label) {
  let stats;
  try {
    stats = await lstat(filename);
  } catch (error) {
    throw new Error(`${label} could not be inspected: ${errorMessage(error)}`, { cause: error });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} must be a plain file`);
}

function requireEqualBytes(actual, expected, message) {
  if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error(message);
}

function diagnosticSummary(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return "unknown diagnostic";
  return diagnostics
    .slice(0, 5)
    .map((diagnostic) => `${String(diagnostic?.path ?? "$")}: ${String(diagnostic?.message ?? diagnostic?.code)}`)
    .join("; ");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await checkAuthoredMapRepository(repositoryRoot);
  console.log(
    `Authored maps valid: ${result.mapCount} maps, ${result.definitionCount} immutable definitions, `
    + `catalog revision ${result.catalogRevision}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
