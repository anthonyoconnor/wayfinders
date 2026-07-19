import {
  validateCloudAssetIdentityRequest,
  validateCloudAssetSaveRequest,
} from "../src/wayfinders/assets/CloudAssetAuthoring.ts";
import { isSameCollisionSaveOrigin } from "./collision-save-api.mjs";
import { CloudAssetAuthoringError } from "./cloud-asset-authoring.mjs";

export const CLOUD_ASSET_SAVE_ROUTE = "/__wayfinders/assets/clouds/save";
export const CLOUD_ASSET_DELETE_ROUTE = "/__wayfinders/assets/clouds/delete";
export const MAX_CLOUD_ASSET_AUTHORING_BYTES = 16 * 1_024;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function headerValue(value) {
  return Array.isArray(value) ? undefined : value;
}

function assertJsonContentType(value) {
  const contentType = headerValue(value);
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Cloud asset authoring requires Content-Type: application/json");
  }
}

function assertContentLength(value, maximumBytes) {
  const contentLength = headerValue(value);
  if (contentLength === undefined) return;
  if (!/^\d+$/u.test(contentLength)) throw new HttpError(400, "Content-Length must be a non-negative integer");
  if (Number(contentLength) > maximumBytes) {
    throw new HttpError(413, `Cloud asset authoring request exceeds the ${maximumBytes}-byte limit`);
  }
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
      throw new HttpError(413, `Cloud asset authoring request exceeds the ${maximumBytes}-byte limit`);
    }
    chunks.push(chunk);
  }
  if (byteLength === 0) throw new HttpError(400, "Cloud asset authoring request body cannot be empty");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength));
  } catch {
    throw new HttpError(400, "Cloud asset authoring request must be valid UTF-8 JSON");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, "Cloud asset authoring request body is not valid JSON");
  }
}

function trustedEnvelope(value, route) {
  try {
    return route === CLOUD_ASSET_SAVE_ROUTE
      ? validateCloudAssetSaveRequest(value)
      : validateCloudAssetIdentityRequest(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Cloud asset authoring request is invalid");
  }
}

function sendJson(response, statusCode, body) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", payload.length);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(payload);
}

export function createCloudAssetAuthoringMiddleware({
  expectedOrigin,
  authoring,
  maximumBytes = MAX_CLOUD_ASSET_AUTHORING_BYTES,
}) {
  if (typeof authoring?.save !== "function" || typeof authoring?.remove !== "function") {
    throw new TypeError("authoring must expose save and remove functions");
  }
  return (request, response, next) => {
    const route = request.url;
    if (route !== CLOUD_ASSET_SAVE_ROUTE && route !== CLOUD_ASSET_DELETE_ROUTE) {
      next();
      return;
    }
    void (async () => {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new HttpError(405, "Cloud asset authoring endpoints only accept POST");
      }
      if (!isSameCollisionSaveOrigin(headerValue(request.headers.origin), expectedOrigin)) {
        throw new HttpError(403, "Cloud asset authoring rejected: request origin is not this development server");
      }
      const envelope = trustedEnvelope(await readJsonBody(request, maximumBytes), route);
      const result = route === CLOUD_ASSET_SAVE_ROUTE
        ? await authoring.save(envelope)
        : await authoring.remove(envelope);
      sendJson(response, 200, { ok: true, ...result });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) sendJson(response, error.statusCode, { ok: false, error: error.message });
      else if (error instanceof CloudAssetAuthoringError) {
        sendJson(response, 422, { ok: false, error: error.message });
      } else {
        console.error("Cloud asset authoring failed", error);
        sendJson(response, 500, { ok: false, error: "Cloud asset authoring failed unexpectedly" });
      }
    });
  };
}
