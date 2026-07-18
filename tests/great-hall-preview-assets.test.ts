import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GREAT_HALL_FIXTURE } from "../src/wayfinders/assets/greatHall/GreatHallFixture";

const repositoryRoot = process.cwd();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const execFileAsync = promisify(execFile);

async function readPng(relativePath: string): Promise<Buffer> {
  const buffer = await readFile(path.join(repositoryRoot, "public", relativePath));
  expect(buffer.subarray(0, pngSignature.length)).toEqual(pngSignature);
  return buffer;
}

describe("GR-5.2 Great Hall fixed asset set", () => {
  it("keeps all twenty ordered portrait files present and distinct", async () => {
    const portraits = await Promise.all(GREAT_HALL_FIXTURE.navigators.map(async (navigator) => {
      const relativePath = navigator.portraitUrl.replace(/^\/assets\//, "assets/");
      const [buffer, metadata] = await Promise.all([
        readPng(relativePath),
        stat(path.join(repositoryRoot, "public", relativePath)),
      ]);
      expect(metadata.size).toBeGreaterThan(100_000);
      return createHash("sha256").update(buffer).digest("hex");
    }));

    expect(new Set(portraits)).toHaveLength(20);
  });

  it("keeps the authored achievement sheet and empty Hall plate available to the preview", async () => {
    const assets = await Promise.all([
      readPng("assets/gr5/great-hall/achievement-token-set.png"),
      readPng("assets/gr5/great-hall/hall-interior-backdrop.png"),
    ]);
    for (const asset of assets) expect(asset.byteLength).toBeGreaterThan(1_000_000);
  });

  it("keeps the animated achievement sprite sheet within its checked runtime contract", async () => {
    const spriteSheet = await readPng(
      "assets/gr5/achievement-icons/achievement-icon-sprites.png",
    );
    expect(spriteSheet.readUInt32BE(16)).toBe(2_048);
    expect(spriteSheet.readUInt32BE(20)).toBe(1_280);
    expect(spriteSheet[24]).toBe(8);
    expect(spriteSheet[25]).toBe(6);
    expect(spriteSheet[28]).toBe(0);

    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "achievement-icon-asset-check.mjs")],
      { cwd: repositoryRoot },
    );
    expect(stdout).toContain("Achievement icon assets: OK (10 icons, 16 frames each");
  });
});
