import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AUTHORED_MAP_CATALOG_URL,
  AUTHORED_MAP_SAVE_ROUTE,
  maximumAuthoredMapSaveRequestBytesV1,
  validateAuthoredMapSaveRequestV1,
} from "../src/wayfinders/app/authoredMaps/AuthoredMapRepositoryContracts.ts";
import { isSameCollisionSaveOrigin } from "./collision-save-api.mjs";
import {
  AuthoredMapRepositoryConflictError,
  AuthoredMapRepositoryValidationError,
} from "./authored-map-repository.mjs";

const STATIC_MAP_ROUTE = /^\/maps\/v1\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.map\.json$/u;

class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createAuthoredMapAuthoringMiddleware({
  expectedOrigin,
  saveMap,
  maximumBytes = maximumAuthoredMapSaveRequestBytesV1(),
}) {
  if (typeof saveMap !== "function") throw new TypeError("saveMap must be a function");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer");
  }
  return (request, response, next) => {
    if (request.url !== AUTHORED_MAP_SAVE_ROUTE) {
      next();
      return;
    }
    void (async () => {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new HttpError(405, "Authored map save endpoint only accepts POST", "method-not-allowed");
      }
      if (!isSameCollisionSaveOrigin(headerValue(request.headers.origin), expectedOrigin)) {
        throw new HttpError(
          403,
          "Authored map save rejected: request origin is not this development server",
          "origin-rejected",
        );
      }
      const requestValue = validateAuthoredMapSaveRequestV1(await readJsonBody(request, maximumBytes));
      const saved = await saveMap(requestValue);
      sendJson(response, 200, { ok: true, ...saved });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, failure(error.code, error.message));
      } else if (error instanceof AuthoredMapRepositoryConflictError) {
        sendJson(response, 409, failure(error.code, error.message, error.details));
      } else if (error instanceof AuthoredMapRepositoryValidationError) {
        sendJson(response, 422, failure(error.code, error.message, error.details));
      } else if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) {
        sendJson(response, 400, failure("invalid-request", error.message));
      } else {
        console.error("Authored map save failed", error);
        sendJson(response, 500, failure("repository-failure", "Authored map save failed unexpectedly"));
      }
    });
  };
}

/** Serves freshly-created public map files before Vite's async public-file index catches up. */
export function createAuthoredMapStaticMiddleware({ repositoryRoot }) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  const mapsRoot = path.join(repositoryRoot, "public", "maps");
  return (request, response, next) => {
    const target = staticTarget(request.url, mapsRoot);
    if (!target) {
      next();
      return;
    }
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        throw new HttpError(405, "Authored map files accept GET or HEAD", "method-not-allowed");
      }
      let bytes;
      try {
        bytes = await readFile(target.filename);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          sendJson(response, 404, failure("map-not-found", "Authored map file was not found"), request.method === "HEAD");
          return;
        }
        throw error;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Content-Length", bytes.length);
      response.setHeader("Cache-Control", target.immutable ? "public, max-age=31536000, immutable" : "no-cache");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(request.method === "HEAD" ? undefined : bytes);
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) sendJson(response, error.statusCode, failure(error.code, error.message));
      else {
        console.error("Authored map read failed", error);
        sendJson(response, 500, failure("repository-read-failure", "Authored map file could not be read"));
      }
    });
  };
}

async function readJsonBody(request, maximumBytes) {
  assertJsonContentType(request.headers?.["content-type"]);
  assertContentLength(request.headers?.["content-length"], maximumBytes);
  const chunks = [];
  let byteLength = 0;
  for await (const sourceChunk of request) {
    const chunk = Buffer.isBuffer(sourceChunk) ? sourceChunk : Buffer.from(sourceChunk);
    byteLength += chunk.length;
    if (byteLength > maximumBytes) {
      throw new HttpError(
        413,
        `Authored map save request exceeds the ${maximumBytes}-byte limit`,
        "request-too-large",
      );
    }
    chunks.push(chunk);
  }
  if (byteLength === 0) throw new HttpError(400, "Authored map save request body cannot be empty", "empty-request");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength));
  } catch {
    throw new HttpError(400, "Authored map save request must be valid UTF-8 JSON", "invalid-utf8");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, "Authored map save request body is not valid JSON", "invalid-json");
  }
}

function assertJsonContentType(value) {
  const contentType = headerValue(value);
  if (
    typeof contentType !== "string"
    || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
  ) {
    throw new HttpError(
      415,
      "Authored map saves require Content-Type: application/json",
      "unsupported-content-type",
    );
  }
}

function assertContentLength(value, maximumBytes) {
  const contentLength = headerValue(value);
  if (contentLength === undefined) return;
  if (!/^\d+$/u.test(contentLength)) {
    throw new HttpError(400, "Content-Length must be a non-negative integer", "invalid-content-length");
  }
  if (Number(contentLength) > maximumBytes) {
    throw new HttpError(
      413,
      `Authored map save request exceeds the ${maximumBytes}-byte limit`,
      "request-too-large",
    );
  }
}

function staticTarget(url, mapsRoot) {
  if (url === AUTHORED_MAP_CATALOG_URL) {
    return { filename: path.join(mapsRoot, "catalog.json"), immutable: false };
  }
  if (typeof url !== "string") return undefined;
  const match = STATIC_MAP_ROUTE.exec(url);
  if (!match) return undefined;
  return {
    filename: path.join(mapsRoot, "v1", match[1], `${match[2]}.map.json`),
    immutable: true,
  };
}

function failure(code, message, details) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function sendJson(response, statusCode, body, head = false) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", payload.length);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(head ? undefined : payload);
}

function headerValue(value) {
  return Array.isArray(value) ? undefined : value;
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
