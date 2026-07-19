import { describe, expect, it } from "vitest";
import {
  applyConnectedBorderMatte,
  applyInwardAlphaEdgeFade,
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

  it("pads a native source canvas transparently without scaling its pixels", () => {
    const source = image(3, 2);
    setPixel(source, 0, 0, [220, 20, 20, 255]);
    setPixel(source, 2, 1, [20, 40, 220, 255]);

    const result = prepareProductionImage(source, {
      mode: "preserve",
      sizing: "native",
      targetWidth: 5,
      targetHeight: 4,
    });

    expect(result.sourceBounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(result.placement).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    expect(pixel(result.image, 1, 1)).toEqual([220, 20, 20, 255]);
    expect(pixel(result.image, 3, 2)).toEqual([20, 40, 220, 255]);
    expect(pixel(result.image, 0, 0)[3]).toBe(0);
    expect(() => prepareProductionImage(source, {
      mode: "preserve",
      sizing: "native",
      targetWidth: 2,
      targetHeight: 2,
    })).toThrow(/does not fit/u);
  });

  it("fades inward from an irregular alpha silhouette without expanding alpha", () => {
    const source = image(11, 11, [16, 42, 67, 0]);
    for (let y = 2; y <= 8; y++) {
      for (let x = 2; x <= 8; x++) setPixel(source, x, y, [16, 42, 67, 255]);
    }
    setPixel(source, 2, 2, [16, 42, 67, 0]);
    setPixel(source, 3, 2, [16, 42, 67, 0]);
    setPixel(source, 2, 3, [16, 42, 67, 0]);
    const beforeAlpha = Array.from({ length: source.width * source.height }, (_, index) => source.pixels[index * 4 + 3]);

    const result = applyInwardAlphaEdgeFade(source, 2);

    expect(pixel(result, 3, 3)[3]).toBe(0);
    expect(pixel(result, 4, 4)[3]).toBe(113);
    expect(pixel(result, 5, 5)[3]).toBe(255);
    expect(pixel(result, 0, 0)).toEqual([16, 42, 67, 0]);
    for (let index = 0; index < beforeAlpha.length; index++) {
      expect(result.pixels[index * 4 + 3]).toBeLessThanOrEqual(beforeAlpha[index]);
    }
    for (let x = 0; x < result.width; x++) {
      expect(pixel(result, x, 0)[3]).toBe(0);
      expect(pixel(result, x, result.height - 1)[3]).toBe(0);
    }
    for (let y = 0; y < result.height; y++) {
      expect(pixel(result, 0, y)[3]).toBe(0);
      expect(pixel(result, result.width - 1, y)[3]).toBe(0);
    }
  });

  it("keeps deep interior alpha and produces stable bytes for an edge-touching silhouette", () => {
    const source = image(12, 12, [22, 58, 79, 255]);
    setPixel(source, 0, 0, [22, 58, 79, 0]);
    setPixel(source, 1, 0, [22, 58, 79, 0]);
    setPixel(source, 0, 1, [22, 58, 79, 0]);

    const first = applyInwardAlphaEdgeFade(source, 3);
    const second = applyInwardAlphaEdgeFade(source, 3);

    expect(first.pixels).toEqual(second.pixels);
    const inwardAlpha = [0, 1, 2, 3, 4].map((x) => pixel(first, x, 6)[3]);
    expect(inwardAlpha).toEqual([0, 28, 113, 255, 255]);
    for (let index = 1; index < inwardAlpha.length; index++) {
      expect(inwardAlpha[index]).toBeGreaterThanOrEqual(inwardAlpha[index - 1]);
    }
    for (let x = 0; x < first.width; x++) {
      expect(pixel(first, x, 0)[3]).toBe(0);
      expect(pixel(first, x, first.height - 1)[3]).toBe(0);
    }
    for (let y = 0; y < first.height; y++) {
      expect(pixel(first, 0, y)[3]).toBe(0);
      expect(pixel(first, first.width - 1, y)[3]).toBe(0);
    }
    expect(pixel(first, 6, 6)[3]).toBe(255);
    expect(source.pixels[(6 * source.width + 6) * 4 + 3]).toBe(255);
  });

  it("color-matches only visible pixels in the fade band while retaining squared coverage", () => {
    const source = image(12, 12, [100, 120, 140, 255]);
    setPixel(source, 0, 0, [231, 17, 29, 0]);
    const result = applyInwardAlphaEdgeFade(source, 3, [8, 48, 68]);

    expect(pixel(result, 0, 6)).toEqual([8, 48, 68, 0]);
    expect(pixel(result, 1, 6)).toEqual([39, 72, 92, 28]);
    expect(pixel(result, 2, 6)).toEqual([69, 96, 116, 113]);
    expect(pixel(result, 3, 6)).toEqual([100, 120, 140, 255]);
    expect(pixel(result, 6, 6)).toEqual([100, 120, 140, 255]);
    expect(pixel(result, 0, 0)).toEqual([231, 17, 29, 0]);

    const inwardAlpha = [0, 1, 2, 3, 4].map((x) => pixel(result, x, 6)[3]);
    for (let index = 1; index < inwardAlpha.length; index++) {
      expect(inwardAlpha[index]).toBeGreaterThanOrEqual(inwardAlpha[index - 1]);
    }

    const prepared = prepareProductionImage(source, {
      mode: "preserve",
      sizing: "native",
      targetWidth: 12,
      targetHeight: 12,
      alphaEdgeFadePixels: 3,
      alphaEdgeBlendColor: [8, 48, 68],
    });
    expect(prepared.image.pixels).toEqual(result.pixels);
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
