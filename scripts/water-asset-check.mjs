import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagePath = resolve(root, "src/wayfinders/assets/packages/water.json");
const publicRoot = resolve(root, "public/assets/gr1/water");
const metadata = JSON.parse(await readFile(packagePath, "utf8"));
const requiredProfiles = ["abyss", "brackish", "coastal", "current", "deep", "lagoon", "reef", "rough"];

if (metadata.contractVersion !== 1 || metadata.assetId !== "world.water.primary" || metadata.kind !== "water-tile-package") {
  throw new Error("Water package identity or contract is invalid");
}
const profileIds = [...metadata.profiles.map(({ id }) => id)].sort();
if (JSON.stringify(profileIds) !== JSON.stringify(requiredProfiles)) {
  throw new Error(`Water package profiles do not match the runtime catalog: ${profileIds.join(", ")}`);
}
for (const image of metadata.images) {
  const bytes = await readFile(resolve(publicRoot, image.file));
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== image.pixelSize.width || height !== image.pixelSize.height) {
    throw new Error(`${image.file} is ${width}x${height}; expected ${image.pixelSize.width}x${image.pixelSize.height}`);
  }
}
for (const shoal of metadata.shoals) {
  const bytes = await readFile(resolve(publicRoot, shoal.file));
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== shoal.pixelSize.width || height !== shoal.pixelSize.height) {
    throw new Error(`${shoal.file} is ${width}x${height}; expected ${shoal.pixelSize.width}x${shoal.pixelSize.height}`);
  }
}
console.log(`Water assets: ${metadata.images.length} sheets, ${metadata.shoals.length} shoal strengths, ${metadata.profiles.length} profiles OK`);
