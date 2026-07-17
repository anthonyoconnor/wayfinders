import {
  validateProductionCandidateAuthoringRequest,
  validateProductionCandidateIdentityRequest,
} from "../src/wayfinders/assets/ProductionCandidateAuthoring.ts";
import { isSameCollisionSaveOrigin } from "./collision-save-api.mjs";
import { ProductionCandidateAuthoringError } from "./production-candidate-authoring.mjs";

export const PRODUCTION_CANDIDATE_SAVE_ROUTE = "/__wayfinders/assets/candidate/save";
export const PRODUCTION_CANDIDATE_VALIDATE_ROUTE = "/__wayfinders/assets/candidate/validate";
export const PRODUCTION_CANDIDATE_DELETE_ROUTE = "/__wayfinders/assets/candidate/delete";
export const MAX_PRODUCTION_CANDIDATE_AUTHORING_BYTES = 8 * 1_048_576;

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
    throw new HttpError(415, "Candidate authoring requires Content-Type: application/json");
  }
}

function assertContentLength(value, maximumBytes) {
  const contentLength = headerValue(value);
  if (contentLength === undefined) return;
  if (!/^\d+$/u.test(contentLength)) throw new HttpError(400, "Content-Length must be a non-negative integer");
  if (Number(contentLength) > maximumBytes) {
    throw new HttpError(413, `Candidate authoring request exceeds the ${maximumBytes}-byte limit`);
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
      throw new HttpError(413, `Candidate authoring request exceeds the ${maximumBytes}-byte limit`);
    }
    chunks.push(chunk);
  }
  if (byteLength === 0) throw new HttpError(400, "Candidate authoring request body cannot be empty");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength));
  } catch {
    throw new HttpError(400, "Candidate authoring request must be valid UTF-8 JSON");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, "Candidate authoring request body is not valid JSON");
  }
}

function trustedEnvelope(value, route) {
  try {
    return route === PRODUCTION_CANDIDATE_SAVE_ROUTE
      ? validateProductionCandidateAuthoringRequest(value)
      : validateProductionCandidateIdentityRequest(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Candidate authoring request is invalid");
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

export function createProductionCandidateAuthoringMiddleware({
  expectedOrigin,
  authoring,
  maximumBytes = MAX_PRODUCTION_CANDIDATE_AUTHORING_BYTES,
}) {
  if (typeof authoring?.save !== "function"
    || typeof authoring?.validate !== "function"
    || typeof authoring?.remove !== "function") {
    throw new TypeError("authoring must expose save, validate and remove functions");
  }
  return (request, response, next) => {
    const route = request.url;
    if (route !== PRODUCTION_CANDIDATE_SAVE_ROUTE
      && route !== PRODUCTION_CANDIDATE_VALIDATE_ROUTE
      && route !== PRODUCTION_CANDIDATE_DELETE_ROUTE) {
      next();
      return;
    }
    void (async () => {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new HttpError(405, "Candidate authoring endpoints only accept POST");
      }
      if (!isSameCollisionSaveOrigin(headerValue(request.headers.origin), expectedOrigin)) {
        throw new HttpError(403, "Candidate authoring rejected: request origin is not this development server");
      }
      const envelope = trustedEnvelope(await readJsonBody(request, maximumBytes), route);
      const result = route === PRODUCTION_CANDIDATE_SAVE_ROUTE
        ? await authoring.save(envelope)
        : route === PRODUCTION_CANDIDATE_DELETE_ROUTE
          ? await authoring.remove(envelope)
          : await authoring.validate(envelope);
      sendJson(response, 200, { ok: true, ...result });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) sendJson(response, error.statusCode, { ok: false, error: error.message });
      else if (error instanceof ProductionCandidateAuthoringError) {
        sendJson(response, 422, { ok: false, error: error.message });
      } else {
        console.error("Production candidate authoring failed", error);
        sendJson(response, 500, { ok: false, error: "Production candidate authoring failed unexpectedly" });
      }
    });
  };
}
