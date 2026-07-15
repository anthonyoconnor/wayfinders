import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const PRIVATE_FEATURE_SUFFIXES = ["command", "commands", "selector", "selectors", "state", "system"];

const normalizeSegment = (value) => value
  .replace(/\.(?:[cm]?[jt]sx?)$/i, "")
  .replace(/[^a-z0-9]/gi, "")
  .toLowerCase();

const normalizedParts = (value) => value
  .replaceAll("\\", "/")
  .split("/")
  .filter(Boolean);

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

/**
 * Extract static imports, re-exports, literal dynamic imports, and CommonJS
 * requires. The checker intentionally ignores computed module names: feature
 * dependencies must be statically visible to agents and build tooling.
 */
export function extractModuleSpecifiers(source) {
  const searchable = withoutComments(source);
  const matches = [];
  const patterns = [
    /(?:^|[;\r\n])\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of searchable.matchAll(pattern)) {
      const specifierOffset = match.index + match[0].lastIndexOf(match[1]);
      matches.push({
        specifier: match[1],
        line: searchable.slice(0, specifierOffset).split(/\r?\n/).length,
      });
    }
  }

  return matches
    .sort((left, right) => left.line - right.line || left.specifier.localeCompare(right.specifier))
    .filter((item, index, all) => index === 0
      || item.line !== all[index - 1].line
      || item.specifier !== all[index - 1].specifier);
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(entryPath));
    else if (entry.isFile() && MODULE_EXTENSIONS.has(path.extname(entry.name))) files.push(entryPath);
  }
  return files;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function featureLocation(candidate, featuresRoot) {
  if (!inside(featuresRoot, candidate)) return undefined;
  const [owner, ...subpath] = path.relative(featuresRoot, candidate).split(path.sep).filter(Boolean);
  return owner ? { owner, subpath } : undefined;
}

function targetFeatureLocation(importer, specifier, featuresRoot) {
  if (specifier.startsWith(".")) {
    return featureLocation(path.resolve(path.dirname(importer), specifier), featuresRoot);
  }
  if (path.isAbsolute(specifier)) return featureLocation(path.resolve(specifier), featuresRoot);

  const parts = normalizedParts(specifier);
  const featuresIndex = parts.lastIndexOf("features");
  if (featuresIndex < 0 || !parts[featuresIndex + 1]) return undefined;
  return {
    owner: parts[featuresIndex + 1],
    subpath: parts.slice(featuresIndex + 2),
  };
}

function isPrivateFeaturePart(part) {
  const normalized = normalizeSegment(part);
  return PRIVATE_FEATURE_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(suffix));
}

/** Public feature imports are deliberately boring and discoverable. */
export function isPublicFeatureSubpath(subpath) {
  const parts = subpath.map(normalizeSegment).filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "index")) return true;

  const first = parts[0];
  const last = parts.at(-1);
  if (["api", "contracts", "public"].includes(first)) return true;
  if (last === "contract" || last.endsWith("contracts")) return true;
  if (last === "presentationadapter" || last.endsWith("presentationadapter")) return true;
  if (first === "presentation" && (parts.length === 1 || last === "index")) return true;
  return false;
}

function importsPhaser(specifier) {
  const normalized = specifier.toLowerCase();
  return normalized === "phaser" || normalized.startsWith("phaser/");
}

function importsRendering(importer, specifier, sourceRoot) {
  if (specifier.startsWith(".")) {
    const target = path.resolve(path.dirname(importer), specifier);
    const parts = path.relative(sourceRoot, target).split(path.sep);
    return parts[0] === "rendering";
  }
  return normalizedParts(specifier).includes("rendering");
}

function isPresentationFile(file, sourceRoot) {
  return path.relative(sourceRoot, file)
    .split(path.sep)
    .some((part) => {
      const normalized = normalizeSegment(part);
      return normalized === "rendering"
        || normalized === "presentation"
        || normalized.endsWith("renderer")
        || normalized.endsWith("presentationadapter");
    });
}

function relativeDisplay(repositoryRoot, file) {
  return path.relative(repositoryRoot, file).replaceAll("\\", "/");
}

function violation(repositoryRoot, file, dependency, code, message) {
  return {
    code,
    file: relativeDisplay(repositoryRoot, file),
    line: dependency.line,
    message,
    specifier: dependency.specifier,
  };
}

/**
 * Enforce prospective boundaries under src/wayfinders/features. Existing
 * legacy folders remain outside this check until moved behind a feature API.
 */
export async function checkFeatureBoundaries(
  repositoryRoot,
  { sourceRoot = path.join(repositoryRoot, "src", "wayfinders") } = {},
) {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const absoluteSourceRoot = path.resolve(sourceRoot);
  const featuresRoot = path.join(absoluteSourceRoot, "features");
  const violations = [];

  for (const file of await sourceFiles(absoluteSourceRoot)) {
    const importerFeature = featureLocation(file, featuresRoot);
    const presentationFile = isPresentationFile(file, absoluteSourceRoot);
    const dependencies = extractModuleSpecifiers(await readFile(file, "utf8"));

    for (const dependency of dependencies) {
      const { specifier } = dependency;
      if (importerFeature && importsPhaser(specifier)) {
        violations.push(violation(
          absoluteRepositoryRoot,
          file,
          dependency,
          "feature-no-phaser",
          `Feature "${importerFeature.owner}" cannot import Phaser. Put engine code in rendering and expose data through the feature's presentation adapter.`,
        ));
      }
      if (importerFeature && importsRendering(file, specifier, absoluteSourceRoot)) {
        violations.push(violation(
          absoluteRepositoryRoot,
          file,
          dependency,
          "feature-no-rendering",
          `Feature "${importerFeature.owner}" cannot import the rendering layer. Rendering may depend on the feature's public index, contracts, or presentation adapter.`,
        ));
      }

      const targetFeature = targetFeatureLocation(file, specifier, featuresRoot);
      if (!targetFeature) continue;
      const crossesOwner = importerFeature?.owner !== targetFeature.owner;
      const ownPresentationReachesPrivate = presentationFile
        && importerFeature?.owner === targetFeature.owner
        && targetFeature.subpath.some(isPrivateFeaturePart);
      if ((!crossesOwner && !ownPresentationReachesPrivate)
        || isPublicFeatureSubpath(targetFeature.subpath)) continue;

      const importerDescription = importerFeature
        ? `Feature "${importerFeature.owner}"`
        : presentationFile ? "Rendering/presentation" : "Code outside the feature";
      violations.push(violation(
        absoluteRepositoryRoot,
        file,
        dependency,
        "feature-private-import",
        `${importerDescription} cannot import private modules from feature "${targetFeature.owner}". Import its public index, contracts, or presentation adapter instead.`,
      ));
    }
  }

  return violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
}

export function formatFeatureBoundaryViolation(item) {
  return `${item.file}:${item.line} [${item.code}] ${item.message} Import: "${item.specifier}"`;
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(scriptPath), "..");
  const violations = await checkFeatureBoundaries(repositoryRoot);
  if (violations.length === 0) {
    console.log("Feature boundaries: OK");
    return;
  }

  console.error(`Feature boundaries: ${violations.length} ownership violation(s)`);
  for (const item of violations) console.error(`- ${formatFeatureBoundaryViolation(item)}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
