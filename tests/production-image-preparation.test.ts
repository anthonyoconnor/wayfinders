import { describe, expect, it } from "vitest";
import {
  applyConnectedBorderMatte,
  prepareProductionImage,
  trimAndContainImage,
} from "../scripts/production-image-preparation.mjs";

type Rgba = readonly [number, number, number, number];

function image(width: number, height: number, color: Rgba = [0, 0, 0, 0]) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) pixels.set(color, index * 4);
  return { width, height, pixels };
}

function setPixel(target: ReturnType<typeof image>, x: number, y: number, color: Rgba) {
  target.pixels.set(color, (y * target.width + x) * 4);
}

function pixel(target: ReturnType<typeof image>, x: number, y: number): Rgba {
  const offset = (y * target.width + x) * 4;
  return [...target.pixels.subarray(offset, offset + 4)] as unknown as Rgba;
}

const mattePreparation = {
  mode: "connected-border",
  targetWidth: 8,
  targetHeight: 8,
  matteColor: [255, 0, 255],
  innerTolerance: 0,
  outerTolerance: 96,
  trimAlphaThreshold: 0,
  padding: 0,
} as const;

describe("GR-3.2 production image preparation", () => {
  it("removes a matte connected to the image border", () => {
    const source = image(3, 3, [255, 0, 255, 255]);
    setPixel(source, 1, 1, [10, 180, 40, 255]);

    const result = applyConnectedBorderMatte(source, mattePreparation);

    expect(pixel(result, 0, 0)[3]).toBe(0);
    expect(pixel(result, 1, 1)).toEqual([10, 180, 40, 255]);
    expect(pixel(source, 0, 0)[3]).toBe(255);
  });

  it("preserves matching color enclosed behind non-matte pixels", () => {
    const source = image(5, 5, [255, 0, 255, 255]);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) setPixel(source, x, y, [20, 120, 40, 255]);
    }
    setPixel(source, 2, 2, [255, 0, 255, 255]);

    const result = applyConnectedBorderMatte(source, mattePreparation);

    expect(pixel(result, 0, 2)[3]).toBe(0);
    expect(pixel(result, 2, 2)).toEqual([255, 0, 255, 255]);
  });

  it("feathers alpha through the tolerance band", () => {
    const source = image(3, 1);
    setPixel(source, 0, 0, [0, 0, 0, 255]);
    setPixel(source, 1, 0, [50, 0, 0, 255]);
    setPixel(source, 2, 0, [100, 0, 0, 255]);

    const result = applyConnectedBorderMatte(source, {
      ...mattePreparation,
      matteColor: [0, 0, 0],
      outerTolerance: 100,
    });

    expect([pixel(result, 0, 0)[3], pixel(result, 1, 0)[3], pixel(result, 2, 0)[3]])
      .toEqual([0, 128, 255]);
  });

  it("reports exact trim, padding and centered contain placement", () => {
    const source = image(6, 5);
    setPixel(source, 2, 2, [0, 200, 80, 255]);
    setPixel(source, 3, 2, [0, 200, 80, 255]);

    const result = trimAndContainImage(source, {
      ...mattePreparation,
      targetWidth: 10,
      targetHeight: 10,
      padding: 1,
    });

    expect(result.image).toMatchObject({ width: 10, height: 10 });
    expect(result.sourceBounds).toEqual({ x: 1, y: 1, width: 4, height: 3 });
    expect(result.placement).toEqual({ x: 0, y: 1, width: 10, height: 8 });
    expect(pixel(result.image, 3, 4)[3]).toBe(255);
    expect(pixel(result.image, 2, 4)[3]).toBe(0);
    expect(pixel(result.image, 3, 3)[3]).toBe(0);
  });

  it("preserves the complete source while contain-fitting with nearest-neighbour", () => {
    const source = image(2, 1);
    setPixel(source, 0, 0, [220, 20, 20, 255]);
    setPixel(source, 1, 0, [20, 40, 220, 255]);

    const result = prepareProductionImage(source, {
      mode: "preserve",
      targetWidth: 4,
      targetHeight: 4,
    });

    expect(result.sourceBounds).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(result.placement).toEqual({ x: 0, y: 1, width: 4, height: 2 });
    expect(pixel(result.image, 0, 1)).toEqual([220, 20, 20, 255]);
    expect(pixel(result.image, 1, 2)).toEqual([220, 20, 20, 255]);
    expect(pixel(result.image, 2, 1)).toEqual([20, 40, 220, 255]);
    expect(pixel(result.image, 3, 2)).toEqual([20, 40, 220, 255]);
    expect(pixel(result.image, 0, 0)[3]).toBe(0);
  });

  it("is byte-for-byte deterministic", () => {
    const source = image(4, 3, [255, 0, 255, 255]);
    setPixel(source, 1, 1, [70, 150, 40, 255]);
    setPixel(source, 2, 1, [80, 160, 50, 192]);
    const before = Buffer.from(source.pixels);

    const first = prepareProductionImage(source, mattePreparation);
    const second = prepareProductionImage(source, mattePreparation);

    expect(first).toEqual(second);
    expect(first.image.pixels).toEqual(second.image.pixels);
    expect(source.pixels).toEqual(before);
  });
});
