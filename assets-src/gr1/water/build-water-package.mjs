import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const TILE_SIZE = 32;
const FRAME_COUNT = 8;
const VARIANT_COUNT = 4;
const TRANSITION_FRAME_COUNT = 4;
const HOME_ISLAND_FRAME_SIZE = 480;
const HOME_HANDOFF_MARGIN = 160;
const HOME_HANDOFF_FRAME_SIZE = HOME_ISLAND_FRAME_SIZE + HOME_HANDOFF_MARGIN * 2;
const HOME_HANDOFF_COLUMNS = 4;
const HOME_HANDOFF_ROWS = FRAME_COUNT / HOME_HANDOFF_COLUMNS;

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(root, "source");
const runtimeRoot = path.join(root, "runtime");
const repositoryRoot = path.resolve(root, "..", "..", "..");

function crc32(buffer) {
  let crc = 0xffff_ffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeft
    ? left
    : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(buffer, label = "PNG") {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 29 || buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new RangeError(`${label} is not a PNG file`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new RangeError(`${label} must be a non-interlaced 8-bit RGB or RGBA PNG`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    const filter = filtered[rowOffset];
    for (let x = 0; x < stride; x++) {
      const source = filtered[rowOffset + 1 + x];
      const left = x >= channels ? current[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      switch (filter) {
        case 0: current[x] = source; break;
        case 1: current[x] = (source + left) & 0xff; break;
        case 2: current[x] = (source + above) & 0xff; break;
        case 3: current[x] = (source + Math.floor((left + above) / 2)) & 0xff; break;
        case 4: current[x] = (source + paeth(left, above, upperLeft)) & 0xff; break;
        default: throw new RangeError(`${label} uses unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x++) {
      const sourceIndex = x * channels;
      const targetIndex = (y * width + x) * 4;
      pixels[targetIndex] = current[sourceIndex];
      pixels[targetIndex + 1] = current[sourceIndex + 1];
      pixels[targetIndex + 2] = current[sourceIndex + 2];
      pixels[targetIndex + 3] = channels === 4 ? current[sourceIndex + 3] : 255;
    }
    current.copy(previous);
  }
  return { width, height, pixels };
}

function encodePng(width, height, pixels) {
  if (pixels.length !== width * height * 4) throw new RangeError("RGBA buffer length does not match PNG dimensions");
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp = (value, low = 0, high = 255) => Math.max(low, Math.min(high, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash32(...values) {
  let value = 0x811c9dc5;
  for (const input of values) {
    value ^= input >>> 0;
    value = Math.imul(value, 0x01000193);
    value ^= value >>> 13;
  }
  return value >>> 0;
}

function pixel(image, x, y) {
  const index = (mod(y, image.height) * image.width + mod(x, image.width)) * 4;
  return [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2], image.pixels[index + 3]];
}

function setPixel(buffer, width, x, y, rgba) {
  const index = (y * width + x) * 4;
  buffer[index] = clamp(Math.round(rgba[0]));
  buffer[index + 1] = clamp(Math.round(rgba[1]));
  buffer[index + 2] = clamp(Math.round(rgba[2]));
  buffer[index + 3] = clamp(Math.round(rgba[3]));
}

function readPixel(buffer, width, x, y) {
  const index = (y * width + x) * 4;
  return [buffer[index], buffer[index + 1], buffer[index + 2], buffer[index + 3]];
}

function mix(left, right, amount) {
  return left.map((channel, index) => channel + (right[index] - channel) * amount);
}

function gradeColor(rgba, profile, x, y, frame) {
  const [r, g, b] = rgba;
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const contrast = profile.contrast;
  let graded = [
    (r - 128) * contrast + 128,
    (g - 128) * contrast + 128,
    (b - 128) * contrast + 128,
  ];
  const saturation = profile.saturation;
  graded = graded.map((channel) => luma + (channel - luma) * saturation);
  graded = graded.map((channel, index) => channel * profile.multiply[index] + profile.add[index]);
  const shimmer = Math.sin((x * 0.73 + y * 0.41) + frame * Math.PI / 4) * profile.shimmer;
  graded = graded.map((channel) => channel + shimmer);
  return [...graded.map((channel) => Math.round(clamp(channel) / 4) * 4), 255];
}

const profiles = [
  {
    id: "abyss",
    source: "deep",
    terrain: "deep-ocean",
    framesPerSecond: 3,
    base: [8, 39, 54, 255],
    multiply: [0.62, 0.66, 0.72], add: [0, 0, 2], contrast: 0.88, saturation: 0.9, shimmer: 1.2,
    motion: [2, 1], sampleStep: 4,
  },
  {
    id: "deep",
    source: "deep",
    terrain: "deep-ocean",
    framesPerSecond: 4,
    base: [11, 64, 82, 255],
    multiply: [0.78, 0.83, 0.88], add: [1, 2, 4], contrast: 0.94, saturation: 0.95, shimmer: 1.8,
    motion: [3, 1], sampleStep: 4,
  },
  {
    id: "coastal",
    source: "shallow",
    terrain: "shallow-ocean",
    framesPerSecond: 5,
    base: [74, 161, 160, 255],
    multiply: [0.56, 0.8, 0.96], add: [0, 0, 4], contrast: 0.86, saturation: 0.9, shimmer: 3.2,
    motion: [2, 2], sampleStep: 4,
  },
  {
    id: "lagoon",
    source: "shallow",
    terrain: "shallow-ocean",
    framesPerSecond: 4,
    base: [45, 133, 139, 255],
    multiply: [0.5, 0.68, 0.88], add: [0, 4, 10], contrast: 0.86, saturation: 0.92, shimmer: 2.4,
    motion: [1, 2], sampleStep: 4,
  },
  {
    id: "reef",
    source: "reef",
    terrain: "reef",
    framesPerSecond: 3,
    base: [57, 150, 150, 255],
    multiply: [0.7, 0.78, 0.8], add: [0, 1, 2], contrast: 0.78, saturation: 0.88, shimmer: 2.8,
    motion: [1, 1], sampleStep: 4,
  },
  {
    id: "current",
    source: "current",
    terrain: "visual-modifier",
    framesPerSecond: 7,
    base: [18, 83, 106, 255],
    multiply: [0.8, 0.86, 0.9], add: [0, 2, 4], contrast: 0.98, saturation: 0.96, shimmer: 2.2,
    motion: [7, 1], sampleStep: 4,
  },
  {
    id: "rough",
    source: "current",
    terrain: "visual-modifier",
    framesPerSecond: 7,
    base: [18, 74, 91, 255],
    multiply: [0.82, 0.86, 0.88], add: [1, 2, 3], contrast: 1.16, saturation: 0.82, shimmer: 4.2,
    motion: [6, 3], sampleStep: 4,
  },
  {
    id: "brackish",
    source: "reef",
    terrain: "shallow-ocean",
    framesPerSecond: 3,
    base: [47, 104, 91, 255],
    multiply: [0.66, 0.65, 0.5], add: [4, 8, 1], contrast: 0.86, saturation: 0.72, shimmer: 1.2,
    motion: [1, 1], sampleStep: 4,
  },
];

function canonicalTransitionMask(mask) {
  const north = (mask & 1) !== 0;
  const east = (mask & 2) !== 0;
  const south = (mask & 4) !== 0;
  const west = (mask & 8) !== 0;
  let canonical = mask & 15;
  if (north && east && (mask & 16)) canonical |= 16;
  if (east && south && (mask & 32)) canonical |= 32;
  if (south && west && (mask & 64)) canonical |= 64;
  if (west && north && (mask & 128)) canonical |= 128;
  return canonical;
}

const transitionMasks = [...new Set(Array.from({ length: 256 }, (_, mask) => canonicalTransitionMask(mask)))]
  .sort((left, right) => left - right);
if (transitionMasks.length !== 47) throw new Error(`Expected 47 canonical transition masks, received ${transitionMasks.length}`);

function makeTile(master, profile, profileIndex, variant, frame) {
  const pixels = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  const sampleSpan = TILE_SIZE * profile.sampleStep;
  const seed = hash32(0x57a7e2, profileIndex, variant);
  const originX = seed % Math.max(1, master.width - sampleSpan);
  const originY = (seed >>> 12) % Math.max(1, master.height - sampleSpan);
  const angle = frame / FRAME_COUNT * Math.PI * 2;
  const offsetX = Math.round(Math.sin(angle) * profile.motion[0]) * profile.sampleStep;
  const offsetY = Math.round(Math.cos(angle) * profile.motion[1]) * profile.sampleStep;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const source = pixel(master, originX + x * profile.sampleStep + offsetX, originY + y * profile.sampleStep + offsetY);
      setPixel(pixels, TILE_SIZE, x, y, gradeColor(source, profile, x, y, frame));
    }
  }
  return pixels;
}

function createEdgeTemplate(tile) {
  const horizontal = [];
  const vertical = [];
  for (let x = 0; x < TILE_SIZE; x++) {
    horizontal.push(mix(
      readPixel(tile, TILE_SIZE, x, 0),
      readPixel(tile, TILE_SIZE, x, TILE_SIZE - 1),
      0.5,
    ));
  }
  for (let y = 0; y < TILE_SIZE; y++) {
    vertical.push(mix(
      readPixel(tile, TILE_SIZE, 0, y),
      readPixel(tile, TILE_SIZE, TILE_SIZE - 1, y),
      0.5,
    ));
  }
  const corner = [horizontal[0], horizontal[TILE_SIZE - 1], vertical[0], vertical[TILE_SIZE - 1]]
    .reduce((sum, color) => sum.map((channel, index) => channel + color[index]), [0, 0, 0, 0])
    .map((channel) => channel / 4);
  horizontal[0] = horizontal[TILE_SIZE - 1] = corner;
  vertical[0] = vertical[TILE_SIZE - 1] = corner;
  return { horizontal, vertical };
}

function normalizeTileEdges(tile, template) {
  const normalized = Buffer.from(tile);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const distanceX = Math.min(x, TILE_SIZE - 1 - x);
      const distanceY = Math.min(y, TILE_SIZE - 1 - y);
      const distance = Math.min(distanceX, distanceY);
      if (distance > 1) continue;
      let target;
      if (distanceX === distanceY) target = mix(template.horizontal[x], template.vertical[y], 0.5);
      else target = distanceX < distanceY ? template.vertical[y] : template.horizontal[x];
      setPixel(
        normalized,
        TILE_SIZE,
        x,
        y,
        mix(readPixel(normalized, TILE_SIZE, x, y), target, distance === 0 ? 1 : 0.22),
      );
    }
  }
  return normalized;
}

function edgeSignature(tile) {
  const values = [];
  for (let index = 0; index < TILE_SIZE; index++) {
    values.push(...readPixel(tile, TILE_SIZE, 0, index));
    values.push(...readPixel(tile, TILE_SIZE, TILE_SIZE - 1, index));
    values.push(...readPixel(tile, TILE_SIZE, index, 0));
    values.push(...readPixel(tile, TILE_SIZE, index, TILE_SIZE - 1));
  }
  return Buffer.from(values);
}

function validateBaseEdges(sheet, width) {
  let checkedFrames = 0;
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const reference = extractTile(sheet, width, 0, profileIndex * VARIANT_COUNT * TILE_SIZE);
    const referenceSignature = edgeSignature(reference);
    for (let variant = 0; variant < VARIANT_COUNT; variant++) {
      for (let frame = 0; frame < FRAME_COUNT; frame++) {
        const tile = extractTile(
          sheet,
          width,
          frame * TILE_SIZE,
          (profileIndex * VARIANT_COUNT + variant) * TILE_SIZE,
        );
        if (!edgeSignature(tile).equals(referenceSignature)) {
          throw new Error(`Incompatible edge pixels for ${profiles[profileIndex].id} variant ${variant} frame ${frame}`);
        }
        for (let index = 0; index < TILE_SIZE; index++) {
          if (!Buffer.from(readPixel(tile, TILE_SIZE, 0, index)).equals(Buffer.from(readPixel(tile, TILE_SIZE, TILE_SIZE - 1, index)))) {
            throw new Error(`Horizontal seam mismatch for ${profiles[profileIndex].id} variant ${variant} frame ${frame}`);
          }
          if (!Buffer.from(readPixel(tile, TILE_SIZE, index, 0)).equals(Buffer.from(readPixel(tile, TILE_SIZE, index, TILE_SIZE - 1)))) {
            throw new Error(`Vertical seam mismatch for ${profiles[profileIndex].id} variant ${variant} frame ${frame}`);
          }
        }
        checkedFrames++;
      }
    }
  }
  return checkedFrames;
}

function meanLumaDelta(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 4) {
    const leftLuma = left[index] * 0.2126 + left[index + 1] * 0.7152 + left[index + 2] * 0.0722;
    const rightLuma = right[index] * 0.2126 + right[index + 1] * 0.7152 + right[index + 2] * 0.0722;
    total += Math.abs(leftLuma - rightLuma);
  }
  return total / (left.length / 4);
}

function validateBaseLoops(sheet, width) {
  let maximumWrapDelta = 0;
  let maximumStepDelta = 0;
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const frames = Array.from({ length: FRAME_COUNT }, (_, frame) => extractTile(
      sheet,
      width,
      frame * TILE_SIZE,
      profileIndex * VARIANT_COUNT * TILE_SIZE,
    ));
    for (let frame = 0; frame < FRAME_COUNT - 1; frame++) {
      maximumStepDelta = Math.max(maximumStepDelta, meanLumaDelta(frames[frame], frames[frame + 1]));
    }
    maximumWrapDelta = Math.max(maximumWrapDelta, meanLumaDelta(frames[FRAME_COUNT - 1], frames[0]));
  }
  if (maximumWrapDelta > maximumStepDelta * 1.5 + 1) {
    throw new Error(`Animation wrap delta ${maximumWrapDelta.toFixed(3)} exceeds normal step delta ${maximumStepDelta.toFixed(3)}`);
  }
  return {
    maximumStepLumaDelta: Number(maximumStepDelta.toFixed(3)),
    maximumWrapLumaDelta: Number(maximumWrapDelta.toFixed(3)),
  };
}

function validateTransparentRgb(pixels, label) {
  let transparentPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] !== 0) continue;
    transparentPixels++;
    if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) {
      throw new Error(`${label} contains nonzero RGB in a fully transparent pixel`);
    }
  }
  if (transparentPixels === 0) throw new Error(`${label} is expected to contain transparent pixels`);
  return transparentPixels;
}

function copyTile(tile, target, targetWidth, targetX, targetY) {
  for (let y = 0; y < TILE_SIZE; y++) {
    tile.copy(
      target,
      ((targetY + y) * targetWidth + targetX) * 4,
      y * TILE_SIZE * 4,
      (y + 1) * TILE_SIZE * 4,
    );
  }
}

function extractTile(sheet, sheetWidth, x, y) {
  const tile = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let row = 0; row < TILE_SIZE; row++) {
    sheet.copy(
      tile,
      row * TILE_SIZE * 4,
      ((y + row) * sheetWidth + x) * 4,
      ((y + row) * sheetWidth + x + TILE_SIZE) * 4,
    );
  }
  return tile;
}

function extrudeSheet(source, sourceWidth, columns, rows, frameWidth, frameHeight, gutter = 2) {
  const cellWidth = frameWidth + gutter * 2;
  const cellHeight = frameHeight + gutter * 2;
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const pixels = Buffer.alloc(width * height * 4);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const sourceLeft = column * frameWidth;
      const sourceTop = row * frameHeight;
      const targetLeft = column * cellWidth + gutter;
      const targetTop = row * cellHeight + gutter;
      for (let y = -gutter; y < frameHeight + gutter; y++) {
        for (let x = -gutter; x < frameWidth + gutter; x++) {
          const sourceX = sourceLeft + clamp(x, 0, frameWidth - 1);
          const sourceY = sourceTop + clamp(y, 0, frameHeight - 1);
          setPixel(
            pixels,
            width,
            targetLeft + x,
            targetTop + y,
            readPixel(source, sourceWidth, sourceX, sourceY),
          );
        }
      }
    }
  }
  return { width, height, pixels, margin: gutter, spacing: gutter * 2 };
}

function transitionWeight(mask, x, y) {
  if (mask === 0) return 0;
  if (mask === 255) return 1;
  const reach = 20;
  let weight = 0;
  if (mask & 1) weight = Math.max(weight, 1 - y / reach);
  if (mask & 2) weight = Math.max(weight, 1 - (TILE_SIZE - 1 - x) / reach);
  if (mask & 4) weight = Math.max(weight, 1 - (TILE_SIZE - 1 - y) / reach);
  if (mask & 8) weight = Math.max(weight, 1 - x / reach);
  const cornerReach = 28;
  if (mask & 16) weight = Math.max(weight, 1 - Math.hypot(TILE_SIZE - 1 - x, y) / cornerReach);
  if (mask & 32) weight = Math.max(weight, 1 - Math.hypot(TILE_SIZE - 1 - x, TILE_SIZE - 1 - y) / cornerReach);
  if (mask & 64) weight = Math.max(weight, 1 - Math.hypot(x, TILE_SIZE - 1 - y) / cornerReach);
  if (mask & 128) weight = Math.max(weight, 1 - Math.hypot(x, y) / cornerReach);
  const noise = (((x * 17 + y * 29 + mask * 13) % 11) - 5) / 55;
  return smoothstep(0.18, 0.82, weight + noise);
}

function buildTransitionTile(deepTile, shallowTile, mask) {
  const tile = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      setPixel(tile, TILE_SIZE, x, y, mix(
        readPixel(deepTile, TILE_SIZE, x, y),
        readPixel(shallowTile, TILE_SIZE, x, y),
        transitionWeight(mask, x, y),
      ));
    }
  }
  return tile;
}

function buildOverlayTile(baseTile, kind, frame) {
  const tile = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  const settings = {
    glint: { threshold: 88, strength: 2.2, color: [139, 208, 207], stride: 3 },
    caustic: { threshold: 150, strength: 2.0, color: [214, 229, 177], stride: 2 },
    current: { threshold: 100, strength: 2.7, color: [139, 208, 207], stride: 2 },
    whitecap: { threshold: 84, strength: 3.4, color: [220, 232, 210], stride: 1 },
  }[kind];
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const [r, g, b] = readPixel(baseTile, TILE_SIZE, x, y);
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const stagger = (x + y * 2 + frame) % settings.stride === 0 ? 1 : 0.55;
      const alpha = clamp((luma - settings.threshold) * settings.strength * stagger, 0, kind === "whitecap" ? 190 : 130);
      const roundedAlpha = Math.round(alpha);
      setPixel(tile, TILE_SIZE, x, y, roundedAlpha === 0 ? [0, 0, 0, 0] : [...settings.color, roundedAlpha]);
    }
  }
  return tile;
}

function buildHomeShoreOverlay(home) {
  const width = home.width * FRAME_COUNT;
  const height = home.height;
  const sheet = Buffer.alloc(width * height * 4);
  const alphaAt = (x, y) => {
    if (x < 0 || y < 0 || x >= home.width || y >= home.height) return 0;
    return home.pixels[(y * home.width + x) * 4 + 3];
  };
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const phase = frame / FRAME_COUNT * Math.PI * 2;
    for (let y = 0; y < home.height; y++) {
      for (let x = 0; x < home.width; x++) {
        const [r, g, b, sourceAlpha] = pixel(home, x, y);
        const waterLike = sourceAlpha > 16 && b > r + 10 && g > r + 18 && b > 70 && g > 90;
        if (!waterLike) continue;
        const nearOuterEdge = [
          alphaAt(x - 3, y), alphaAt(x + 3, y), alphaAt(x, y - 3), alphaAt(x, y + 3),
        ].some((alpha) => alpha < 16);
        const ripple = Math.sin(x * 0.17 + y * 0.11 + phase) * 0.5 + 0.5;
        const crossRipple = Math.sin(x * 0.07 - y * 0.13 - phase * 0.72) * 0.5 + 0.5;
        const sparse = hash32(Math.floor((x + frame * 3) / 3), Math.floor(y / 2), 0x5f0a) % 11;
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        let alpha = nearOuterEdge
          ? 30 + ripple * 58
          : sparse < 3 ? Math.max(0, ripple * crossRipple - 0.46) * (48 + luma * 0.18) : 0;
        alpha *= sourceAlpha / 255;
        const color = nearOuterEdge ? [169, 214, 173] : [139, 208, 207];
        alpha = Math.round(clamp(alpha, 0, 104));
        setPixel(sheet, width, frame * home.width + x, y, alpha === 0 ? [0, 0, 0, 0] : [...color, alpha]);
      }
    }
  }
  return { width, height, pixels: sheet };
}

const HOME_DEPTH_PALETTE = Object.freeze([
  [110, 202, 190, 255],
  [87, 190, 184, 255],
  [68, 176, 179, 255],
  [51, 156, 168, 255],
  [38, 136, 154, 255],
  [28, 116, 138, 255],
  [20, 94, 118, 255],
  [12, 67, 88, 255],
]);

function angularLobe(angle, center, width) {
  const delta = Math.atan2(Math.sin(angle - center), Math.cos(angle - center));
  return Math.exp(-0.5 * (delta / width) ** 2);
}

function homeShelfRadii(angle) {
  const east = angularLobe(angle, 0, 0.72);
  const southEast = angularLobe(angle, Math.PI * 0.28, 0.5);
  const south = angularLobe(angle, Math.PI / 2, 0.7);
  const southWest = angularLobe(angle, Math.PI * 0.72, 0.48);
  const northWest = angularLobe(angle, -Math.PI * 0.72, 0.5);
  const inner = 198
    + east * 11
    + south * 7
    + Math.sin(angle * 3 + 0.45) * 5
    + Math.sin(angle * 7 - 0.8) * 3;
  const outer = clamp(
    250
      + east * 58
      + southEast * 18
      + south * 65
      + southWest * 25
      - northWest * 11
      + Math.sin(angle * 4 + 0.3) * 7
      + Math.sin(angle * 9 - 0.6) * 4,
    241,
    338,
  );
  return { inner, outer };
}

function irregularEllipse(dx, dy, centerX, centerY, radiusX, radiusY, seed) {
  const localX = (dx - centerX) / radiusX;
  const localY = (dy - centerY) / radiusY;
  const warp = Math.sin((dx + seed) * 0.052 + dy * 0.019) * 0.08
    + Math.sin(dx * 0.017 - (dy - seed) * 0.061) * 0.055;
  return 1 - smoothstep(0.56, 1.04, Math.hypot(localX, localY) + warp);
}

function crescentStrength(dx, dy, centerX, centerY, radiusX, radiusY, cutX, cutY) {
  const outer = irregularEllipse(dx, dy, centerX, centerY, radiusX, radiusY, 37);
  const cut = irregularEllipse(dx, dy, centerX + cutX, centerY + cutY, radiusX * 0.78, radiusY * 0.78, 83);
  return clamp(outer - cut * 0.94, 0, 1);
}

function homeDepthAt(dx, dy) {
  const radius = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const { inner, outer } = homeShelfRadii(angle);
  const macroWarp = Math.sin(dx * 0.016 + Math.sin(dy * 0.009) * 1.7) * 8
    + Math.sin(dy * 0.013 - dx * 0.006) * 6
    + Math.sin((dx + dy) * 0.007) * 5;
  const normalizedDepth = clamp((radius + macroWarp - inner) / Math.max(1, outer - inner), 0, 1);
  let depth = normalizedDepth ** 0.78;

  // The east harbor opens through a darker, gently winding navigation channel.
  const channelCenterY = 4
    + Math.sin((dx - 125) * 0.027) * 14
    + Math.sin((dx - 60) * 0.009) * 6
    + Math.max(0, dx - 185) * 0.12;
  const channelWidth = 9 + smoothstep(185, 350, dx) * 9;
  const channel = (1 - smoothstep(channelWidth * 0.46, channelWidth, Math.abs(dy - channelCenterY)))
    * smoothstep(180, 225, dx)
    * (1 - smoothstep(365, 410, dx));
  depth += channel * (0.11 + smoothstep(220, 350, dx) * 0.08);

  // Detached darker substrate patches keep the shelf from reading as a ring.
  depth += irregularEllipse(dx, dy, -208, 156, 58, 37, 19) * 0.27;
  depth += irregularEllipse(dx, dy, 178, 174, 63, 41, 41) * 0.29;
  depth += irregularEllipse(dx, dy, 244, 78, 43, 30, 67) * 0.23;
  depth += irregularEllipse(dx, dy, -80, 254, 55, 31, 101) * 0.22;
  depth += irregularEllipse(dx, dy, -239, 28, 35, 78, 131) * 0.16;
  depth += irregularEllipse(dx, dy, 18, -246, 76, 29, 157) * 0.17;

  // Two offset sandy crescents echo the selected concept without outlining it.
  depth -= crescentStrength(dx, dy, 145, 222, 61, 27, 20, -7) * 0.22;
  depth -= crescentStrength(dx, dy, -175, 205, 55, 25, -18, -6) * 0.18;
  const shelfMottle = Math.sin(dx * 0.031 + dy * 0.017) * 0.024
    + Math.sin(dx * 0.014 - dy * 0.037 + 0.8) * 0.019;
  depth += shelfMottle * smoothstep(0.04, 0.3, depth) * (1 - smoothstep(0.78, 0.98, depth));
  return clamp(depth, 0, 1);
}

function paletteColor(depth) {
  const scaled = clamp(depth, 0, 1) * (HOME_DEPTH_PALETTE.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(HOME_DEPTH_PALETTE.length - 1, left + 1);
  return mix(HOME_DEPTH_PALETTE[left], HOME_DEPTH_PALETTE[right], scaled - left);
}

function buildHomeDepthHandoff(masters) {
  const frameSize = HOME_HANDOFF_FRAME_SIZE;
  const width = frameSize * HOME_HANDOFF_COLUMNS;
  const height = frameSize * HOME_HANDOFF_ROWS;
  const center = frameSize / 2;
  const sheet = Buffer.alloc(width * height * 4);
  const baseFrame = Buffer.alloc(frameSize * frameSize * 4);
  const rawDepthByPixel = new Uint8Array(frameSize * frameSize);
  const deepProfile = profiles.find(({ id }) => id === "deep");
  const coastalProfile = profiles.find(({ id }) => id === "coastal");
  if (!deepProfile || !coastalProfile) throw new Error("Deep and coastal profiles are required for the home depth handoff");

  for (let y = 0; y < frameSize; y++) {
    for (let x = 0; x < frameSize; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const radius = Math.hypot(dx, dy);
      const edgeWarp = Math.sin(Math.atan2(dy, dx) * 5 + 0.8) * 7
        + Math.sin(dx * 0.021 - dy * 0.014) * 5
        + Math.sin(dy * 0.075 + Math.sin(dx * 0.02)) * 4
        + Math.sin((dx + dy) * 0.045) * 2
        + Math.sin(dy * 0.18 + dx * 0.025) * 3;
      let edgeOpacity = 1 - smoothstep(356 + edgeWarp * 0.35, 393 + edgeWarp * 0.55, radius);
      if (x < 2 || y < 2 || x >= frameSize - 2 || y >= frameSize - 2) edgeOpacity = 0;
      const rawDepth = homeDepthAt(dx, dy);
      const stencilCover = 1 - smoothstep(258, 292, radius + edgeWarp * 0.9);
      const shelfCover = 1 - smoothstep(0.78, 0.995, rawDepth);
      let opacity = edgeOpacity * Math.max(stencilCover, shelfCover);
      opacity = Math.round(clamp(opacity, 0, 1) * 31) / 31;
      if (opacity === 0) {
        setPixel(baseFrame, frameSize, x, y, [0, 0, 0, 0]);
        continue;
      }

      rawDepthByPixel[y * frameSize + x] = Math.round(rawDepth * 255);
      const clusterX = Math.floor(x / 3);
      const clusterY = Math.floor(y / 3);
      const dither = ((hash32(clusterX, clusterY, 0x5a17) & 1023) / 1023 - 0.5) * 0.075;
      const depth = Math.round(clamp(rawDepth + dither, 0, 1) * 12) / 12;
      const sampleX = Math.floor(x / 2) * 5;
      const sampleY = Math.floor(y / 2) * 5;
      const deep = gradeColor(
        pixel(masters.deep, sampleX, sampleY),
        deepProfile,
        Math.floor(x / 2),
        Math.floor(y / 2),
        0,
      );
      const coastal = gradeColor(
        pixel(masters.shallow, sampleX, sampleY),
        coastalProfile,
        Math.floor(x / 2),
        Math.floor(y / 2),
        0,
      );
      const material = mix(coastal, deep, rawDepth);
      let color = mix(paletteColor(depth), material, 0.58);
      color = mix(color, deep, smoothstep(0.82, 0.98, rawDepth));
      setPixel(baseFrame, frameSize, x, y, [color[0], color[1], color[2], opacity * 255]);
    }
  }

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const frameColumn = frame % HOME_HANDOFF_COLUMNS;
    const frameRow = Math.floor(frame / HOME_HANDOFF_COLUMNS);
    for (let y = 0; y < frameSize; y++) {
      baseFrame.copy(
        sheet,
        ((frameRow * frameSize + y) * width + frameColumn * frameSize) * 4,
        y * frameSize * 4,
        (y + 1) * frameSize * 4,
      );
    }
    const phase = frame / FRAME_COUNT * Math.PI * 2;
    for (let y = 0; y < frameSize; y += 2) {
      for (let x = 0; x < frameSize; x += 2) {
        const rawDepth = rawDepthByPixel[y * frameSize + x] / 255;
        if (rawDepth >= 0.94) continue;
        const ripple = Math.sin(x * 0.115 + y * 0.071 + phase)
          * Math.sin(x * 0.041 - y * 0.127 - phase * 0.7);
        const causticGate = (hash32(Math.floor(x / 4), Math.floor(y / 3), 0xc451) & 7) < 3 ? 1 : 0;
        const caustic = Math.max(0, ripple - 0.42) * causticGate * (1 - rawDepth) * 13;
        if (caustic <= 0) continue;
        for (let offsetY = 0; offsetY < 2; offsetY++) {
          for (let offsetX = 0; offsetX < 2; offsetX++) {
            const targetX = frameColumn * frameSize + x + offsetX;
            const targetY = frameRow * frameSize + y + offsetY;
            const index = (targetY * width + targetX) * 4;
            if (sheet[index + 3] === 0) continue;
            sheet[index] = clamp(sheet[index] + caustic);
            sheet[index + 1] = clamp(sheet[index + 1] + caustic);
            sheet[index + 2] = clamp(sheet[index + 2] + caustic);
          }
        }
      }
    }
  }
  return { width, height, pixels: sheet };
}

function validateHomeDepthHandoff(handoff) {
  const alphaLevels = new Set();
  const lumaBands = new Set();
  const leftBoundaries = [];
  for (let y = 0; y < HOME_HANDOFF_FRAME_SIZE; y++) {
    let left = -1;
    for (let x = 0; x < HOME_HANDOFF_FRAME_SIZE; x++) {
      const [r, g, b, alpha] = readPixel(handoff.pixels, handoff.width, x, y);
      alphaLevels.add(alpha);
      if (alpha >= 220) lumaBands.add(Math.round((r * 0.2126 + g * 0.7152 + b * 0.0722) / 10));
      if (left < 0 && alpha > 8) left = x;
      if ((x < 2 || y < 2 || x >= HOME_HANDOFF_FRAME_SIZE - 2 || y >= HOME_HANDOFF_FRAME_SIZE - 2) && alpha !== 0) {
        throw new Error("Home depth handoff must have a fully transparent two-pixel perimeter");
      }
    }
    if (left >= 0) leftBoundaries.push(left);
  }
  let maximumAxisRun = 0;
  let currentRun = 0;
  let previous;
  for (const boundary of leftBoundaries) {
    currentRun = boundary === previous ? currentRun + 1 : 1;
    maximumAxisRun = Math.max(maximumAxisRun, currentRun);
    previous = boundary;
  }
  const shelfWidths = Array.from({ length: 64 }, (_, index) => {
    const { inner, outer } = homeShelfRadii(index / 64 * Math.PI * 2 - Math.PI);
    return outer - inner;
  });
  const minimumShelfWidth = Math.min(...shelfWidths);
  const maximumShelfWidth = Math.max(...shelfWidths);
  const shelfWidthRatio = maximumShelfWidth / minimumShelfWidth;
  if (alphaLevels.size < 24) throw new Error(`Home depth handoff needs a gradual alpha ramp; found ${alphaLevels.size} levels`);
  if (lumaBands.size < 10) throw new Error(`Home depth handoff needs broad color depth; found ${lumaBands.size} luma bands`);
  if (maximumAxisRun >= TILE_SIZE) throw new Error(`Home depth handoff outer contour has a ${maximumAxisRun}px axis-aligned run`);
  if (shelfWidthRatio < 3) throw new Error(`Home depth handoff shelf-width ratio ${shelfWidthRatio.toFixed(2)} is below 3:1`);
  return {
    alphaLevels: alphaLevels.size,
    lumaBands: lumaBands.size,
    maximumAxisRun,
    minimumShelfWidth: Number(minimumShelfWidth.toFixed(2)),
    maximumShelfWidth: Number(maximumShelfWidth.toFixed(2)),
    shelfWidthRatio: Number(shelfWidthRatio.toFixed(2)),
  };
}

async function writePng(filename, width, height, pixels) {
  await writeFile(path.join(runtimeRoot, filename), encodePng(width, height, pixels));
}

async function sha256(filename) {
  const buffer = await readFile(path.join(runtimeRoot, filename));
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const masters = {};
  for (const id of ["deep", "shallow", "reef", "current"]) {
    const filename = path.join(sourceRoot, `water-${id}-master.png`);
    masters[id] = decodePng(await readFile(filename), filename);
  }
  await mkdir(runtimeRoot, { recursive: true });

  const sheetWidth = TILE_SIZE * FRAME_COUNT;
  const sheetHeight = TILE_SIZE * VARIANT_COUNT * profiles.length;
  const tileSheet = Buffer.alloc(sheetWidth * sheetHeight * 4);
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const profile = profiles[profileIndex];
    const rawTiles = [];
    for (let variant = 0; variant < VARIANT_COUNT; variant++) {
      for (let frame = 0; frame < FRAME_COUNT; frame++) {
        rawTiles.push(makeTile(masters[profile.source], profile, profileIndex, variant, frame));
      }
    }
    const edgeTemplate = createEdgeTemplate(rawTiles[0]);
    for (let variant = 0; variant < VARIANT_COUNT; variant++) {
      for (let frame = 0; frame < FRAME_COUNT; frame++) {
        const tile = normalizeTileEdges(rawTiles[variant * FRAME_COUNT + frame], edgeTemplate);
        copyTile(tile, tileSheet, sheetWidth, frame * TILE_SIZE, (profileIndex * VARIANT_COUNT + variant) * TILE_SIZE);
      }
    }
  }
  const checkedBaseFrames = validateBaseEdges(tileSheet, sheetWidth);
  const loopValidation = validateBaseLoops(tileSheet, sheetWidth);
  const runtimeTiles = extrudeSheet(tileSheet, sheetWidth, FRAME_COUNT, profiles.length * VARIANT_COUNT, TILE_SIZE, TILE_SIZE);
  await writePng("water-tiles.png", runtimeTiles.width, runtimeTiles.height, runtimeTiles.pixels);

  const staticWidth = TILE_SIZE * VARIANT_COUNT;
  const staticHeight = TILE_SIZE * profiles.length;
  const staticSheet = Buffer.alloc(staticWidth * staticHeight * 4);
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    for (let variant = 0; variant < VARIANT_COUNT; variant++) {
      const sourceY = (profileIndex * VARIANT_COUNT + variant) * TILE_SIZE;
      const tile = extractTile(tileSheet, sheetWidth, 0, sourceY);
      copyTile(tile, staticSheet, staticWidth, variant * TILE_SIZE, profileIndex * TILE_SIZE);
    }
  }
  const runtimeStatic = extrudeSheet(staticSheet, staticWidth, VARIANT_COUNT, profiles.length, TILE_SIZE, TILE_SIZE);
  await writePng("water-static.png", runtimeStatic.width, runtimeStatic.height, runtimeStatic.pixels);

  const transitionWidth = TILE_SIZE * transitionMasks.length;
  const transitionHeight = TILE_SIZE * TRANSITION_FRAME_COUNT;
  const transitionSheet = Buffer.alloc(transitionWidth * transitionHeight * 4);
  const deepRow = profiles.findIndex(({ id }) => id === "deep") * VARIANT_COUNT;
  const coastalRow = profiles.findIndex(({ id }) => id === "coastal") * VARIANT_COUNT;
  for (let phase = 0; phase < TRANSITION_FRAME_COUNT; phase++) {
    const frame = phase * 2;
    const deepTile = extractTile(tileSheet, sheetWidth, frame * TILE_SIZE, deepRow * TILE_SIZE);
    const shallowTile = extractTile(tileSheet, sheetWidth, frame * TILE_SIZE, coastalRow * TILE_SIZE);
    for (let maskIndex = 0; maskIndex < transitionMasks.length; maskIndex++) {
      copyTile(
        buildTransitionTile(deepTile, shallowTile, transitionMasks[maskIndex]),
        transitionSheet,
        transitionWidth,
        maskIndex * TILE_SIZE,
        phase * TILE_SIZE,
      );
    }
  }
  const runtimeTransitions = extrudeSheet(
    transitionSheet,
    transitionWidth,
    transitionMasks.length,
    TRANSITION_FRAME_COUNT,
    TILE_SIZE,
    TILE_SIZE,
  );
  await writePng("water-depth-transitions.png", runtimeTransitions.width, runtimeTransitions.height, runtimeTransitions.pixels);

  const overlayKinds = ["glint", "caustic", "current", "whitecap"];
  const overlayHeight = TILE_SIZE * overlayKinds.length;
  const overlaySheet = Buffer.alloc(sheetWidth * overlayHeight * 4);
  const overlayProfiles = ["deep", "coastal", "current", "rough"];
  for (let kindIndex = 0; kindIndex < overlayKinds.length; kindIndex++) {
    const profileIndex = profiles.findIndex(({ id }) => id === overlayProfiles[kindIndex]);
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      const base = extractTile(tileSheet, sheetWidth, frame * TILE_SIZE, profileIndex * VARIANT_COUNT * TILE_SIZE);
      const overlay = buildOverlayTile(base, overlayKinds[kindIndex], frame);
      copyTile(overlay, overlaySheet, sheetWidth, frame * TILE_SIZE, kindIndex * TILE_SIZE);
    }
  }
  const transparentOverlayPixels = validateTransparentRgb(overlaySheet, "water-overlays");
  const runtimeOverlays = extrudeSheet(overlaySheet, sheetWidth, FRAME_COUNT, overlayKinds.length, TILE_SIZE, TILE_SIZE);
  await writePng("water-overlays.png", runtimeOverlays.width, runtimeOverlays.height, runtimeOverlays.pixels);

  const contactWidth = TILE_SIZE * 16;
  const contactHeight = TILE_SIZE * 8;
  const contact = Buffer.alloc(contactWidth * contactHeight * 4);
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const panelX = (profileIndex % 4) * TILE_SIZE * 4;
    const panelY = Math.floor(profileIndex / 4) * TILE_SIZE * 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const variant = (x + y * 3) % VARIANT_COUNT;
        const frame = (x * 2 + y + profileIndex) % FRAME_COUNT;
        const sourceY = (profileIndex * VARIANT_COUNT + variant) * TILE_SIZE;
        const tile = extractTile(tileSheet, sheetWidth, frame * TILE_SIZE, sourceY);
        copyTile(tile, contact, contactWidth, panelX + x * TILE_SIZE, panelY + y * TILE_SIZE);
      }
    }
  }
  await writePng("water-contact-sheet.png", contactWidth, contactHeight, contact);

  const homePath = path.join(repositoryRoot, "public", "assets", "gr1", "images", "home-island.png");
  const home = decodePng(await readFile(homePath), homePath);
  if (home.width !== HOME_ISLAND_FRAME_SIZE || home.height !== HOME_ISLAND_FRAME_SIZE) {
    throw new RangeError(`Home island must be ${HOME_ISLAND_FRAME_SIZE}x${HOME_ISLAND_FRAME_SIZE}`);
  }
  const homeHandoff = buildHomeDepthHandoff(masters);
  const transparentHomeHandoffPixels = validateTransparentRgb(homeHandoff.pixels, "water-home-depth-handoff");
  const homeHandoffValidation = validateHomeDepthHandoff(homeHandoff);
  const runtimeHomeHandoff = extrudeSheet(
    homeHandoff.pixels,
    homeHandoff.width,
    HOME_HANDOFF_COLUMNS,
    HOME_HANDOFF_ROWS,
    HOME_HANDOFF_FRAME_SIZE,
    HOME_HANDOFF_FRAME_SIZE,
  );
  await writePng(
    "water-home-depth-handoff.png",
    runtimeHomeHandoff.width,
    runtimeHomeHandoff.height,
    runtimeHomeHandoff.pixels,
  );
  const homeOverlay = buildHomeShoreOverlay(home);
  const transparentHomeOverlayPixels = validateTransparentRgb(homeOverlay.pixels, "water-home-shore-overlay");
  const runtimeHomeOverlay = extrudeSheet(homeOverlay.pixels, homeOverlay.width, FRAME_COUNT, 1, home.width, home.height);
  await writePng(
    "water-home-shore-overlay.png",
    runtimeHomeOverlay.width,
    runtimeHomeOverlay.height,
    runtimeHomeOverlay.pixels,
  );

  const previewSize = 960;
  const preview = Buffer.alloc(previewSize * previewSize * 4);
  const gridSize = previewSize / TILE_SIZE;
  const isPreviewShallow = () => false;
  for (let tileY = 0; tileY < gridSize; tileY++) {
    for (let tileX = 0; tileX < gridSize; tileX++) {
      const shallow = isPreviewShallow(tileX, tileY);
      const profileId = shallow ? "coastal" : "deep";
      const profileIndex = profiles.findIndex(({ id }) => id === profileId);
      const variant = hash32(tileX, tileY, 0x1a11) % VARIANT_COUNT;
      const sourceY = (profileIndex * VARIANT_COUNT + variant) * TILE_SIZE;
      let tile = extractTile(tileSheet, sheetWidth, 0, sourceY);
      if (!shallow) {
        let mask = 0;
        if (isPreviewShallow(tileX, tileY - 1)) mask |= 1;
        if (isPreviewShallow(tileX + 1, tileY)) mask |= 2;
        if (isPreviewShallow(tileX, tileY + 1)) mask |= 4;
        if (isPreviewShallow(tileX - 1, tileY)) mask |= 8;
        if (isPreviewShallow(tileX + 1, tileY - 1)) mask |= 16;
        if (isPreviewShallow(tileX + 1, tileY + 1)) mask |= 32;
        if (isPreviewShallow(tileX - 1, tileY + 1)) mask |= 64;
        if (isPreviewShallow(tileX - 1, tileY - 1)) mask |= 128;
        mask = canonicalTransitionMask(mask);
        const maskIndex = transitionMasks.indexOf(mask);
        if (maskIndex > 0) tile = extractTile(transitionSheet, transitionWidth, maskIndex * TILE_SIZE, 0);
      }
      copyTile(tile, preview, previewSize, tileX * TILE_SIZE, tileY * TILE_SIZE);
    }
  }
  const homeX = Math.floor((previewSize - home.width) / 2);
  const homeY = Math.floor((previewSize - home.height) / 2);
  const homeHandoffX = homeX - HOME_HANDOFF_MARGIN;
  const homeHandoffY = homeY - HOME_HANDOFF_MARGIN;
  for (let y = 0; y < HOME_HANDOFF_FRAME_SIZE; y++) {
    for (let x = 0; x < HOME_HANDOFF_FRAME_SIZE; x++) {
      const foreground = readPixel(homeHandoff.pixels, homeHandoff.width, x, y);
      if (foreground[3] === 0) continue;
      const background = readPixel(preview, previewSize, homeHandoffX + x, homeHandoffY + y);
      const alpha = foreground[3] / 255;
      setPixel(preview, previewSize, homeHandoffX + x, homeHandoffY + y, [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha),
        255,
      ]);
    }
  }
  for (let y = 0; y < home.height; y++) {
    for (let x = 0; x < home.width; x++) {
      const foreground = pixel(home, x, y);
      if (foreground[3] === 0) continue;
      const background = readPixel(preview, previewSize, homeX + x, homeY + y);
      const alpha = foreground[3] / 255;
      setPixel(preview, previewSize, homeX + x, homeY + y, [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha),
        255,
      ]);
    }
  }
  for (let y = 0; y < homeOverlay.height; y++) {
    for (let x = 0; x < home.width; x++) {
      const foreground = readPixel(homeOverlay.pixels, homeOverlay.width, x, y);
      if (foreground[3] === 0) continue;
      const background = readPixel(preview, previewSize, homeX + x, homeY + y);
      const alpha = foreground[3] / 255;
      setPixel(preview, previewSize, homeX + x, homeY + y, [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha),
        255,
      ]);
    }
  }
  await writePng("water-home-island-preview.png", previewSize, previewSize, preview);

  const outputs = [
    ["water-tiles.png", runtimeTiles.width, runtimeTiles.height],
    ["water-static.png", runtimeStatic.width, runtimeStatic.height],
    ["water-depth-transitions.png", runtimeTransitions.width, runtimeTransitions.height],
    ["water-overlays.png", runtimeOverlays.width, runtimeOverlays.height],
    ["water-home-depth-handoff.png", runtimeHomeHandoff.width, runtimeHomeHandoff.height],
    ["water-home-shore-overlay.png", runtimeHomeOverlay.width, runtimeHomeOverlay.height],
    ["water-contact-sheet.png", contactWidth, contactHeight],
    ["water-home-island-preview.png", previewSize, previewSize],
  ];
  const report = {
    version: 1,
    generatedAt: "deterministic-local-build",
    tileSize: TILE_SIZE,
    frameCount: FRAME_COUNT,
    variantCount: VARIANT_COUNT,
    transitionMasks,
    validation: {
      checkedBaseFrames,
      ...loopValidation,
      transparentOverlayPixels,
      transparentHomeHandoffPixels,
      homeHandoff: homeHandoffValidation,
      transparentHomeOverlayPixels,
    },
    profiles: profiles.map(({ id, source, terrain, framesPerSecond }) => ({ id, source, terrain, framesPerSecond })),
    outputs: await Promise.all(outputs.map(async ([filename, width, height]) => ({
      filename,
      width,
      height,
      sha256: await sha256(filename),
    }))),
  };
  await writeFile(path.join(runtimeRoot, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
