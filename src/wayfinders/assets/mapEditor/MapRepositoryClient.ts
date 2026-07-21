import {
  AUTHORED_MAP_CATALOG_URL,
  AUTHORED_MAP_SAVE_ROUTE,
  authoredMapDefinitionUrl,
  validateAuthoredMapCatalogV1,
  validateAuthoredMapSaveRequestV1,
  type AuthoredMapCatalogV1,
  type AuthoredMapSaveRequestV1,
  type AuthoredMapSaveResponseV1,
} from "../../app/authoredMaps/AuthoredMapRepositoryContracts";

export interface MapRepositoryCodec<Definition> {
  parseDefinition(source: string): Readonly<Definition>;
  verifyLoadedDefinition(
    definition: Readonly<Definition>,
    expected: Readonly<{ readonly mapId: string; readonly contentFingerprint: string }>,
  ): Promise<Readonly<Definition>>;
  validateSaveResponse(value: unknown): Readonly<AuthoredMapSaveResponseV1> & {
    readonly definition: Readonly<Definition>;
  };
}

export interface MapRepositoryClient<Definition> {
  loadCatalog(signal?: AbortSignal): Promise<Readonly<AuthoredMapCatalogV1>>;
  loadDefinition(
    mapId: string,
    contentFingerprint: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Definition>>;
  save(
    request: Readonly<AuthoredMapSaveRequestV1>,
    signal?: AbortSignal,
  ): Promise<Readonly<AuthoredMapSaveResponseV1> & { readonly definition: Readonly<Definition> }>;
}

export class MapRepositoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MapRepositoryRequestError";
  }

  get stale(): boolean { return this.status === 409; }
  get invalid(): boolean { return this.status === 400 || this.status === 413 || this.status === 422; }
}

type RepositoryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Browser-only transport for checked-in map catalog reads and guarded saves. */
export function createMapRepositoryClient<Definition>(
  codec: Readonly<MapRepositoryCodec<Definition>>,
  fetchImplementation: RepositoryFetch = fetch,
): Readonly<MapRepositoryClient<Definition>> {
  return Object.freeze({
    async loadCatalog(signal?: AbortSignal) {
      const response = await fetchImplementation(AUTHORED_MAP_CATALOG_URL, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const value = await responseJson(response, "Map catalog");
      return validateAuthoredMapCatalogV1(value);
    },
    async loadDefinition(mapId: string, contentFingerprint: string, signal?: AbortSignal) {
      const response = await fetchImplementation(authoredMapDefinitionUrl(mapId, contentFingerprint), {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const source = await responseText(response, "Map definition");
      return codec.verifyLoadedDefinition(codec.parseDefinition(source), { mapId, contentFingerprint });
    },
    async save(request: Readonly<AuthoredMapSaveRequestV1>, signal?: AbortSignal) {
      const normalized = validateAuthoredMapSaveRequestV1(request);
      const response = await fetchImplementation(AUTHORED_MAP_SAVE_ROUTE, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalized),
        signal,
      });
      const value = await responseJson(response, "Map save");
      return codec.validateSaveResponse(unwrapSaveSuccess(value));
    },
  });
}

async function responseText(response: Response, operation: string): Promise<string> {
  const source = await response.text();
  if (response.ok) return source;
  throw requestError(response.status, source, operation);
}

async function responseJson(response: Response, operation: string): Promise<unknown> {
  const source = await responseText(response, operation);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new MapRepositoryRequestError(`${operation} returned invalid JSON`, 502);
  }
}

function requestError(status: number, source: string, operation: string): MapRepositoryRequestError {
  let message = `${operation} failed with HTTP ${status}`;
  try {
    const value = JSON.parse(source) as unknown;
    if (typeof value === "object" && value !== null && "error" in value) {
      const error = (value as { readonly error?: unknown }).error;
      if (typeof error === "string" && error.trim()) message = error;
      else if (typeof error === "object" && error !== null && "message" in error) {
        const nestedMessage = (error as { readonly message?: unknown }).message;
        if (typeof nestedMessage === "string" && nestedMessage.trim()) message = nestedMessage;
      }
    }
  } catch {
    // The status remains actionable even if an intermediary replaced the body.
  }
  return new MapRepositoryRequestError(message, status);
}

function unwrapSaveSuccess(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MapRepositoryRequestError("Map save returned an invalid success envelope", 502);
  }
  const { ok, ...response } = value as Record<string, unknown>;
  if (ok !== true) {
    throw new MapRepositoryRequestError("Map save returned an invalid success envelope", 502);
  }
  return response;
}
