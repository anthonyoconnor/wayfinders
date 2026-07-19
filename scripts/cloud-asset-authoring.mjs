import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCloudAssetAuthoringSettings,
  cloudAssetAuthoringSettingsFromPackage,
  validateCloudAssetIdentityRequest,
  validateCloudAssetSaveRequest,
} from "../src/wayfinders/assets/CloudAssetAuthoring.ts";
import { validateCloudAssetPackage } from "../src/wayfinders/assets/CloudAssetCatalog.ts";
import {
  commitAtomicFileTransaction,
  withCollisionIntakeLock,
} from "./repository-collision-transaction.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class CloudAssetAuthoringError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CloudAssetAuthoringError";
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readPackage(packagePath) {
  let input;
  try {
    input = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new CloudAssetAuthoringError(`Cloud package could not be read: ${errorMessage(error)}`, { cause: error });
  }
  try {
    return validateCloudAssetPackage(input);
  } catch (error) {
    throw new CloudAssetAuthoringError(`Cloud package is invalid: ${errorMessage(error)}`, { cause: error });
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function variantSlot(cloudPackage, variantId) {
  const index = cloudPackage.variants.findIndex((variant) => variant?.id === variantId);
  if (index < 0) throw new CloudAssetAuthoringError(`Unknown cloud variant ${variantId}; refresh the asset library`);
  return { index, variant: cloudPackage.variants[index] };
}

function assertCurrentRevision(cloudPackage, request) {
  if (cloudPackage.runtimeRevision !== request.runtimeRevision) {
    throw new CloudAssetAuthoringError(
      `Stale cloud package revision ${request.runtimeRevision}; current revision is ${cloudPackage.runtimeRevision}. `
      + "Refresh the asset library before continuing",
    );
  }
}

function updatedPackage(cloudPackage, variants, presentation = cloudPackage.presentation) {
  if (!Number.isSafeInteger(cloudPackage.runtimeRevision)
    || cloudPackage.runtimeRevision >= Number.MAX_SAFE_INTEGER) {
    throw new CloudAssetAuthoringError("Cloud package runtimeRevision cannot be incremented safely");
  }
  try {
    return validateCloudAssetPackage({
      ...cloudPackage,
      runtimeRevision: cloudPackage.runtimeRevision + 1,
      presentation,
      variants,
    });
  } catch (error) {
    throw new CloudAssetAuthoringError(`Updated cloud package is invalid: ${errorMessage(error)}`, { cause: error });
  }
}

export function createCloudAssetAuthoringService({
  repositoryRoot = moduleRoot,
  commitTransaction = commitAtomicFileTransaction,
} = {}) {
  if (!path.isAbsolute(repositoryRoot)) throw new TypeError("repositoryRoot must be absolute");
  if (typeof commitTransaction !== "function") throw new TypeError("commitTransaction must be a function");
  const packagePath = path.join(
    repositoryRoot,
    "src",
    "wayfinders",
    "assets",
    "packages",
    "cloud-atmosphere.json",
  );

  async function persist(cloudPackage) {
    const expected = JSON.stringify(cloudPackage);
    await commitTransaction([{ targetPath: packagePath, bytes: jsonBytes(cloudPackage) }], async () => {
      const written = await readPackage(packagePath);
      if (JSON.stringify(written) !== expected) {
        throw new CloudAssetAuthoringError("Cloud package did not round-trip exactly after authoring");
      }
    });
  }

  async function save(input) {
    const request = validateCloudAssetSaveRequest(input);
    return withCollisionIntakeLock(repositoryRoot, async () => {
      const current = await readPackage(packagePath);
      assertCurrentRevision(current, request);
      const { index, variant } = variantSlot(current, request.variantId);
      const currentSettings = cloudAssetAuthoringSettingsFromPackage(current);
      const availabilityChanged = variant.activeInGame !== request.activeInGame;
      const settingsChanged = JSON.stringify(currentSettings) !== JSON.stringify(request.settings);
      if (!availabilityChanged && !settingsChanged) {
        return {
          assetId: current.assetId,
          variantId: variant.id,
          activeInGame: variant.activeInGame,
          settings: currentSettings,
          changed: false,
          availabilityChanged: false,
          settingsChanged: false,
          previousRuntimeRevision: current.runtimeRevision,
          runtimeRevision: current.runtimeRevision,
          message: `${variant.name} and the cloud settings are already saved`,
        };
      }
      const variants = [...current.variants];
      if (availabilityChanged) {
        variants[index] = { ...variant, activeInGame: request.activeInGame };
      }
      const presentation = settingsChanged
        ? applyCloudAssetAuthoringSettings(current.presentation, request.settings)
        : current.presentation;
      const updated = updatedPackage(current, variants, presentation);
      await persist(updated);
      const savedSettings = cloudAssetAuthoringSettingsFromPackage(updated);
      const message = availabilityChanged && settingsChanged
        ? `${variant.name} availability and cloud settings were updated`
        : availabilityChanged
          ? `${variant.name} was marked ${request.activeInGame ? "active" : "inactive"} in game`
          : "Cloud settings were updated";
      return {
        assetId: updated.assetId,
        variantId: variant.id,
        activeInGame: request.activeInGame,
        settings: savedSettings,
        changed: true,
        availabilityChanged,
        settingsChanged,
        previousRuntimeRevision: current.runtimeRevision,
        runtimeRevision: updated.runtimeRevision,
        message,
      };
    });
  }

  async function remove(input) {
    const request = validateCloudAssetIdentityRequest(input);
    return withCollisionIntakeLock(repositoryRoot, async () => {
      const current = await readPackage(packagePath);
      assertCurrentRevision(current, request);
      const { index, variant } = variantSlot(current, request.variantId);
      const variants = [...current.variants];
      variants[index] = null;
      const updated = updatedPackage(current, variants);
      await persist(updated);
      return {
        assetId: updated.assetId,
        deletedVariantId: variant.id,
        previousRuntimeRevision: current.runtimeRevision,
        runtimeRevision: updated.runtimeRevision,
        message: `${variant.name} was permanently deleted`,
      };
    });
  }

  return Object.freeze({ save, remove });
}
