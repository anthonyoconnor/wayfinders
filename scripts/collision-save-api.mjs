import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const COLLISION_SAVE_ROUTE = "/__wayfinders/collision/save";
export const MAX_COLLISION_SAVE_BYTES = 1_048_576;

const execFileAsync = promisify(execFile);
const viteNodeCli = createRequire(import.meta.url).resolve("vite-node/vite-node.mjs");

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class CollisionIntakeError extends Error {
  constructor(message) {
    super(message);
    this.name = "CollisionIntakeError";
  }
}

export function collisionSaveOrigin(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("Collision-save origin requires a valid TCP port");
  }
  return `http://127.0.0.1:${port}`;
}

export function isSameCollisionSaveOrigin(origin, expectedOrigin) {
  return typeof origin === "string" && origin === expectedOrigin;
}

function headerValue(value) {
  return Array.isArray(value) ? undefined : value;
}

function assertJsonContentType(value) {
  const contentType = headerValue(value);
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "Collision saves require Content-Type: application/json");
  }
}

function assertContentLength(value, maximumBytes) {
  const contentLength = headerValue(value);
  if (contentLength === undefined) return;
  if (!/^\d+$/u.test(contentLength)) throw new HttpError(400, "Content-Length must be a non-negative integer");
  if (Number(contentLength) > maximumBytes) {
    throw new HttpError(413, `Collision candidate exceeds the ${maximumBytes}-byte limit`);
  }
}

export async function readJsonRequestBody(request, maximumBytes = MAX_COLLISION_SAVE_BYTES) {
  assertJsonContentType(request.headers?.["content-type"]);
  assertContentLength(request.headers?.["content-length"], maximumBytes);

  const chunks = [];
  let byteLength = 0;
  for await (const sourceChunk of request) {
    const chunk = Buffer.isBuffer(sourceChunk) ? sourceChunk : Buffer.from(sourceChunk);
    byteLength += chunk.length;
    if (byteLength > maximumBytes) {
      throw new HttpError(413, `Collision candidate exceeds the ${maximumBytes}-byte limit`);
    }
    chunks.push(chunk);
  }
  if (byteLength === 0) throw new HttpError(400, "Collision candidate body cannot be empty");

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength));
  } catch {
    throw new HttpError(400, "Collision candidate must be valid UTF-8 JSON");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new HttpError(400, "Collision candidate body is not valid JSON");
  }
}

export function assertCollisionSaveEnvelope(candidate) {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || candidate.bundleKind !== "collision") {
    throw new HttpError(400, "This endpoint only accepts collision candidate bundles");
  }
  return candidate;
}

function compactPipelineMessage(error) {
  const output = [error?.stderr, error?.stdout]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");
  const typedMessage = output.match(/(?:^|\n)(?:Error|TypeError|RangeError):\s*([^\r\n]+)/u)?.[1];
  if (typedMessage) return typedMessage;
  const firstMessage = output.split(/\r?\n/u).find((line) => line.trim().length > 0 && !line.trim().startsWith("at "));
  return firstMessage?.trim() ?? "Collision intake failed";
}

export async function runCollisionIntake(candidateFile, repositoryRoot) {
  const pipelineFile = path.join(repositoryRoot, "scripts", "asset-pipeline.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      viteNodeCli,
      "--script",
      pipelineFile,
      "intake",
      candidateFile,
      "--replace",
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 1_048_576,
      windowsHide: true,
    });
    const message = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
    return { message: message ?? "Collision candidate accepted" };
  } catch (error) {
    throw new CollisionIntakeError(compactPipelineMessage(error));
  }
}

async function createTemporaryDirectory(repositoryRoot, temporaryRoot) {
  try {
    return await mkdtemp(path.join(temporaryRoot, "wayfinders-collision-save-"));
  } catch {
    // The OS temp directory is preferred because it cannot appear in a source
    // diff. node_modules is an ignored last resort for constrained machines.
    const fallbackRoot = path.join(repositoryRoot, "node_modules", ".wayfinders-tmp");
    await mkdir(fallbackRoot, { recursive: true });
    return mkdtemp(path.join(fallbackRoot, "collision-save-"));
  }
}

export function serializeCollisionSaves(saveOne) {
  let pending = Promise.resolve();
  return (candidate) => {
    const current = pending.then(
      () => saveOne(candidate),
      () => saveOne(candidate),
    );
    pending = current;
    return current;
  };
}

export function createCollisionSaver({
  repositoryRoot,
  temporaryRoot = tmpdir(),
  intake = runCollisionIntake,
}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");

  return serializeCollisionSaves(async (candidate) => {
    const directory = await createTemporaryDirectory(repositoryRoot, temporaryRoot);
    const candidateFile = path.join(directory, "collision-candidate.json");
    try {
      await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`, { encoding: "utf8", mode: 0o600 });
      const result = await intake(candidateFile, repositoryRoot);
      return {
        assetId: typeof candidate?.assetId === "string" ? candidate.assetId : undefined,
        message: result?.message ?? "Collision candidate accepted",
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
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

export function createCollisionSaveMiddleware({
  expectedOrigin,
  saveCollision,
  maximumBytes = MAX_COLLISION_SAVE_BYTES,
}) {
  return (request, response, next) => {
    if (request.url !== COLLISION_SAVE_ROUTE) {
      next();
      return;
    }

    void (async () => {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw new HttpError(405, "Collision save endpoint only accepts POST");
      }
      if (!isSameCollisionSaveOrigin(headerValue(request.headers.origin), expectedOrigin)) {
        throw new HttpError(403, "Collision save rejected: request origin is not this development server");
      }
      const candidate = assertCollisionSaveEnvelope(await readJsonRequestBody(request, maximumBytes));
      const saved = await saveCollision(candidate);
      sendJson(response, 200, { ok: true, ...saved });
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { ok: false, error: error.message });
      } else if (error instanceof CollisionIntakeError) {
        sendJson(response, 422, { ok: false, error: error.message });
      } else {
        console.error("Collision save failed", error);
        sendJson(response, 500, { ok: false, error: "Collision save failed unexpectedly" });
      }
    });
  };
}
