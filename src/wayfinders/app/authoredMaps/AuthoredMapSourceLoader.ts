import type { PrototypeConfig } from "../../config/prototypeConfig";
import {
  projectAuthoredIslandPresentationCatalog,
  type AuthoredIslandPresentationCatalog,
} from "../../assets/AuthoredIslandPresentation";
import type { AuthoredIslandCatalog } from "../../world/AuthoredIslandCatalog";
import {
  authoredMapContentFingerprintV1,
  maximumAuthoredMapCanonicalBytesV1,
  parseAuthoredMapDefinitionV1,
  serializeAuthoredMapDefinitionV1,
} from "./AuthoredMapCodec";
import { compileAuthoredMapV1 } from "./AuthoredMapCompiler";
import type { CompiledAuthoredMapV1 } from "./AuthoredMapContracts";
import type { AuthoredMapLaunchRequestV1 } from "./AuthoredMapLaunchRequest";
import {
  AUTHORED_MAP_CATALOG_URL,
  authoredMapDefinitionUrl,
  parseAuthoredMapCatalogV1,
  serializeAuthoredMapCatalogV1,
  type AuthoredMapCatalogEntryV1,
} from "./AuthoredMapRepositoryContracts";

type SourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAXIMUM_AUTHORED_MAP_CATALOG_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_ERROR_RESPONSE_PREVIEW_BYTES = 4 * 1024;

export interface AuthoredMapSourceLoaderDependenciesV1 {
  readonly availableCollisionCatalog: Readonly<AuthoredIslandCatalog>;
  readonly availablePresentationCatalog: Readonly<AuthoredIslandPresentationCatalog>;
  readonly config?: PrototypeConfig;
  readonly fetchImplementation?: SourceFetch;
}

export interface LoadedAuthoredMapSourceV1 {
  readonly catalogRepositoryRevision: number;
  readonly catalogEntry: Readonly<AuthoredMapCatalogEntryV1>;
  readonly compiled: Readonly<CompiledAuthoredMapV1>;
  readonly presentationCatalog: Readonly<AuthoredIslandPresentationCatalog>;
  /** Recompiles captured immutable bytes against their exact projected inputs. */
  compileFresh(): Readonly<CompiledAuthoredMapV1>;
}

export class AuthoredMapSourceLoadError extends Error {
  constructor(message: string, readonly causeDetail?: unknown) {
    super(message);
    this.name = "AuthoredMapSourceLoadError";
  }
}

/** Loads and completely validates an exact immutable map before scene creation. */
export async function loadAuthoredMapSourceV1(
  request: Extract<AuthoredMapLaunchRequestV1, { readonly kind: "authored-map" }>,
  dependencies: Readonly<AuthoredMapSourceLoaderDependenciesV1>,
): Promise<Readonly<LoadedAuthoredMapSourceV1>> {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  try {
    const catalogBytes = await responseBytes(
      await fetchImplementation(AUTHORED_MAP_CATALOG_URL, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
      "authored map catalog",
      MAXIMUM_AUTHORED_MAP_CATALOG_RESPONSE_BYTES,
    );
    const catalog = parseAuthoredMapCatalogV1(catalogBytes);
    if (!sameBytes(catalogBytes, new TextEncoder().encode(serializeAuthoredMapCatalogV1(catalog)))) {
      throw new AuthoredMapSourceLoadError("Authored map catalog is not in canonical repository form");
    }
    const catalogEntry = catalog.maps.find(({ id }) => id === request.mapId);
    if (!catalogEntry) {
      throw new AuthoredMapSourceLoadError(`Authored map ${request.mapId} is not in the checked-in catalog`);
    }
    if (!catalogEntry.retainedFingerprints.includes(request.contentFingerprint)) {
      throw new AuthoredMapSourceLoadError(
        `Authored map ${request.mapId} does not retain fingerprint ${request.contentFingerprint}`,
      );
    }

    const definitionBytes = await responseBytes(
      await fetchImplementation(
        authoredMapDefinitionUrl(request.mapId, request.contentFingerprint),
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      ),
      `authored map ${request.mapId}@${request.contentFingerprint}`,
      maximumAuthoredMapCanonicalBytesV1(),
    );
    const definition = parseAuthoredMapDefinitionV1(definitionBytes);
    if (!sameBytes(definitionBytes, new TextEncoder().encode(serializeAuthoredMapDefinitionV1(definition)))) {
      throw new AuthoredMapSourceLoadError("Authored map definition is not in canonical repository form");
    }
    if (definition.id !== request.mapId) {
      throw new AuthoredMapSourceLoadError(
        `Authored map file ID ${definition.id} does not match requested ID ${request.mapId}`,
      );
    }
    if (definition.contentFingerprint !== request.contentFingerprint) {
      throw new AuthoredMapSourceLoadError(
        "Authored map file fingerprint does not match the explicit launch fingerprint",
      );
    }
    const computedFingerprint = await authoredMapContentFingerprintV1(definition);
    if (computedFingerprint !== request.contentFingerprint) {
      throw new AuthoredMapSourceLoadError(
        `Authored map ${request.mapId} bytes do not produce fingerprint ${request.contentFingerprint}`,
      );
    }

    const compilation = compileAuthoredMapV1(definition, {
      config: dependencies.config,
      availableAuthoredIslandCatalog: dependencies.availableCollisionCatalog,
    });
    if (!compilation.ok) {
      throw new AuthoredMapSourceLoadError(
        `Authored map ${request.mapId} cannot start: ${formatDiagnostics(compilation.diagnostics)}`,
      );
    }
    const compiled = compilation.value;
    const presentationCatalog = projectAuthoredIslandPresentationCatalog(
      compiled.collisionCatalog,
      dependencies.availablePresentationCatalog,
    );

    return Object.freeze({
      catalogRepositoryRevision: catalog.catalogRevision,
      catalogEntry,
      compiled,
      presentationCatalog,
      compileFresh(): Readonly<CompiledAuthoredMapV1> {
        const next = compileAuthoredMapV1(definition, {
          config: dependencies.config,
          availableAuthoredIslandCatalog: compiled.collisionCatalog,
        });
        if (!next.ok) {
          throw new AuthoredMapSourceLoadError(
            `Authored map ${request.mapId} no longer compiles: ${formatDiagnostics(next.diagnostics)}`,
          );
        }
        return next.value;
      },
    });
  } catch (error) {
    if (error instanceof AuthoredMapSourceLoadError) throw error;
    throw new AuthoredMapSourceLoadError(
      `Could not load authored map ${request.mapId}: ${errorMessage(error)}`,
      error,
    );
  }
}

async function responseBytes(
  response: Response,
  label: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const limit = response.ok ? maximumBytes : MAXIMUM_ERROR_RESPONSE_PREVIEW_BYTES;
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > limit) {
    await response.body?.cancel();
    if (response.ok) {
      throw new AuthoredMapSourceLoadError(`${label} exceeds the ${maximumBytes}-byte response safety bound`);
    }
    throw new AuthoredMapSourceLoadError(`Could not read ${label} (HTTP ${response.status})`);
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > limit) {
          await reader.cancel();
          if (response.ok) {
            throw new AuthoredMapSourceLoadError(`${label} exceeds the ${maximumBytes}-byte response safety bound`);
          }
          throw new AuthoredMapSourceLoadError(`Could not read ${label} (HTTP ${response.status})`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!response.ok) {
    const preview = decodeUtf8Preview(bytes).trim().slice(0, 160);
    throw new AuthoredMapSourceLoadError(
      `Could not read ${label} (HTTP ${response.status}${preview ? `: ${preview}` : ""})`,
    );
  }
  return bytes;
}

function decodeUtf8Preview(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function formatDiagnostics(
  diagnostics: readonly Readonly<{ readonly path: string; readonly message: string }>[],
): string {
  return diagnostics.slice(0, 4).map(({ path, message }) => `${path}: ${message}`).join("; ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
