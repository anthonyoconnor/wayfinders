import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 24_000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const AUDIO_ROOT = path.join(REPOSITORY_ROOT, "public", "assets", "audio");
const V1_ROOT = path.join(AUDIO_ROOT, "v1");

const EXPECTED_PATHS = [
  "music/home-harbor.wav",
  "music/open-water.wav",
  "ambience/ocean.wav",
  "ambience/wake.wav",
  "sfx/discovery.wav",
  "sfx/survey-complete.wav",
  "sfx/dock-return.wav",
  "sfx/wreck.wav",
  "ui/confirm.wav",
  "ui/cancel.wav",
  "ui/toggle.wav",
];

function createSound(seconds, channels = 1) {
  return Array.from({ length: channels }, () => new Float64Array(Math.round(seconds * SAMPLE_RATE)));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function panGains(position) {
  const angle = ((position + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

function addTone(sound, frequency, amplitude, options = {}) {
  const startFrame = Math.max(0, Math.round((options.start ?? 0) * SAMPLE_RATE));
  const endFrame = Math.min(
    sound[0].length,
    Math.round(((options.start ?? 0) + (options.duration ?? sound[0].length / SAMPLE_RATE)) * SAMPLE_RATE),
  );
  const phase = options.phase ?? 0;
  const [left, right] = panGains(options.pan ?? 0);
  const attack = Math.max(options.attack ?? 0, 1 / SAMPLE_RATE);
  const release = Math.max(options.release ?? 0, 1 / SAMPLE_RATE);
  const decay = options.decay ?? 0;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const local = (frame - startFrame) / SAMPLE_RATE;
    const remaining = (endFrame - 1 - frame) / SAMPLE_RATE;
    const fadeIn = Math.sin(Math.min(local / attack, 1) * Math.PI * 0.5) ** 2;
    const fadeOut = Math.sin(Math.min(remaining / release, 1) * Math.PI * 0.5) ** 2;
    const envelope = Math.min(fadeIn, fadeOut) * Math.exp(-local * decay);
    const sample = amplitude * envelope * Math.sin(2 * Math.PI * frequency * local + phase);
    if (sound.length === 1) sound[0][frame] += sample;
    else {
      sound[0][frame] += sample * left;
      sound[1][frame] += sample * right;
    }
  }
}

function addBell(sound, start, frequency, amplitude, pan) {
  const duration = 1.35;
  addTone(sound, frequency, amplitude, { start, duration, attack: 0.01, release: 0.35, decay: 1.8, pan });
  addTone(sound, frequency * 2.01, amplitude * 0.34, { start, duration, attack: 0.008, release: 0.30, decay: 2.5, pan, phase: 0.3 });
  addTone(sound, frequency * 3.98, amplitude * 0.14, { start, duration: 0.85, attack: 0.006, release: 0.24, decay: 3.2, pan, phase: 0.8 });
}

function addWoodTap(sound, start, amplitude, pan, seed) {
  const random = seededRandom(seed);
  const duration = 0.16;
  const startFrame = Math.round(start * SAMPLE_RATE);
  const endFrame = Math.min(sound[0].length, startFrame + Math.round(duration * SAMPLE_RATE));
  const [left, right] = panGains(pan);
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const local = (frame - startFrame) / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 185 * local) + 0.42 * Math.sin(2 * Math.PI * 311 * local + 0.3);
    const sample = amplitude * Math.exp(-local * 34) * (0.62 * body + 0.08 * (random() * 2 - 1));
    if (sound.length === 1) sound[0][frame] += sample;
    else {
      sound[0][frame] += sample * left;
      sound[1][frame] += sample * right;
    }
  }
}

function periodicNoise(frames, seconds, seed, lowHz, highHz, slope = 0.4) {
  const random = seededRandom(seed);
  const result = new Float64Array(frames);
  const componentCount = 48;
  const components = [];
  for (let index = 0; index < componentCount; index += 1) {
    const ratio = (index + 0.5) / componentCount;
    const frequency = lowHz * (highHz / lowHz) ** ratio;
    const cycles = Math.max(1, Math.round(frequency * seconds));
    components.push({ cycles, phase: random() * Math.PI * 2, level: 1 / frequency ** slope });
  }
  for (let frame = 0; frame < frames; frame += 1) {
    let sample = 0;
    const position = frame / frames;
    for (const component of components) {
      sample += component.level * Math.sin(2 * Math.PI * component.cycles * position + component.phase);
    }
    result[frame] = sample;
  }
  let sumSquares = 0;
  for (const sample of result) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / frames) || 1;
  for (let frame = 0; frame < frames; frame += 1) result[frame] /= rms;
  return result;
}

function addNoiseBurst(sound, start, duration, amplitude, seed, lowHz, highHz, pan = 0) {
  const frames = Math.round(duration * SAMPLE_RATE);
  const noise = periodicNoise(frames, duration, seed, lowHz, highHz, 0.2);
  const startFrame = Math.round(start * SAMPLE_RATE);
  const [left, right] = panGains(pan);
  for (let offset = 0; offset < frames && startFrame + offset < sound[0].length; offset += 1) {
    const local = offset / SAMPLE_RATE;
    const remaining = (frames - 1 - offset) / SAMPLE_RATE;
    const envelope = Math.min(local / 0.008, 1, remaining / Math.min(0.65, duration * 0.7)) * Math.exp(-local * 1.8);
    const sample = noise[offset] * amplitude * Math.max(envelope, 0);
    if (sound.length === 1) sound[0][startFrame + offset] += sample;
    else {
      sound[0][startFrame + offset] += sample * left;
      sound[1][startFrame + offset] += sample * right;
    }
  }
}

function normalize(sound, targetPeak, loop) {
  for (const channel of sound) {
    let mean = 0;
    for (const sample of channel) mean += sample;
    mean /= channel.length;
    for (let frame = 0; frame < channel.length; frame += 1) channel[frame] -= mean;
  }

  if (loop) {
    const bridge = Math.min(Math.round(0.012 * SAMPLE_RATE), Math.floor(sound[0].length / 10));
    for (const channel of sound) {
      const first = channel[0];
      const start = channel.length - bridge - 1;
      const from = channel[start];
      for (let offset = 0; offset <= bridge; offset += 1) {
        const u = offset / bridge;
        const smooth = u * u * (3 - 2 * u);
        channel[start + offset] = from * (1 - smooth) + first * smooth;
      }
    }
  } else {
    const fade = Math.min(Math.round(0.012 * SAMPLE_RATE), Math.floor(sound[0].length / 5));
    for (const channel of sound) {
      for (let frame = 0; frame < fade; frame += 1) {
        const gain = Math.sin((frame / Math.max(fade - 1, 1)) * Math.PI * 0.5) ** 2;
        channel[frame] *= gain;
        channel[channel.length - 1 - frame] *= gain;
      }
    }
  }

  let peak = 0;
  for (const channel of sound) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  const gain = targetPeak / Math.max(peak, Number.EPSILON);
  for (const channel of sound) for (let frame = 0; frame < channel.length; frame += 1) channel[frame] *= gain;
  return sound;
}

function writeWav(relativePath, sound, peak, loop) {
  normalize(sound, peak, loop);
  const frameCount = sound[0].length;
  const channelCount = sound.length;
  const dataSize = frameCount * channelCount * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channelCount, 22);
  output.writeUInt32LE(SAMPLE_RATE, 24);
  output.writeUInt32LE(SAMPLE_RATE * channelCount * 2, 28);
  output.writeUInt16LE(channelCount * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  let cursor = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const pcm = Math.max(-32768, Math.min(32767, Math.round(sound[channel][frame] * 32767)));
      output.writeInt16LE(pcm, cursor);
      cursor += 2;
    }
  }
  const outputPath = path.join(V1_ROOT, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
}

function renderMusic(kind) {
  const seconds = 24;
  const sound = createSound(seconds, 2);
  const home = kind === "home";
  const padNotes = home ? [73.42, 110, 146.83, 185] : [82.41, 123.47, 164.81, 220];
  const padLevels = [0.18, 0.11, 0.075, 0.04];
  for (let index = 0; index < padNotes.length; index += 1) {
    const frequency = Math.round(padNotes[index] * seconds) / seconds;
    addTone(sound, frequency, padLevels[index], { duration: seconds, attack: 0.001, release: 0.001, phase: index * 0.4, pan: index % 2 ? 0.35 : -0.35 });
  }
  const starts = home ? [0.8, 4, 7.2, 10.4, 13.6, 16.8, 20] : [1, 3.8, 6.6, 9.4, 12.2, 15, 17.8, 20.6];
  const notes = home ? [293.66, 329.63, 293.66, 246.94, 293.66, 329.63, 277.18] : [329.63, 369.99, 440, 493.88, 440, 369.99, 329.63, 277.18];
  starts.forEach((start, index) => {
    addBell(sound, start, notes[index], home ? 0.055 : 0.060, index % 2 ? 0.6 : -0.6);
    addWoodTap(sound, start + (home ? 0 : 0.7), 0.045, index % 2 ? 0.35 : -0.35, 100 + index + (home ? 0 : 50));
  });
  return sound;
}

function renderAmbience(kind) {
  const seconds = kind === "ocean" ? 8 : 4;
  const channels = kind === "ocean" ? 2 : 1;
  const sound = createSound(seconds, channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const noise = periodicNoise(sound[channel].length, seconds, 300 + channel + (kind === "wake" ? 20 : 0), kind === "ocean" ? 18 : 120, kind === "ocean" ? 1500 : 3900, kind === "ocean" ? 0.42 : 0.12);
    for (let frame = 0; frame < noise.length; frame += 1) {
      const position = frame / noise.length;
      const swell = 0.54 + 0.20 * Math.sin(2 * Math.PI * (kind === "ocean" ? 2 : 3) * position + channel * 1.1);
      sound[channel][frame] += noise[frame] * swell * 0.24;
    }
  }
  return sound;
}

function renderDiscovery() {
  const sound = createSound(1.65, 2);
  [[0.02, 293.66, -0.45], [0.18, 440, 0.2], [0.34, 587.33, 0.55]].forEach(([start, note, pan]) => addBell(sound, start, note, 0.15, pan));
  addNoiseBurst(sound, 0.12, 1.1, 0.018, 501, 900, 5200);
  return sound;
}

function renderSurvey() {
  const sound = createSound(1.35, 2);
  addWoodTap(sound, 0.015, 0.18, -0.25, 601);
  addBell(sound, 0.10, 392, 0.15, 0.25);
  addBell(sound, 0.25, 587.33, 0.10, 0.55);
  return sound;
}

function renderDock() {
  const sound = createSound(1.9, 2);
  addWoodTap(sound, 0.02, 0.20, -0.5, 701);
  addWoodTap(sound, 0.17, 0.15, 0.35, 702);
  [[0.20, 440, 0.45], [0.42, 329.63, 0.05], [0.66, 220, -0.35]].forEach(([start, note, pan]) => addBell(sound, start, note, 0.13, pan));
  return sound;
}

function renderWreck() {
  const sound = createSound(2.55, 2);
  addNoiseBurst(sound, 0.01, 1.4, 0.14, 801, 45, 2800, -0.25);
  addNoiseBurst(sound, 0.02, 1.4, 0.14, 802, 45, 2800, 0.25);
  addTone(sound, 61, 0.25, { duration: 1.1, attack: 0.006, release: 0.75, decay: 4, pan: -0.1 });
  addTone(sound, 142, 0.10, { start: 0.36, duration: 1.65, attack: 0.08, release: 0.65, decay: 0.4, pan: 0.2 });
  return sound;
}

function renderUi(kind) {
  const durations = { confirm: 0.30, cancel: 0.34, toggle: 0.15 };
  const sound = createSound(durations[kind]);
  if (kind === "confirm") {
    addTone(sound, 660, 0.72, { duration: 0.28, attack: 0.004, release: 0.18 });
    addTone(sound, 990, 0.34, { duration: 0.28, attack: 0.004, release: 0.18, phase: 0.15 });
  } else if (kind === "cancel") {
    addTone(sound, 520, 0.70, { duration: 0.16, attack: 0.005, release: 0.10 });
    addTone(sound, 350, 0.62, { start: 0.12, duration: 0.20, attack: 0.01, release: 0.16 });
  } else {
    addWoodTap(sound, 0.002, 0.55, 0, 901);
    addTone(sound, 410, 0.45, { duration: 0.13, attack: 0.002, release: 0.10, decay: 24 });
  }
  return sound;
}

function assertCatalogContract() {
  const catalog = JSON.parse(fs.readFileSync(path.join(AUDIO_ROOT, "audio-catalog.json"), "utf8"));
  const catalogPaths = catalog.assets.map((asset) => asset.file.replace(/^\.\/v1\//, "")).sort();
  const expected = [...EXPECTED_PATHS].sort();
  if (JSON.stringify(catalogPaths) !== JSON.stringify(expected)) {
    throw new Error("Audio catalog paths changed. Update the renderer deliberately before generating assets.");
  }
}

assertCatalogContract();
writeWav("music/home-harbor.wav", renderMusic("home"), 0.52, true);
writeWav("music/open-water.wav", renderMusic("open"), 0.52, true);
writeWav("ambience/ocean.wav", renderAmbience("ocean"), 0.45, true);
writeWav("ambience/wake.wav", renderAmbience("wake"), 0.45, true);
writeWav("sfx/discovery.wav", renderDiscovery(), 0.38, false);
writeWav("sfx/survey-complete.wav", renderSurvey(), 0.38, false);
writeWav("sfx/dock-return.wav", renderDock(), 0.38, false);
writeWav("sfx/wreck.wav", renderWreck(), 0.38, false);
writeWav("ui/confirm.wav", renderUi("confirm"), 0.34, false);
writeWav("ui/cancel.wav", renderUi("cancel"), 0.34, false);
writeWav("ui/toggle.wav", renderUi("toggle"), 0.34, false);
console.log(`Generated ${EXPECTED_PATHS.length} audio assets in ${path.relative(REPOSITORY_ROOT, V1_ROOT)}.`);
