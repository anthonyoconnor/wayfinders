import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 25;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

export function collisionIntakeLockPath(repositoryRoot) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  return path.join(repositoryRoot, "node_modules", ".cache", "wayfinders", "collision-intake.lock");
}

async function lockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function releaseOwnedLock(lockPath, token) {
  const owner = await lockOwner(lockPath);
  if (owner?.token !== token) {
    throw new Error(`Collision intake lock ownership changed before release: ${lockPath}`);
  }
  await rm(lockPath, { recursive: true, force: true });
}

/**
 * Repository-wide collision/asset intake exclusion implemented with atomic
 * directory creation so independent Node processes share the same lock.
 */
export async function withCollisionIntakeLock(
  repositoryRoot,
  operation,
  {
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError("timeoutMs must be non-negative");
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 1) throw new RangeError("retryDelayMs must be positive");
  const lockPath = collisionIntakeLockPath(repositoryRoot);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();

  while (true) {
    try {
      await mkdir(lockPath);
      try {
        const ownerFile = await open(path.join(lockPath, "owner.json"), "wx", 0o600);
        try {
          await ownerFile.writeFile(`${JSON.stringify({
            token,
            pid: process.pid,
            acquiredAt: new Date().toISOString(),
          })}\n`, "utf8");
          await ownerFile.sync();
        } finally {
          await ownerFile.close();
        }
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        const owner = await lockOwner(lockPath);
        const detail = Number.isInteger(owner?.pid) ? ` held by PID ${owner.pid}` : "";
        throw new Error(
          `Timed out waiting for collision intake lock${detail}: ${lockPath}. `
          + "If that process no longer exists, remove the lock directory and retry.",
        );
      }
      await delay(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())));
    }
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedLock(lockPath, token);
  }
}

async function readOptional(targetPath) {
  try {
    return await readFile(targetPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function writeDurableExclusive(targetPath, bytes, mode = 0o600) {
  const handle = await open(targetPath, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeOptional(targetPath) {
  try {
    await rm(targetPath, { force: true });
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/**
 * Replaces a small set of files from durable sibling staging files. Originals
 * remain staged as backups until the caller's post-write verification passes;
 * any failure restores every target changed by this transaction.
 */
export async function commitAtomicFileTransaction(
  changes,
  verify = async () => undefined,
  { replaceFile = async (source, target) => rename(source, target) } = {},
) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new TypeError("Atomic file transaction requires at least one change");
  }
  const targets = new Set();
  for (const change of changes) {
    if (!path.isAbsolute(change.targetPath)) throw new TypeError("Transaction targetPath must be absolute");
    if (targets.has(change.targetPath)) throw new RangeError(`Duplicate transaction target ${change.targetPath}`);
    targets.add(change.targetPath);
  }

  const token = `${process.pid}-${randomUUID()}`;
  const entries = [];
  let preserveBackups = false;
  try {
    for (const change of changes) {
      const directory = path.dirname(change.targetPath);
      await mkdir(directory, { recursive: true });
      const basename = path.basename(change.targetPath);
      const original = await readOptional(change.targetPath);
      const originalMode = original === undefined
        ? undefined
        : (await stat(change.targetPath)).mode & 0o777;
      const entry = {
        targetPath: change.targetPath,
        stagedPath: path.join(directory, `.${basename}.${token}.next`),
        backupPath: original === undefined
          ? undefined
          : path.join(directory, `.${basename}.${token}.backup`),
        existed: original !== undefined,
        committed: false,
      };
      entries.push(entry);
      await writeDurableExclusive(entry.stagedPath, change.bytes, originalMode ?? 0o666);
      if (entry.backupPath) await writeDurableExclusive(entry.backupPath, original, originalMode);
    }
    for (const entry of entries) {
      await replaceFile(entry.stagedPath, entry.targetPath, "commit");
      entry.committed = true;
    }
    await verify();
  } catch (cause) {
    const rollbackErrors = [];
    for (const entry of [...entries].reverse()) {
      if (!entry.committed) continue;
      try {
        if (entry.existed && entry.backupPath) {
          await replaceFile(entry.backupPath, entry.targetPath, "rollback");
        } else {
          await removeOptional(entry.targetPath);
        }
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveBackups = true;
      throw new AggregateError(
        [cause, ...rollbackErrors],
        "Atomic collision intake failed and could not fully restore its previous files; rollback backups were preserved",
      );
    }
    throw cause;
  } finally {
    await Promise.allSettled(entries.flatMap((entry) => [
      removeOptional(entry.stagedPath),
      ...(!preserveBackups && entry.backupPath ? [removeOptional(entry.backupPath)] : []),
    ]));
  }
}
