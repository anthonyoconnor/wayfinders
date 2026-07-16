import { randomUUID } from "node:crypto";
import {
  PRODUCTION_ASSET_INTAKE_ROUTE,
  ProductionAssetIntakeValidationError,
} from "../src/wayfinders/assets/ProductionAssetIntake.ts";
import { ProductionAssetIntakeCancelledError } from "./production-asset-intake.mjs";
import { isSameCollisionSaveOrigin } from "./collision-save-api.mjs";

export { PRODUCTION_ASSET_INTAKE_ROUTE };
export const MAX_ASSET_INTAKE_BYTES = 48 * 1_048_576;

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

async function readJsonBody(request, maximumBytes) {
  const contentType = headerValue(request.headers?.["content-type"]);
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Asset intake requires Content-Type: application/json");
  }
  const declared = headerValue(request.headers?.["content-length"]);
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpError(413, `Asset intake exceeds the ${maximumBytes}-byte limit`);
  }
  const chunks = [];
  let length = 0;
  for await (const source of request) {
    const chunk = Buffer.isBuffer(source) ? source : Buffer.from(source);
    length += chunk.length;
    if (length > maximumBytes) throw new HttpError(413, `Asset intake exceeds the ${maximumBytes}-byte limit`);
    chunks.push(chunk);
  }
  if (length === 0) throw new HttpError(400, "Asset intake body cannot be empty");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch {
    throw new HttpError(400, "Asset intake body is not valid UTF-8 JSON");
  }
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    phase: job.phase,
    message: job.message,
    ...(job.recipeId ? { recipeId: job.recipeId } : {}),
    ...(job.fieldErrors ? { fieldErrors: job.fieldErrors } : {}),
  };
}

export function createProductionAssetIntakeJobs(runIntake) {
  if (typeof runIntake !== "function") throw new TypeError("runIntake must be a function");
  const jobs = new Map();

  function prune() {
    const terminal = [...jobs.values()].filter((job) => ["completed", "failed", "cancelled"].includes(job.status));
    for (const job of terminal.slice(0, Math.max(0, terminal.length - 100))) jobs.delete(job.jobId);
  }

  return {
    start(input) {
      prune();
      const job = {
        jobId: randomUUID(),
        status: "queued",
        phase: "queued",
        message: "Queued for local preparation",
        controller: new AbortController(),
      };
      jobs.set(job.jobId, job);
      queueMicrotask(() => {
        if (job.controller.signal.aborted) {
          Object.assign(job, { status: "cancelled", phase: "cancelled", message: "Intake cancelled before repository changes" });
          return;
        }
        job.status = "running";
        void runIntake(input, {
          signal: job.controller.signal,
          onProgress(phase, message) {
            if (job.status === "running") Object.assign(job, { phase, message });
          },
        }).then((result) => {
          Object.assign(job, {
            status: "completed",
            phase: "completed",
            recipeId: result.recipeId,
            message: result.message,
          });
        }).catch((error) => {
          if (error instanceof ProductionAssetIntakeCancelledError || job.controller.signal.aborted) {
            Object.assign(job, { status: "cancelled", phase: "cancelled", message: "Intake cancelled; no partial output was kept" });
          } else if (error instanceof ProductionAssetIntakeValidationError) {
            Object.assign(job, {
              status: "failed",
              phase: "validation",
              message: error.message,
              fieldErrors: error.fieldErrors,
            });
          } else {
            console.error("Production asset intake failed", error);
            Object.assign(job, {
              status: "failed",
              phase: "failed",
              message: error instanceof Error ? error.message : "Asset intake failed unexpectedly",
            });
          }
        });
      });
      return publicJob(job);
    },
    get(jobId) {
      const job = jobs.get(jobId);
      return job ? publicJob(job) : undefined;
    },
    cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) return undefined;
      if (job.status === "queued" || job.status === "running") {
        job.controller.abort();
        Object.assign(job, { status: "cancelling", phase: "cancelling", message: "Cancelling before the next repository transaction" });
      }
      return publicJob(job);
    },
  };
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

export function createAssetIntakeMiddleware({
  expectedOrigin,
  jobs,
  maximumBytes = MAX_ASSET_INTAKE_BYTES,
}) {
  if (!jobs || typeof jobs.start !== "function") throw new TypeError("jobs must be a production intake job store");
  return (request, response, next) => {
    const url = request.url ?? "";
    if (url !== PRODUCTION_ASSET_INTAKE_ROUTE && !url.startsWith(`${PRODUCTION_ASSET_INTAKE_ROUTE}/`)) {
      next();
      return;
    }
    void (async () => {
      const origin = headerValue(request.headers.origin);
      const readOnlyStatus = request.method === "GET" && url !== PRODUCTION_ASSET_INTAKE_ROUTE;
      if ((!readOnlyStatus || origin !== undefined) && !isSameCollisionSaveOrigin(origin, expectedOrigin)) {
        throw new HttpError(403, "Asset intake rejected: request origin is not this development server");
      }
      if (url === PRODUCTION_ASSET_INTAKE_ROUTE) {
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          throw new HttpError(405, "Asset intake creation only accepts POST");
        }
        const job = jobs.start(await readJsonBody(request, maximumBytes));
        sendJson(response, 202, { ok: true, ...job });
        return;
      }
      const jobId = url.slice(PRODUCTION_ASSET_INTAKE_ROUTE.length + 1);
      if (!/^[0-9a-f-]{36}$/u.test(jobId)) throw new HttpError(404, "Unknown asset intake job");
      if (request.method !== "GET" && request.method !== "DELETE") {
        response.setHeader("Allow", "GET, DELETE");
        throw new HttpError(405, "Asset intake jobs accept GET or DELETE");
      }
      const job = request.method === "DELETE" ? jobs.cancel(jobId) : jobs.get(jobId);
      if (!job) throw new HttpError(404, "Unknown asset intake job");
      sendJson(response, 200, { ok: true, ...job });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) sendJson(response, error.statusCode, { ok: false, error: error.message });
      else {
        console.error("Asset intake API failed", error);
        sendJson(response, 500, { ok: false, error: "Asset intake API failed unexpectedly" });
      }
    });
  };
}
