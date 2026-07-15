import {
  ProductionAssetReviewError,
  validateProductionReviewRequest,
} from "./production-asset-review.mjs";
import {
  collisionSaveOrigin,
  isSameCollisionSaveOrigin,
} from "./collision-save-api.mjs";

export const ASSET_REVIEW_ROUTE = "/__wayfinders/assets/review";
export const MAX_ASSET_REVIEW_BYTES = 16_384;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function assetReviewOrigin(port) {
  return collisionSaveOrigin(port);
}

function headerValue(value) {
  return Array.isArray(value) ? undefined : value;
}

function assertJsonContentType(value) {
  const contentType = headerValue(value);
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Asset reviews require Content-Type: application/json");
  }
}

function assertContentLength(value, maximumBytes) {
  const contentLength = headerValue(value);
  if (contentLength === undefined) return;
  if (!/^\d+$/u.test(contentLength)) throw new HttpError(400, "Content-Length must be a non-negative integer");
  if (Number(contentLength) > maximumBytes) {
    throw new HttpError(413, `Asset review exceeds the ${maximumBytes}-byte limit`);
  }
}

async function readReviewBody(request, maximumBytes) {
  assertJsonContentType(request.headers?.["content-type"]);
  assertContentLength(request.headers?.["content-length"], maximumBytes);
  const chunks = [];
  let byteLength = 0;
  for await (const sourceChunk of request) {
    const chunk = Buffer.isBuffer(sourceChunk) ? sourceChunk : Buffer.from(sourceChunk);
    byteLength += chunk.length;
    if (byteLength > maximumBytes) throw new HttpError(413, `Asset review exceeds the ${maximumBytes}-byte limit`);
    chunks.push(chunk);
  }
  if (byteLength === 0) throw new HttpError(400, "Asset review body cannot be empty");

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength));
  } catch {
    throw new HttpError(400, "Asset review must be valid UTF-8 JSON");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, "Asset review body is not valid JSON");
  }
}

function trustedReviewEnvelope(value) {
  try {
    return validateProductionReviewRequest(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Asset review envelope is invalid");
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

export function createAssetReviewMiddleware({
  expectedOrigin,
  reviewCandidate,
  maximumBytes = MAX_ASSET_REVIEW_BYTES,
}) {
  if (typeof reviewCandidate !== "function") throw new TypeError("reviewCandidate must be a function");
  return (request, response, next) => {
    if (request.url !== ASSET_REVIEW_ROUTE) {
      next();
      return;
    }

    void (async () => {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new HttpError(405, "Asset review endpoint only accepts POST");
      }
      if (!isSameCollisionSaveOrigin(headerValue(request.headers.origin), expectedOrigin)) {
        throw new HttpError(403, "Asset review rejected: request origin is not this development server");
      }
      const requestValue = trustedReviewEnvelope(await readReviewBody(request, maximumBytes));
      const reviewed = await reviewCandidate(requestValue);
      sendJson(response, 200, { ok: true, ...reviewed });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { ok: false, error: error.message });
      } else if (error instanceof ProductionAssetReviewError) {
        sendJson(response, 422, { ok: false, error: error.message });
      } else {
        console.error("Asset review failed", error);
        sendJson(response, 500, { ok: false, error: "Asset review failed unexpectedly" });
      }
    });
  };
}
