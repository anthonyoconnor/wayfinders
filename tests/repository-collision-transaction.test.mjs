import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  collisionIntakeLockPath,
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "../scripts/repository-collision-transaction.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "wayfinders-collision-transaction-"));
  temporaryRoots.push(root);
  return root;
}

async function optionalBytes(targetPath) {
  return readFile(targetPath).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
}

async function waitForText(targetPath, expected) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const text = await readFile(targetPath, "utf8").catch(() => "");
    if (text.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${expected}`);
}

describe("repository collision intake transaction", () => {
  it("commits all staged files and removes transaction artifacts", async () => {
    const root = await temporaryRepository();
    const archive = path.join(root, "candidates", "home.json");
    const metadata = path.join(root, "packages", "home.json");
    await mkdir(path.dirname(archive), { recursive: true });
    await mkdir(path.dirname(metadata), { recursive: true });
    await writeFile(archive, "old archive\n", "utf8");
    await writeFile(metadata, "old metadata\n", "utf8");

    let verified = false;
    await commitAtomicFileTransaction([
      { targetPath: archive, bytes: Buffer.from("new archive\n") },
      { targetPath: metadata, bytes: Buffer.from("new metadata\n") },
    ], async () => {
      expect(await readFile(archive, "utf8")).toBe("new archive\n");
      expect(await readFile(metadata, "utf8")).toBe("new metadata\n");
      verified = true;
    });

    expect(verified).toBe(true);
    expect(await readFile(archive, "utf8")).toBe("new archive\n");
    expect(await readFile(metadata, "utf8")).toBe("new metadata\n");
    expect((await readdir(path.dirname(archive))).filter((name) => name.startsWith("."))).toEqual([]);
    expect((await readdir(path.dirname(metadata))).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("restores existing files and removes newly-created files when verification fails", async () => {
    const root = await temporaryRepository();
    const archive = path.join(root, "candidates", "home.json");
    const metadata = path.join(root, "packages", "home.json");
    await mkdir(path.dirname(metadata), { recursive: true });
    await writeFile(metadata, "accepted metadata\n", "utf8");

    await expect(commitAtomicFileTransaction([
      { targetPath: archive, bytes: Buffer.from("candidate archive\n") },
      { targetPath: metadata, bytes: Buffer.from("replacement metadata\n") },
    ], async () => {
      expect(await readFile(archive, "utf8")).toBe("candidate archive\n");
      expect(await readFile(metadata, "utf8")).toBe("replacement metadata\n");
      throw new Error("post-write validation failed");
    })).rejects.toThrow("post-write validation failed");

    expect(await optionalBytes(archive)).toBeUndefined();
    expect(await readFile(metadata, "utf8")).toBe("accepted metadata\n");
  });

  it("rolls back the first replacement when a later atomic replace fails", async () => {
    const root = await temporaryRepository();
    const first = path.join(root, "first.json");
    const second = path.join(root, "second.json");
    await writeFile(first, "first old", "utf8");
    await writeFile(second, "second old", "utf8");
    let commitCount = 0;

    await expect(commitAtomicFileTransaction([
      { targetPath: first, bytes: Buffer.from("first new") },
      { targetPath: second, bytes: Buffer.from("second new") },
    ], undefined, {
      replaceFile: async (source, target, phase) => {
        if (phase === "commit" && ++commitCount === 2) throw new Error("second replace failed");
        await rename(source, target);
      },
    })).rejects.toThrow("second replace failed");

    expect(await readFile(first, "utf8")).toBe("first old");
    expect(await readFile(second, "utf8")).toBe("second old");
  });

  it("preserves the original backup if the filesystem also rejects rollback", async () => {
    const root = await temporaryRepository();
    const target = path.join(root, "accepted.json");
    await writeFile(target, "accepted old", "utf8");

    await expect(commitAtomicFileTransaction([
      { targetPath: target, bytes: Buffer.from("accepted new") },
    ], async () => {
      throw new Error("late verification failed");
    }, {
      replaceFile: async (source, destination, phase) => {
        if (phase === "rollback") throw new Error("rollback rename failed");
        await rename(source, destination);
      },
    })).rejects.toThrow(/rollback backups were preserved/);

    expect(await readFile(target, "utf8")).toBe("accepted new");
    const backup = (await readdir(root)).find((name) => name.endsWith(".backup"));
    expect(backup).toBeDefined();
    expect(await readFile(path.join(root, backup), "utf8")).toBe("accepted old");
  });

  it("releases the lock when the protected operation throws", async () => {
    const root = await temporaryRepository();
    await expect(withCollisionIntakeLock(root, async () => {
      throw new Error("intake failed");
    }, { timeoutMs: 100 })).rejects.toThrow("intake failed");
    await expect(stat(collisionIntakeLockPath(root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes independent Node processes against the same repository", async () => {
    const root = await temporaryRepository();
    const logFile = path.join(root, "order.log");
    const worker = fileURLToPath(new URL("./fixtures/collision-intake-lock-worker.mjs", import.meta.url));
    const first = execFileAsync(process.execPath, [worker, root, logFile, "first", "150"], { windowsHide: true });
    await waitForText(logFile, "start-first");
    const second = execFileAsync(process.execPath, [worker, root, logFile, "second", "0"], { windowsHide: true });
    await Promise.all([first, second]);

    expect((await readFile(logFile, "utf8")).trim().split(/\r?\n/u)).toEqual([
      "start-first",
      "end-first",
      "start-second",
      "end-second",
    ]);
    await expect(stat(collisionIntakeLockPath(root))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
