import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createThumbnail,
  decodePng,
  encodePng,
} from "../scripts/asset-pipeline.mjs";

describe("GR-2.3 deterministic PNG automation", () => {
  it("round-trips RGBA pixels through the deterministic encoder", () => {
    const pixels = Buffer.from([
      255, 0, 0, 255,
      0, 255, 0, 192,
      0, 0, 255, 128,
      255, 255, 255, 0,
    ]);
    const encoded = encodePng(2, 2, pixels);
    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.pixels).toEqual(pixels);
    expect(encodePng(2, 2, pixels)).toEqual(encoded);
  });

  it("creates byte-identical bounded thumbnails", async () => {
    const source = await readFile(new URL("../public/assets/gr1/images/home-island.png", import.meta.url));
    const first = createThumbnail(source);
    const second = createThumbnail(source);
    expect(first.width).toBe(192);
    expect(first.height).toBe(192);
    expect(second.buffer).toEqual(first.buffer);
    expect(decodePng(first.buffer).pixels).toHaveLength(192 * 192 * 4);
  });
});
