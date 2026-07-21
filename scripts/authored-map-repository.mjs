import { readFile, rmdir } from "node:fs/promises";
import path from "node:path";

import {
  authoredMapContentFingerprintV1,
  parseAuthoredMapDefinitionV1,
  serializeAuthoredMapDefinitionV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapCodec.ts";
import { compileAuthoredMapV1 } from "../src/wayfinders/app/authoredMaps/AuthoredMapCompiler.ts";
import {
  authoredMapDefinitionUrl,
  encodeAuthoredMapCatalogV1,
  parseAuthoredMapCatalogV1,
  validateAuthoredMapSaveRequestV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapRepositoryContracts.ts";
import { prototypeConfig } from "../src/wayfinders/config/prototypeConfig.ts";
import { readFreshAvailableAuthoredIslandCatalog } from "./authored-map-island-catalog.mjs";
import {
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "./repository-collision-transaction.mjs";

export class AuthoredMapRepositoryConflictError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "AuthoredMapRepositoryConflictError";
    this.code = code;
    this.details = details;
  }
}

export class AuthoredMapRepositoryValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "AuthoredMapRepositoryValidationError";
    this.code = code;
    this.details = details;
  }
}

export function createAuthoredMapRepositoryService({
  repositoryRoot,
  lock = withCollisionIntakeLock,
  commitTransaction = commitAtomicFileTransaction,
  readIslandCatalog = readFreshAvailableAuthoredIslandCatalog,
  parseDefinition = parseAuthoredMapDefinitionV1,
  serializeDefinition = serializeAuthoredMapDefinitionV1,
  fingerprintDefinition = authoredMapContentFingerprintV1,
  compileDefinition = compileAuthoredMapV1,
  config = prototypeConfig,
} = {}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  for (const [label, operation] of Object.entries({
    lock,
    commitTransaction,
    readIslandCatalog,
    parseDefinition,
    serializeDefinition,
    fingerprintDefinition,
    compileDefinition,
  })) {
    if (typeof operation !== "function") throw new TypeError(`${label} must be a function`);
  }

  const catalogPath = path.join(repositoryRoot, "public", "maps", "catalog.json");

  const save = async (requestInput) => lock(repositoryRoot, async () => {
    const request = validateAuthoredMapSaveRequestV1(requestInput);
    const { catalog } = await readCanonicalCatalog(catalogPath);
    requireRevision(
      request.expectedCatalogRevision,
      catalog.catalogRevision,
      "catalog-revision-conflict",
      "The authored map catalog changed before this save",
      { currentCatalogRevision: catalog.catalogRevision },
    );

    const currentEntry = catalog.maps.find(({ id }) => id === request.mapId);
    if (currentEntry) {
      if (request.expectedMapRepositoryRevision === undefined) {
        throw conflict(
          "map-already-exists",
          `Authored map ${request.mapId} already exists`,
          repositoryDetails(catalog, currentEntry),
        );
      }
      requireRevision(
        request.expectedMapRepositoryRevision,
        currentEntry.mapRepositoryRevision,
        "map-revision-conflict",
        `Authored map ${request.mapId} changed before this save`,
        repositoryDetails(catalog, currentEntry),
      );
    } else if (request.expectedMapRepositoryRevision !== undefined) {
      throw conflict(
        "map-no-longer-exists",
        `Authored map ${request.mapId} no longer exists`,
        { currentCatalogRevision: catalog.catalogRevision },
      );
    }

    const definition = await asRepositoryValidation(
      "invalid-map-definition",
      "Authored map definition is invalid",
      () => parseDefinition(JSON.stringify(request.definition)),
    );
    if (definition.id !== request.mapId) {
      throw validation(
        "map-id-mismatch",
        `Definition ID ${String(definition.id)} does not match requested map ID ${request.mapId}`,
      );
    }
    const computedFingerprint = await asRepositoryValidation(
      "invalid-map-fingerprint",
      "Authored map content fingerprint could not be computed",
      () => fingerprintDefinition(definition),
    );
    if (computedFingerprint !== definition.contentFingerprint) {
      throw validation(
        "map-fingerprint-mismatch",
        "Authored map content fingerprint does not match its normalized semantic payload",
        { expectedFingerprint: computedFingerprint, submittedFingerprint: definition.contentFingerprint },
      );
    }

    const islandCatalog = await asRepositoryValidation(
      "island-catalog-invalid",
      "The current authored-island catalog is unavailable or invalid",
      () => readIslandCatalog(repositoryRoot),
    );
    const compilation = await asRepositoryValidation(
      "map-compilation-failed",
      "Authored map compilation failed unexpectedly",
      () => compileDefinition(definition, {
        config,
        availableAuthoredIslandCatalog: islandCatalog,
      }),
    );
    if (!compilation?.ok) {
      throw validation(
        "map-validation-failed",
        "Authored map cannot be saved until its blocking diagnostics are resolved",
        { diagnostics: compilation?.diagnostics ?? [] },
      );
    }

    const definitionBytes = Buffer.from(serializeDefinition(definition), "utf8");
    const definitionPath = definitionFilePath(repositoryRoot, request.mapId, computedFingerprint);
    const existingDefinitionBytes = await readOptional(definitionPath);
    if (existingDefinitionBytes && !existingDefinitionBytes.equals(definitionBytes)) {
      throw validation(
        "immutable-map-mismatch",
        `Immutable authored map revision ${computedFingerprint} already exists with different bytes`,
      );
    }

    if (currentEntry?.currentFingerprint === computedFingerprint) {
      if (!existingDefinitionBytes) {
        throw validation(
          "missing-current-map-revision",
          `Catalog current revision ${computedFingerprint} is missing from disk`,
        );
      }
      if (currentEntry.displayName !== definition.displayName) {
        throw validation(
          "catalog-definition-mismatch",
          `Catalog display name for ${request.mapId} does not match its current immutable definition`,
        );
      }
      return saveResponse({
        changed: false,
        created: false,
        catalog,
        entry: currentEntry,
        definition,
      });
    }

    const nextEntry = Object.freeze({
      id: request.mapId,
      displayName: definition.displayName,
      mapRepositoryRevision: currentEntry ? currentEntry.mapRepositoryRevision + 1 : 1,
      currentFingerprint: computedFingerprint,
      retainedFingerprints: Object.freeze([
        ...(currentEntry?.retainedFingerprints ?? []),
        computedFingerprint,
      ].filter((value, index, all) => all.indexOf(value) === index).sort()),
    });
    const nextCatalog = Object.freeze({
      formatVersion: 1,
      catalogRevision: catalog.catalogRevision + 1,
      maps: Object.freeze([
        ...catalog.maps.filter(({ id }) => id !== request.mapId),
        nextEntry,
      ].sort((left, right) => left.id.localeCompare(right.id, "en"))),
    });
    const nextCatalogBytes = Buffer.from(encodeAuthoredMapCatalogV1(nextCatalog));
    const changes = [
      ...(existingDefinitionBytes ? [] : [{ targetPath: definitionPath, bytes: definitionBytes }]),
      { targetPath: catalogPath, bytes: nextCatalogBytes },
    ];

    try {
      await commitTransaction(changes, async () => {
        const [writtenDefinition, writtenCatalog] = await Promise.all([
          readFile(definitionPath),
          readFile(catalogPath),
        ]);
        if (!writtenDefinition.equals(definitionBytes)) {
          throw new Error("Authored map transaction verification found different immutable definition bytes");
        }
        if (!writtenCatalog.equals(nextCatalogBytes)) {
          throw new Error("Authored map transaction verification found different catalog bytes");
        }
      });
    } catch (cause) {
      if (!currentEntry && !existingDefinitionBytes) {
        await removeRolledBackCreateDirectory(path.dirname(definitionPath), cause);
      }
      throw cause;
    }

    return saveResponse({
      changed: true,
      created: currentEntry === undefined,
      catalog: nextCatalog,
      entry: nextEntry,
      definition,
    });
  });

  return Object.freeze({ save, catalogPath });
}

export function definitionFilePath(repositoryRoot, mapId, contentFingerprint) {
  return path.join(
    repositoryRoot,
    "public",
    "maps",
    "v1",
    mapId,
    `${contentFingerprint}.map.json`,
  );
}

async function readCanonicalCatalog(catalogPath) {
  let bytes;
  try {
    bytes = await readFile(catalogPath);
  } catch (error) {
    throw validation("catalog-unavailable", "Authored map catalog could not be read", errorDetails(error));
  }
  const catalog = await asRepositoryValidation(
    "catalog-invalid",
    "Authored map catalog is invalid",
    () => parseAuthoredMapCatalogV1(bytes),
  );
  const canonical = Buffer.from(encodeAuthoredMapCatalogV1(catalog));
  if (!bytes.equals(canonical)) {
    throw validation("catalog-noncanonical", "Authored map catalog bytes are not canonical");
  }
  return { catalog, bytes };
}

async function readOptional(filename) {
  try {
    return await readFile(filename);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function removeRolledBackCreateDirectory(directory, cause) {
  try {
    // Non-recursive removal succeeds only after the file transaction restored
    // an empty create directory. Never delete preserved rollback evidence or an
    // unrelated file that appeared in the directory.
    await rmdir(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTEMPTY") return;
    throw new AggregateError(
      [cause, error],
      `Authored map create rolled back but its empty directory could not be removed: ${directory}`,
    );
  }
}

function requireRevision(expected, actual, code, message, details) {
  if (expected !== actual) throw conflict(code, message, details);
}

function conflict(code, message, details) {
  return new AuthoredMapRepositoryConflictError(code, message, details);
}

function validation(code, message, details) {
  return new AuthoredMapRepositoryValidationError(code, message, details);
}

async function asRepositoryValidation(code, message, operation) {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof AuthoredMapRepositoryConflictError
      || error instanceof AuthoredMapRepositoryValidationError
    ) {
      throw error;
    }
    throw validation(code, `${message}: ${errorMessage(error)}`, errorDetails(error));
  }
}

function repositoryDetails(catalog, entry) {
  return {
    currentCatalogRevision: catalog.catalogRevision,
    currentMapRepositoryRevision: entry.mapRepositoryRevision,
    currentFingerprint: entry.currentFingerprint,
  };
}

function saveResponse({ changed, created, catalog, entry, definition }) {
  return Object.freeze({
    changed,
    created,
    catalogRevision: catalog.catalogRevision,
    mapRepositoryRevision: entry.mapRepositoryRevision,
    currentFingerprint: entry.currentFingerprint,
    retainedFingerprints: entry.retainedFingerprints,
    definition,
    definitionUrl: authoredMapDefinitionUrl(entry.id, entry.currentFingerprint),
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorDetails(error) {
  return error instanceof Error ? { message: error.message } : undefined;
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
