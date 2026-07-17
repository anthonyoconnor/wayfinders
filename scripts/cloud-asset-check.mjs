import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "src", "wayfinders", "assets", "packages", "cloud-atmosphere.json");
const sourcePath = path.join(root, "assets-src", "cld1", "clouds", "cloud-sheet-original.png");
const runtimePath = path.join(root, "public", "assets", "cld1", "clouds", "cloud-sheet.png");

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

function alphaStats(buffer, header, label, frameWidth, frameHeight) {
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new RangeError(`${label} must be a non-interlaced 8-bit RGBA PNG`);
  }
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const scanlines = inflateSync(Buffer.concat(chunks));
  const stride = header.width * 4;
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let transparent = 0;
  let nonTransparent = 0;
  const frameColumns = header.width / frameWidth;
  const frameRows = header.height / frameHeight;
  const frameBounds = Array.from({ length: frameColumns * frameRows }, () => ({
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  }));
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
    for (let x = 0; x < header.width; x++) {
      if (current[x * 4 + 3] === 0) transparent++;
      else {
        nonTransparent++;
        const frameX = Math.floor(x / frameWidth);
        const frameY = Math.floor(y / frameHeight);
        const bounds = frameBounds[frameY * frameColumns + frameX];
        const localX = x % frameWidth;
        const localY = y % frameHeight;
        bounds.minX = Math.min(bounds.minX, localX);
        bounds.minY = Math.min(bounds.minY, localY);
        bounds.maxX = Math.max(bounds.maxX, localX);
        bounds.maxY = Math.max(bounds.maxY, localY);
      }
    }
    current.copy(previous);
  }
  return {
    transparent,
    nonTransparent,
    frameBounds: frameBounds.map((bounds, index) => {
      if (!Number.isFinite(bounds.minX)) throw new RangeError(`Cloud frame ${index} has no visible pixels`);
      return {
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX + 1,
        height: bounds.maxY - bounds.minY + 1,
      };
    }),
  };
}

const metadata = JSON.parse(await readFile(packagePath, "utf8"));
const source = await readFile(sourcePath);
const runtime = await readFile(runtimePath);
const sourceHeader = pngHeader(source, "Cloud source");
const runtimeHeader = pngHeader(runtime, "Cloud runtime");
const expected = metadata.image.pixelSize;
if (runtimeHeader.width !== expected.width || runtimeHeader.height !== expected.height) {
  throw new RangeError("Cloud runtime dimensions disagree with package metadata");
}
if (sourceHeader.width !== expected.width || sourceHeader.height !== expected.height) {
  throw new RangeError("Cloud source and runtime dimensions must match");
}
const frame = metadata.image.frameSize;
if (expected.width % frame.width !== 0 || expected.height % frame.height !== 0) {
  throw new RangeError("Cloud runtime dimensions are not divisible by the frame size");
}
if ((expected.width / frame.width) * (expected.height / frame.height) !== metadata.image.frameCount) {
  throw new RangeError("Cloud frame grid does not match the declared frame count");
}
if (!Array.isArray(metadata.variants) || metadata.variants.length !== metadata.image.frameCount) {
  throw new RangeError("Cloud package must name every frame variant");
}
const alpha = alphaStats(runtime, runtimeHeader, "Cloud runtime", frame.width, frame.height);
if (alpha.transparent === 0 || alpha.nonTransparent === 0) {
  throw new RangeError("Cloud runtime must contain both transparent and visible pixels");
}
if (JSON.stringify(alpha.frameBounds) !== JSON.stringify(metadata.image.opaqueBounds)) {
  throw new RangeError("Cloud opaque bounds disagree with the runtime pixels");
}
console.log(`Cloud asset: OK (${metadata.image.frameCount} variants, ${runtimeHeader.width}x${runtimeHeader.height} RGBA)`);
