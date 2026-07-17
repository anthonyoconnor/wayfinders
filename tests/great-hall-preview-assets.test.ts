import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GREAT_HALL_FIXTURE } from "../src/wayfinders/assets/greatHall/GreatHallFixture";

const repositoryRoot = process.cwd();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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
});
