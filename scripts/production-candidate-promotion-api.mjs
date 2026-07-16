import {
  validateProductionCandidateIdentityRequest,
} from "../src/wayfinders/assets/ProductionCandidateAuthoring.ts";
import { isSameCollisionSaveOrigin } from "./collision-save-api.mjs";
import { ProductionAssetPromotionError } from "./production-asset-promotion.mjs";
import { ProductionCandidatePromotionError } from "./production-candidate-promotion.mjs";

export const PRODUCTION_CANDIDATE_PROMOTION_ROUTE = "/__wayfinders/assets/candidate/promote";
export const MAX_PRODUCTION_CANDIDATE_PROMOTION_BYTES = 16_384;

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

async function body(request, maximumBytes) {
  const contentType = headerValue(request.headers?.["content-type"]);
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Candidate promotion requires Content-Type: application/json");
  }
  const declared = headerValue(request.headers?.["content-length"]);
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpError(/^\d+$/u.test(declared) ? 413 : 400, "Candidate promotion Content-Length is invalid or too large");
  }
  const chunks = [];
  let length = 0;
  for await (const source of request) {
    const chunk = Buffer.isBuffer(source) ? source : Buffer.from(source);
    length += chunk.length;
    if (length > maximumBytes) throw new HttpError(413, "Candidate promotion request is too large");
    chunks.push(chunk);
  }
  if (length === 0) throw new HttpError(400, "Candidate promotion request body cannot be empty");
  let value;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length));
    value = JSON.parse(source);
  } catch {
    throw new HttpError(400, "Candidate promotion request must be valid UTF-8 JSON");
  }
  try {
    return validateProductionCandidateIdentityRequest(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Candidate promotion request is invalid");
  }
}

function sendJson(response, statusCode, value) {
  const payload = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.statusCode = statusCode;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", payload.length);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(payload);
}

export function createProductionCandidatePromotionMiddleware({
  expectedOrigin,
  promoteCandidate,
  maximumBytes = MAX_PRODUCTION_CANDIDATE_PROMOTION_BYTES,
}) {
  if (typeof promoteCandidate !== "function") throw new TypeError("promoteCandidate must be a function");
  return (request, response, next) => {
    if (request.url !== PRODUCTION_CANDIDATE_PROMOTION_ROUTE) {
      next();
      return;
    }
    void (async () => {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new HttpError(405, "Candidate promotion endpoint only accepts POST");
      }
      if (!isSameCollisionSaveOrigin(headerValue(request.headers.origin), expectedOrigin)) {
        throw new HttpError(403, "Candidate promotion rejected: request origin is not this development server");
      }
      const result = await promoteCandidate(await body(request, maximumBytes));
      sendJson(response, 200, { ok: true, ...result });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) sendJson(response, error.statusCode, { ok: false, error: error.message });
      else if (error instanceof ProductionCandidatePromotionError || error instanceof ProductionAssetPromotionError) {
        sendJson(response, 422, { ok: false, error: error.message });
      } else {
        console.error("Production candidate promotion failed", error);
        sendJson(response, 500, { ok: false, error: "Production candidate promotion failed unexpectedly" });
      }
    });
  };
}
