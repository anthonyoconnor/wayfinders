import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAudioCatalog } from "../src/wayfinders/audio/AudioCatalog.ts";

const MAX_LIBRARY_BYTES = 12 * 1024 * 1024;

export async function checkAudioCatalog(repositoryRoot) {
  const catalogDirectory = path.join(repositoryRoot, "public", "assets", "audio");
  const catalogPath = path.join(catalogDirectory, "audio-catalog.json");
  const catalog = validateAudioCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
  const expectedWavFiles = new Set();
  let totalBytes = 0;

  for (const asset of catalog.assets) {
    const absoluteFile = path.resolve(catalogDirectory, asset.file);
    if (!inside(catalogDirectory, absoluteFile)) {
      throw new RangeError(`Audio asset ${asset.id} resolves outside public/assets/audio`);
    }
    const relativeFile = relativePortable(catalogDirectory, absoluteFile);
    if (expectedWavFiles.has(relativeFile)) {
      throw new RangeError(`Audio catalog repeats stored file ${relativeFile}`);
    }
    expectedWavFiles.add(relativeFile);

    const fileStat = await stat(absoluteFile).catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`Audio asset ${asset.id} is missing ${relativeFile}`);
      throw error;
    });
    if (!fileStat.isFile()) throw new Error(`Audio asset ${asset.id} is not a file: ${relativeFile}`);
    const contents = await readFile(absoluteFile);
    const wav = validatePcmWav(contents, `${asset.id} (${relativeFile})`);
    if (!asset.loop && wav.durationSeconds > 4) {
      throw new RangeError(
        `${asset.id} lasts ${wav.durationSeconds.toFixed(3)} seconds; non-loop maximum is 4 seconds`,
      );
    }
    totalBytes += contents.length;
  }

  const storedWavFiles = new Set((await filesUnder(catalogDirectory))
    .filter((file) => path.extname(file).toLocaleLowerCase("en") === ".wav")
    .map((file) => relativePortable(catalogDirectory, file)));
  const missingFromDisk = [...expectedWavFiles].filter((file) => !storedWavFiles.has(file)).sort();
  const unlistedOnDisk = [...storedWavFiles].filter((file) => !expectedWavFiles.has(file)).sort();
  if (missingFromDisk.length > 0 || unlistedOnDisk.length > 0) {
    throw new Error([
      missingFromDisk.length > 0 ? `Missing catalog WAVs: ${missingFromDisk.join(", ")}` : "",
      unlistedOnDisk.length > 0 ? `Unlisted stored WAVs: ${unlistedOnDisk.join(", ")}` : "",
    ].filter(Boolean).join("\n"));
  }
  if (totalBytes > MAX_LIBRARY_BYTES) {
    throw new RangeError(`Audio WAV library uses ${totalBytes} bytes; maximum is ${MAX_LIBRARY_BYTES}`);
  }

  return Object.freeze({
    libraryId: catalog.libraryId,
    assetCount: catalog.assets.length,
    totalBytes,
  });
}

function validatePcmWav(contents, label) {
  if (contents.length < 44) throw new RangeError(`${label} is too small to be a WAV file`);
  if (contents.toString("ascii", 0, 4) !== "RIFF" || contents.toString("ascii", 8, 12) !== "WAVE") {
    throw new RangeError(`${label} must contain RIFF/WAVE headers`);
  }
  if (contents.readUInt32LE(4) + 8 !== contents.length) {
    throw new RangeError(`${label} RIFF size does not match the stored file`);
  }

  let format;
  let dataBytes;
  let offset = 12;
  while (offset + 8 <= contents.length) {
    const chunkId = contents.toString("ascii", offset, offset + 4);
    const chunkSize = contents.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > contents.length) throw new RangeError(`${label} contains a truncated ${chunkId} chunk`);

    if (chunkId === "fmt ") {
      if (format) throw new RangeError(`${label} repeats its fmt chunk`);
      if (chunkSize < 16) throw new RangeError(`${label} fmt chunk is too small`);
      format = Object.freeze({
        encoding: contents.readUInt16LE(chunkStart),
        channels: contents.readUInt16LE(chunkStart + 2),
        sampleRate: contents.readUInt32LE(chunkStart + 4),
        byteRate: contents.readUInt32LE(chunkStart + 8),
        blockAlign: contents.readUInt16LE(chunkStart + 12),
        bitsPerSample: contents.readUInt16LE(chunkStart + 14),
      });
    } else if (chunkId === "data") {
      if (dataBytes !== undefined) throw new RangeError(`${label} repeats its data chunk`);
      dataBytes = chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format) throw new RangeError(`${label} is missing its fmt chunk`);
  if (dataBytes === undefined || dataBytes === 0) throw new RangeError(`${label} has no PCM sample data`);
  if (format.encoding !== 1) throw new RangeError(`${label} must use integer PCM encoding`);
  if (format.channels < 1 || format.channels > 2) throw new RangeError(`${label} must be mono or stereo`);
  if (format.sampleRate < 8_000 || format.sampleRate > 192_000) {
    throw new RangeError(`${label} sample rate must be between 8000 and 192000 Hz`);
  }
  if (![8, 16, 24, 32].includes(format.bitsPerSample)) {
    throw new RangeError(`${label} must use 8-, 16-, 24-, or 32-bit PCM samples`);
  }
  const expectedBlockAlign = format.channels * format.bitsPerSample / 8;
  if (format.blockAlign !== expectedBlockAlign) throw new RangeError(`${label} has invalid PCM block alignment`);
  if (format.byteRate !== format.sampleRate * format.blockAlign) {
    throw new RangeError(`${label} has an invalid PCM byte rate`);
  }
  if (dataBytes % format.blockAlign !== 0) throw new RangeError(`${label} PCM data ends mid-frame`);
  return Object.freeze({
    durationSeconds: dataBytes / format.byteRate,
  });
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function relativePortable(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(scriptPath), "..");
  const result = await checkAudioCatalog(repositoryRoot);
  console.log(
    `Audio catalog: OK (${result.assetCount} assets, ${(result.totalBytes / 1024 / 1024).toFixed(3)} MiB)`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
