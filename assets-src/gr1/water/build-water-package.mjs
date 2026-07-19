import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const TILE_SIZE = 32;
const FRAME_COUNT = 8;
const VARIANT_COUNT = 4;
const TRANSITION_FRAME_COUNT = 4;

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(root, "source");
const runtimeRoot = path.join(root, "runtime");

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

  const outputs = [
    ["water-tiles.png", runtimeTiles.width, runtimeTiles.height],
    ["water-static.png", runtimeStatic.width, runtimeStatic.height],
    ["water-depth-transitions.png", runtimeTransitions.width, runtimeTransitions.height],
    ["water-overlays.png", runtimeOverlays.width, runtimeOverlays.height],
    ["water-contact-sheet.png", contactWidth, contactHeight],
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
