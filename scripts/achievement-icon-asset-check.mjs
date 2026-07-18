import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const SHEET_WIDTH = 2_048;
const SHEET_HEIGHT = 1_280;
const FRAME_SIZE = 128;
const FRAME_COLUMNS = 16;
const FRAME_ROWS = 10;
const VISIBLE_ALPHA_THRESHOLD = 8;
const TRANSPARENT_CORNER_SIZE = 4;
const MAX_CENTROID_DRIFT_PX = 4;
const MAX_BOUND_EDGE_DRIFT_PX = 8;
const MIN_UNIQUE_FRAMES_PER_ROW = 4;
const MIN_ANIMATED_STEP_DELTA = 0.1;
const MAX_ADJACENT_FRAME_DELTA = 12;
const LOOP_DELTA_MULTIPLIER = 1.5;
const LOOP_DELTA_TOLERANCE = 1;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(
  root,
  "public",
  "assets",
  "gr5",
  "achievement-icons",
  "achievement-icon-sprites.png",
);

function pngHeader(buffer, label) {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new RangeError(`${label} is not a PNG file`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
}

function decodeRgba(buffer, header, label) {
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new RangeError(`${label} must be a non-interlaced 8-bit RGBA PNG`);
  }

  const chunks = [];
  let foundEnd = false;
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) throw new RangeError(`${label} has a truncated PNG chunk`);
    const length = buffer.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > buffer.length) throw new RangeError(`${label} has a truncated PNG chunk payload`);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") {
      foundEnd = true;
      break;
    }
    offset = end;
  }
  if (chunks.length === 0 || !foundEnd) throw new RangeError(`${label} has an incomplete PNG data stream`);

  const scanlines = inflateSync(Buffer.concat(chunks));
  const stride = header.width * 4;
  const expectedLength = header.height * (stride + 1);
  if (scanlines.length !== expectedLength) {
    throw new RangeError(
      `${label} decoded to ${scanlines.length} scanline bytes; expected ${expectedLength}`,
    );
  }

  const pixels = Buffer.alloc(header.height * stride);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y++) {
    const rowOffset = y * (stride + 1);
    const filter = scanlines[rowOffset];
    for (let index = 0; index < stride; index++) {
      const source = scanlines[rowOffset + index + 1];
      const left = index >= 4 ? current[index - 4] : 0;
      const above = previous[index];
      const upperLeft = index >= 4 ? previous[index - 4] : 0;
      if (filter === 0) current[index] = source;
      else if (filter === 1) current[index] = (source + left) & 0xff;
      else if (filter === 2) current[index] = (source + above) & 0xff;
      else if (filter === 3) current[index] = (source + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const prediction = left + above - upperLeft;
        const leftDistance = Math.abs(prediction - left);
        const aboveDistance = Math.abs(prediction - above);
        const upperLeftDistance = Math.abs(prediction - upperLeft);
        const paeth = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft;
        current[index] = (source + paeth) & 0xff;
      } else throw new RangeError(`${label} uses unsupported PNG filter ${filter}`);
    }
    current.copy(pixels, y * stride);
    current.copy(previous);
  }
  return pixels;
}

function extractFrame(pixels, row, column) {
  const frame = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 4);
  const sheetStride = SHEET_WIDTH * 4;
  const frameStride = FRAME_SIZE * 4;
  const sourceX = column * FRAME_SIZE * 4;
  const sourceY = row * FRAME_SIZE;
  for (let y = 0; y < FRAME_SIZE; y++) {
    const sourceOffset = (sourceY + y) * sheetStride + sourceX;
    pixels.copy(frame, y * frameStride, sourceOffset, sourceOffset + frameStride);
  }
  return frame;
}

function alphaAt(frame, x, y) {
  return frame[(y * FRAME_SIZE + x) * 4 + 3];
}

function assertTransparentCorners(frame, label) {
  const cornerOrigins = [
    [0, 0],
    [FRAME_SIZE - TRANSPARENT_CORNER_SIZE, 0],
    [0, FRAME_SIZE - TRANSPARENT_CORNER_SIZE],
    [FRAME_SIZE - TRANSPARENT_CORNER_SIZE, FRAME_SIZE - TRANSPARENT_CORNER_SIZE],
  ];
  for (const [originX, originY] of cornerOrigins) {
    for (let y = originY; y < originY + TRANSPARENT_CORNER_SIZE; y++) {
      for (let x = originX; x < originX + TRANSPARENT_CORNER_SIZE; x++) {
        if (alphaAt(frame, x, y) !== 0) {
          throw new RangeError(`${label} must keep all four ${TRANSPARENT_CORNER_SIZE}px corners transparent`);
        }
      }
    }
  }
}

function frameStats(frame, label) {
  let alphaWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let visiblePixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      const alpha = alphaAt(frame, x, y);
      if (alpha > 0) {
        alphaWeight += alpha;
        weightedX += x * alpha;
        weightedY += y * alpha;
      }
      if (alpha >= VISIBLE_ALPHA_THRESHOLD) {
        visiblePixels++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (alphaWeight === 0 || visiblePixels === 0) throw new RangeError(`${label} has no visible pixels`);
  assertTransparentCorners(frame, label);
  return {
    centroidX: weightedX / alphaWeight,
    centroidY: weightedY / alphaWeight,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function validateSubtleDrift(stats, row) {
  const centroidXDrift = range(stats.map(({ centroidX }) => centroidX));
  const centroidYDrift = range(stats.map(({ centroidY }) => centroidY));
  if (centroidXDrift > MAX_CENTROID_DRIFT_PX || centroidYDrift > MAX_CENTROID_DRIFT_PX) {
    throw new RangeError(
      `Achievement icon row ${row} alpha centroid drifts ${centroidXDrift.toFixed(2)}px × `
      + `${centroidYDrift.toFixed(2)}px; subtle motion permits at most ${MAX_CENTROID_DRIFT_PX}px per axis`,
    );
  }

  for (const edge of ["minX", "minY", "maxX", "maxY"]) {
    const edgeDrift = range(stats.map((entry) => entry[edge]));
    if (edgeDrift > MAX_BOUND_EDGE_DRIFT_PX) {
      throw new RangeError(
        `Achievement icon row ${row} ${edge} drifts ${edgeDrift}px; `
        + `subtle motion permits at most ${MAX_BOUND_EDGE_DRIFT_PX}px`,
      );
    }
  }
}

function meanVisualDelta(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 4) {
    const leftAlpha = left[index + 3];
    const rightAlpha = right[index + 3];
    const leftLuma = (left[index] * 0.2126 + left[index + 1] * 0.7152 + left[index + 2] * 0.0722)
      * leftAlpha / 255;
    const rightLuma = (right[index] * 0.2126 + right[index + 1] * 0.7152 + right[index + 2] * 0.0722)
      * rightAlpha / 255;
    total += Math.abs(leftLuma - rightLuma) * 0.8 + Math.abs(leftAlpha - rightAlpha) * 0.2;
  }
  return total / (left.length / 4);
}

function visibleContentHash(frame) {
  const normalized = Buffer.from(frame);
  for (let index = 0; index < normalized.length; index += 4) {
    if (normalized[index + 3] !== 0) continue;
    normalized[index] = 0;
    normalized[index + 1] = 0;
    normalized[index + 2] = 0;
  }
  return createHash("sha256").update(normalized).digest("hex");
}

function validateLoop(frames, row) {
  const uniqueFrames = new Set(frames.map(visibleContentHash)).size;
  if (uniqueFrames < MIN_UNIQUE_FRAMES_PER_ROW) {
    throw new RangeError(
      `Achievement icon row ${row} has ${uniqueFrames} unique visible frames; `
      + `expected at least ${MIN_UNIQUE_FRAMES_PER_ROW} to prove it is animated`,
    );
  }

  let maximumStepDelta = 0;
  for (let frame = 0; frame < FRAME_COLUMNS - 1; frame++) {
    maximumStepDelta = Math.max(maximumStepDelta, meanVisualDelta(frames[frame], frames[frame + 1]));
  }
  const wrapDelta = meanVisualDelta(frames.at(-1), frames[0]);
  if (maximumStepDelta < MIN_ANIMATED_STEP_DELTA) {
    throw new RangeError(
      `Achievement icon row ${row} maximum mean delta ${maximumStepDelta.toFixed(3)} `
      + `does not contain perceptible animation`,
    );
  }
  if (maximumStepDelta > MAX_ADJACENT_FRAME_DELTA || wrapDelta > MAX_ADJACENT_FRAME_DELTA) {
    throw new RangeError(
      `Achievement icon row ${row} has an adjacent-frame mean delta above `
      + `${MAX_ADJACENT_FRAME_DELTA} (step ${maximumStepDelta.toFixed(3)}, wrap ${wrapDelta.toFixed(3)})`,
    );
  }
  if (wrapDelta > maximumStepDelta * LOOP_DELTA_MULTIPLIER + LOOP_DELTA_TOLERANCE) {
    throw new RangeError(
      `Achievement icon row ${row} loop-wrap mean delta ${wrapDelta.toFixed(3)} exceeds `
      + `normal step delta ${maximumStepDelta.toFixed(3)}`,
    );
  }
  return { maximumStepDelta, wrapDelta };
}

const runtime = await readFile(runtimePath);
const header = pngHeader(runtime, "Achievement icon sprite sheet");
if (header.width !== SHEET_WIDTH || header.height !== SHEET_HEIGHT) {
  throw new RangeError(
    `Achievement icon sprite sheet is ${header.width}x${header.height}; `
    + `expected ${SHEET_WIDTH}x${SHEET_HEIGHT}`,
  );
}
if (header.width !== FRAME_COLUMNS * FRAME_SIZE || header.height !== FRAME_ROWS * FRAME_SIZE) {
  throw new RangeError("Achievement icon sprite-sheet geometry does not match its frame grid");
}

const pixels = decodeRgba(runtime, header, "Achievement icon sprite sheet");
const firstFrameHashes = new Set();
let maximumStepDelta = 0;
let maximumWrapDelta = 0;
for (let row = 0; row < FRAME_ROWS; row++) {
  const frames = Array.from({ length: FRAME_COLUMNS }, (_, column) =>
    extractFrame(pixels, row, column));
  const stats = frames.map((frame, column) => frameStats(frame, `Achievement icon row ${row}, frame ${column}`));
  validateSubtleDrift(stats, row);
  const loop = validateLoop(frames, row);
  maximumStepDelta = Math.max(maximumStepDelta, loop.maximumStepDelta);
  maximumWrapDelta = Math.max(maximumWrapDelta, loop.wrapDelta);
  firstFrameHashes.add(visibleContentHash(frames[0]));
}

if (firstFrameHashes.size !== FRAME_ROWS) {
  throw new RangeError(
    `Achievement icon sprite sheet has ${firstFrameHashes.size} unique first-frame rows; expected ${FRAME_ROWS}`,
  );
}

console.log(
  `Achievement icon assets: OK (${FRAME_ROWS} icons, ${FRAME_COLUMNS} frames each, `
  + `${SHEET_WIDTH}x${SHEET_HEIGHT} RGBA; max step ${maximumStepDelta.toFixed(3)}, `
  + `max wrap ${maximumWrapDelta.toFixed(3)})`,
);
