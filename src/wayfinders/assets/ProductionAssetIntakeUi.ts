import {
  PRODUCTION_ASSET_FAMILY_DEFAULTS,
  PRODUCTION_ASSET_INTAKE_FORMAT_VERSION,
  PRODUCTION_ASSET_INTAKE_ROUTE,
  aspectLockedProductionAssetDimensions,
  gridPaddedProductionAssetDimensions,
  productionAssetPngDimensions,
  productionAssetNameFromFileName,
  suggestedProductionAssetId,
  type ProductionAssetCanvasSizing,
  type ProductionAssetDimensions,
  type ProductionAssetFamilyDefaults,
} from "./ProductionAssetIntake";
import type { ProductionAssetFamily } from "./ProductionAssetRecipe";

export interface ProductionAssetIntakeReference {
  readonly name: string;
  readonly repositoryPath: string;
  readonly sourceUrl: string;
  readonly kind: "island" | "shoal" | "environment";
}

export interface ProductionAssetIntakeUi {
  open(reference?: Readonly<ProductionAssetIntakeReference>): void;
  destroy(): void;
}

interface IntakeJob {
  readonly jobId: string;
  readonly status: "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
  readonly phase: string;
  readonly message: string;
  readonly recipeId?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

const ACTIVE_JOB_KEY = "wayfinders:production-asset-intake-job";
export const PRODUCTION_ASSET_LIBRARY_SELECTION_KEY = "wayfinders:asset-library-selection";

function base64(bytes: ArrayBuffer): string {
  const source = new Uint8Array(bytes);
  let result = "";
  const stride = 0x8000;
  for (let offset = 0; offset < source.length; offset += stride) {
    result += String.fromCharCode(...source.subarray(offset, offset + stride));
  }
  return btoa(result);
}

function field<T extends HTMLInputElement | HTMLSelectElement>(root: ParentNode, name: string): T {
  const input = root.querySelector<T>(`[name="${name}"]`);
  if (!input) throw new Error(`Missing intake field ${name}`);
  return input;
}

function familyFor(reference?: Readonly<ProductionAssetIntakeReference>): ProductionAssetFamily {
  return reference?.kind ?? "island";
}

export function mountProductionAssetIntakeUi({
  onCompleted = (recipeId) => {
    sessionStorage.setItem(PRODUCTION_ASSET_LIBRARY_SELECTION_KEY, recipeId);
    window.location.reload();
  },
  existingAssets = [],
  focusedFamily,
}: Readonly<{
  onCompleted?: (recipeId: string) => void;
  existingAssets?: readonly Readonly<{ id: string; name: string }>[];
  focusedFamily?: ProductionAssetFamily;
}> = {}): ProductionAssetIntakeUi {
  const dialog = document.createElement("dialog");
  dialog.className = "production-intake-dialog";
  dialog.dataset.focusedFamily = focusedFamily ?? "";
  dialog.innerHTML = `
    <form method="dialog" class="production-intake-form">
      <header>
        <div><p class="eyebrow">${focusedFamily === "island" ? "Island workshop" : "Guided intake"}</p><h2>${focusedFamily === "island" ? "Import island PNG" : "Import and prepare"}</h2></div>
        <button type="button" data-intake-close aria-label="Close">×</button>
      </header>
      <p data-intake-source-summary class="production-intake-source-summary"></p>
      <label data-intake-upload>Local PNG
        <input name="sourceFile" type="file" accept="image/png,.png">
        <small data-field-error="source"></small>
      </label>
      <div class="production-intake-grid">
        <label>Asset name<input name="name" required maxlength="80"><small data-field-error="name"></small></label>
        <label data-intake-advanced>Family<select name="family">
          <option value="island">Island</option><option value="vessel">Vessel</option>
          <option value="shoal">Shoal</option><option value="world-feature">World feature</option>
          <option value="environment">Environment</option>
        </select><small data-field-error="family"></small></label>
        <label class="production-intake-wide">Stable ID<input name="id" required maxlength="96" spellcheck="false"><small data-field-error="id"></small></label>
        <label class="production-intake-wide production-intake-dimensions-mode"><input name="keepOriginalDimensions" type="checkbox" checked> Keep original PNG dimensions</label>
        <label class="production-intake-wide production-intake-dimensions-mode"><input name="lockAspectRatio" type="checkbox" checked> Lock width and height to the PNG aspect ratio</label>
        <label>Canvas width (px)<input name="targetWidth" type="number" min="1" max="4096" required><small data-field-error="targetWidth"></small></label>
        <label>Canvas height (px)<input name="targetHeight" type="number" min="1" max="4096" required><small data-field-error="targetHeight"></small></label>
        <div class="production-intake-wide production-intake-dimensions" data-intake-dimensions>
          <p data-intake-dimensions-summary>Choose a PNG to read its dimensions.</p>
          <p data-intake-dimensions-warning hidden></p>
          <button type="button" data-intake-pad hidden></button>
        </div>
        <label data-intake-advanced>Layer role<select name="layerRole"><option value="island-composite">Island composite</option><option value="water-apron">Water apron</option><option value="shore-effect">Shore effect</option><option value="base">Base</option><option value="overlay">Overlay</option><option value="effect">Effect</option><option value="reference">Reference</option></select><small data-field-error="layerRole"></small></label>
        <label data-intake-advanced>Collision<select name="collisionSemantics"><option value="solid">Solid draft</option><option value="passable">Explicitly passable</option></select><small data-field-error="collisionSemantics"></small></label>
        <label class="production-intake-wide" data-intake-advanced>Runtime/test category<select name="runtimeCategory">
          <option value="none">None</option><option value="home-island">Home island</option>
          <option value="player-boat">Player boat</option><option value="fishing-shoal">Fishing shoal</option>
        </select><small data-field-error="runtimeCategory"></small></label>
      </div>
      <p data-intake-defaults class="production-intake-defaults"></p>
      <div class="production-intake-progress" data-intake-progress hidden>
        <progress max="4" value="0"></progress><output></output>
      </div>
      <p data-field-error="form" class="production-intake-form-error"></p>
      <footer>
        <button type="button" data-intake-cancel hidden>Cancel job</button>
        <button type="submit" data-intake-submit>${focusedFamily === "island" ? "Import island" : "Prepare pending candidate"}</button>
        <button type="button" data-intake-open hidden>${focusedFamily === "island" ? "Open island" : "Open pending candidate"}</button>
      </footer>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>("form");
  if (!form) throw new Error("Production intake form could not be mounted");
  const close = form.querySelector<HTMLButtonElement>("[data-intake-close]");
  const submit = form.querySelector<HTMLButtonElement>("[data-intake-submit]");
  const cancel = form.querySelector<HTMLButtonElement>("[data-intake-cancel]");
  const openCandidate = form.querySelector<HTMLButtonElement>("[data-intake-open]");
  const progress = form.querySelector<HTMLElement>("[data-intake-progress]");
  const progressBar = progress?.querySelector<HTMLProgressElement>("progress");
  const progressOutput = progress?.querySelector<HTMLOutputElement>("output");
  const sourceSummary = form.querySelector<HTMLElement>("[data-intake-source-summary]");
  const uploadLabel = form.querySelector<HTMLElement>("[data-intake-upload]");
  const defaults = form.querySelector<HTMLElement>("[data-intake-defaults]");
  const dimensionSummary = form.querySelector<HTMLElement>("[data-intake-dimensions-summary]");
  const dimensionWarning = form.querySelector<HTMLElement>("[data-intake-dimensions-warning]");
  const padDimensions = form.querySelector<HTMLButtonElement>("[data-intake-pad]");
  let reference: Readonly<ProductionAssetIntakeReference> | undefined;
  let currentJob: IntakeJob | undefined;
  let pollTimer: number | undefined;
  let sourceDimensions: Readonly<ProductionAssetDimensions> | undefined;
  let canvasSizing: ProductionAssetCanvasSizing = "native";
  let dimensionReadRevision = 0;
  let sourceReadPending = false;
  let nameEdited = false;
  const existingIds = new Set(existingAssets.map(({ id }) => id));
  const existingNames = new Set(existingAssets.map(({ name }) => name.trim().toLowerCase()));

  const clearErrors = () => {
    for (const output of form.querySelectorAll<HTMLElement>("[data-field-error]")) output.textContent = "";
  };
  const showErrors = (errors: Readonly<Record<string, string>> = {}) => {
    clearErrors();
    for (const [name, message] of Object.entries(errors)) {
      const output = form.querySelector<HTMLElement>(`[data-field-error="${CSS.escape(name)}"]`);
      if (output) output.textContent = message;
    }
  };
  const updateIdentityAvailability = (jobActive = false): boolean => {
    const name = field<HTMLInputElement>(form, "name").value.trim();
    const id = field<HTMLInputElement>(form, "id").value.trim();
    const duplicateName = existingNames.has(name.toLowerCase());
    const duplicateId = existingIds.has(id);
    const nameError = form.querySelector<HTMLElement>('[data-field-error="name"]');
    const idError = form.querySelector<HTMLElement>('[data-field-error="id"]');
    if (nameError) nameError.textContent = duplicateName ? `Asset name ${name} is already in use` : "";
    if (idError) idError.textContent = duplicateId ? `Stable ID ${id} is already in use` : "";
    const available = !duplicateName && !duplicateId;
    if (submit) submit.disabled = jobActive || sourceReadPending || !available;
    return available;
  };
  const targetDimensions = (): ProductionAssetDimensions => ({
    width: Number(field<HTMLInputElement>(form, "targetWidth").value),
    height: Number(field<HTMLInputElement>(form, "targetHeight").value),
  });
  const updateDimensionControls = (jobActive = false) => {
    const keepOriginal = field<HTMLInputElement>(form, "keepOriginalDimensions");
    const lockAspectRatio = field<HTMLInputElement>(form, "lockAspectRatio");
    const width = field<HTMLInputElement>(form, "targetWidth");
    const height = field<HTMLInputElement>(form, "targetHeight");
    width.disabled = jobActive || keepOriginal.checked;
    height.disabled = jobActive || keepOriginal.checked;
    lockAspectRatio.disabled = jobActive || keepOriginal.checked || sourceDimensions === undefined;
    const target = targetDimensions();
    const family = field<HTMLSelectElement>(form, "family").value as ProductionAssetFamily;
    const collision = field<HTMLSelectElement>(form, "collisionSemantics").value;
    const completeTarget = Number.isInteger(target.width) && target.width > 0
      && Number.isInteger(target.height) && target.height > 0;
    const nativeDimensions = sourceDimensions;
    if (dimensionSummary) {
      dimensionSummary.textContent = sourceDimensions
        ? `PNG canvas: ${sourceDimensions.width}\u00d7${sourceDimensions.height} px. Output canvas: ${target.width}\u00d7${target.height} px.`
        : "Choose a PNG to read its dimensions.";
    }
    const needsGridPadding = collision === "solid" && completeTarget
      && (target.width % 32 !== 0 || target.height % 32 !== 0);
    const canPadNativeCanvas = nativeDimensions !== undefined
      && target.width === nativeDimensions.width
      && target.height === nativeDimensions.height;
    if (dimensionWarning) {
      dimensionWarning.hidden = !needsGridPadding;
      dimensionWarning.textContent = needsGridPadding
        ? `${family === "island" ? "Island" : "Solid"} collision uses 32 px navigation cells. Pad the canvas rather than stretching the art.`
        : "";
    }
    if (padDimensions) {
      padDimensions.hidden = !needsGridPadding || !canPadNativeCanvas;
      padDimensions.disabled = jobActive;
      if (needsGridPadding && canPadNativeCanvas && nativeDimensions) {
        try {
          const padded = gridPaddedProductionAssetDimensions(nativeDimensions);
          padDimensions.textContent = `Pad transparently to ${padded.width}\u00d7${padded.height}`;
        } catch {
          padDimensions.hidden = true;
        }
      }
    }
  };
  const syncAspectRatio = (axis: "width" | "height") => {
    if (!sourceDimensions || !field<HTMLInputElement>(form, "lockAspectRatio").checked) return;
    const width = field<HTMLInputElement>(form, "targetWidth");
    const height = field<HTMLInputElement>(form, "targetHeight");
    const changed = Number(axis === "width" ? width.value : height.value);
    if (!Number.isInteger(changed) || changed < 1 || changed > 4_096) return;
    const projected = aspectLockedProductionAssetDimensions(sourceDimensions, axis, changed);
    if (axis === "width") height.value = String(projected.height);
    else width.value = String(projected.width);
  };
  const useSourceDimensions = (dimensions: Readonly<ProductionAssetDimensions>) => {
    sourceDimensions = dimensions;
    if (field<HTMLInputElement>(form, "keepOriginalDimensions").checked) {
      canvasSizing = "native";
      field<HTMLInputElement>(form, "targetWidth").value = String(dimensions.width);
      field<HTMLInputElement>(form, "targetHeight").value = String(dimensions.height);
    }
    updateDimensionControls();
  };
  const readSourceDimensions = async (bytes: ArrayBuffer, revision: number) => {
    const dimensions = productionAssetPngDimensions(new Uint8Array(bytes));
    if (revision !== dimensionReadRevision) return;
    useSourceDimensions(dimensions);
  };
  const applyDefaults = (family: ProductionAssetFamily, name?: string) => {
    const selected: ProductionAssetFamilyDefaults = PRODUCTION_ASSET_FAMILY_DEFAULTS[family];
    if (!sourceDimensions) {
      field<HTMLInputElement>(form, "targetWidth").value = String(selected.targetWidth);
      field<HTMLInputElement>(form, "targetHeight").value = String(selected.targetHeight);
    }
    field<HTMLSelectElement>(form, "layerRole").value = selected.layerRole;
    field<HTMLSelectElement>(form, "collisionSemantics").value = selected.collisionSemantics;
    field<HTMLSelectElement>(form, "runtimeCategory").value = selected.runtimeCategory;
    if (defaults) defaults.textContent = `Family defaults: ${selected.summary}. You can adjust them before preparation.`;
    const assetName = name ?? field<HTMLInputElement>(form, "name").value;
    field<HTMLInputElement>(form, "id").value = suggestedProductionAssetId(assetName, family);
    updateIdentityAvailability();
    updateDimensionControls();
  };
  const renderJob = (job: IntakeJob) => {
    currentJob = job;
    if (progress) progress.hidden = false;
    if (progressOutput) progressOutput.value = job.message;
    if (progressBar) {
      const phases: Record<string, number> = { queued: 0, validating: 1, writing: 2, preparing: 3, completed: 4 };
      progressBar.value = phases[job.phase] ?? (job.status === "completed" ? 4 : 1);
    }
    const active = ["queued", "running", "cancelling"].includes(job.status);
    if (submit) submit.hidden = active || job.status === "completed";
    if (cancel) cancel.hidden = !active;
    if (openCandidate) openCandidate.hidden = job.status !== "completed";
    for (const control of form.elements) {
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.disabled = active;
    }
    updateIdentityAvailability(active);
    updateDimensionControls(active);
    if (job.status === "failed") {
      showErrors(job.fieldErrors ?? { form: job.message });
      if (submit) submit.textContent = "Retry preparation";
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
    } else if (job.status === "cancelled") {
      showErrors({ form: job.message });
      if (submit) submit.textContent = "Retry preparation";
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
    } else if (job.status === "completed") {
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
      if (focusedFamily === "island" && job.recipeId) onCompleted(job.recipeId);
    }
  };
  const poll = async (jobId: string): Promise<void> => {
    window.clearTimeout(pollTimer);
    try {
      const response = await fetch(`${PRODUCTION_ASSET_INTAKE_ROUTE}/${jobId}`);
      const payload = await response.json() as IntakeJob & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Intake status failed with HTTP ${response.status}`);
      renderJob(payload);
      if (["queued", "running", "cancelling"].includes(payload.status)) {
        pollTimer = window.setTimeout(() => { void poll(jobId); }, 250);
      }
    } catch (error) {
      showErrors({ form: error instanceof Error ? error.message : "Could not read intake progress" });
      pollTimer = window.setTimeout(() => { void poll(jobId); }, 750);
    }
  };

  field<HTMLSelectElement>(form, "family").addEventListener("change", (event) => {
    applyDefaults((event.currentTarget as HTMLSelectElement).value as ProductionAssetFamily);
  });
  field<HTMLInputElement>(form, "sourceFile").addEventListener("change", (event) => {
    const revision = ++dimensionReadRevision;
    sourceDimensions = undefined;
    const sourceFile = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!sourceFile) {
      sourceReadPending = false;
      updateIdentityAvailability();
      updateDimensionControls();
      return;
    }
    sourceReadPending = true;
    const name = field<HTMLInputElement>(form, "name");
    const fileName = productionAssetNameFromFileName(sourceFile.name);
    if (fileName && (!nameEdited || name.value.trim() === "")) {
      name.value = fileName;
      const family = field<HTMLSelectElement>(form, "family").value as ProductionAssetFamily;
      field<HTMLInputElement>(form, "id").value = suggestedProductionAssetId(fileName, family);
    }
    updateIdentityAvailability();
    void sourceFile.arrayBuffer()
      .then((bytes) => readSourceDimensions(bytes, revision))
      .catch((error) => {
        if (revision !== dimensionReadRevision) return;
        showErrors({ source: error instanceof Error ? error.message : "Could not read PNG dimensions" });
        updateDimensionControls();
      })
      .finally(() => {
        if (revision === dimensionReadRevision) {
          sourceReadPending = false;
          updateIdentityAvailability();
        }
      });
  });
  field<HTMLInputElement>(form, "keepOriginalDimensions").addEventListener("change", (event) => {
    const keepOriginal = (event.currentTarget as HTMLInputElement).checked;
    canvasSizing = keepOriginal ? "native" : "resize";
    if (keepOriginal && sourceDimensions) {
      field<HTMLInputElement>(form, "targetWidth").value = String(sourceDimensions.width);
      field<HTMLInputElement>(form, "targetHeight").value = String(sourceDimensions.height);
    }
    updateDimensionControls();
  });
  field<HTMLInputElement>(form, "lockAspectRatio").addEventListener("change", (event) => {
    if ((event.currentTarget as HTMLInputElement).checked) syncAspectRatio("width");
    updateDimensionControls();
  });
  field<HTMLInputElement>(form, "targetWidth").addEventListener("input", () => {
    canvasSizing = "resize";
    syncAspectRatio("width");
    updateDimensionControls();
  });
  field<HTMLInputElement>(form, "targetHeight").addEventListener("input", () => {
    canvasSizing = "resize";
    syncAspectRatio("height");
    updateDimensionControls();
  });
  field<HTMLSelectElement>(form, "collisionSemantics").addEventListener("change", () => updateDimensionControls());
  padDimensions?.addEventListener("click", () => {
    try {
      if (!sourceDimensions) throw new RangeError("Choose a PNG before padding its canvas");
      const padded = gridPaddedProductionAssetDimensions(sourceDimensions);
      canvasSizing = "native";
      field<HTMLInputElement>(form, "keepOriginalDimensions").checked = false;
      field<HTMLInputElement>(form, "lockAspectRatio").checked = false;
      field<HTMLInputElement>(form, "targetWidth").value = String(padded.width);
      field<HTMLInputElement>(form, "targetHeight").value = String(padded.height);
      updateDimensionControls();
    } catch (error) {
      showErrors({ targetWidth: error instanceof Error ? error.message : "Could not pad canvas dimensions" });
    }
  });
  field<HTMLInputElement>(form, "name").addEventListener("input", () => {
    nameEdited = true;
    const family = field<HTMLSelectElement>(form, "family").value as ProductionAssetFamily;
    field<HTMLInputElement>(form, "id").value = suggestedProductionAssetId(field<HTMLInputElement>(form, "name").value, family);
    updateIdentityAvailability();
  });
  field<HTMLInputElement>(form, "id").addEventListener("input", () => updateIdentityAvailability());
  close?.addEventListener("click", () => dialog.close());
  cancel?.addEventListener("click", () => {
    if (!currentJob) return;
    void fetch(`${PRODUCTION_ASSET_INTAKE_ROUTE}/${currentJob.jobId}`, { method: "DELETE" })
      .then(() => poll(currentJob!.jobId));
  });
  openCandidate?.addEventListener("click", () => {
    if (currentJob?.recipeId) onCompleted(currentJob.recipeId);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      clearErrors();
      if (!updateIdentityAvailability()) return;
      const sourceFile = field<HTMLInputElement>(form, "sourceFile").files?.[0];
      if (!reference && !sourceFile) {
        showErrors({ source: "Choose a local PNG" });
        return;
      }
      if (sourceFile && sourceFile.type && sourceFile.type !== "image/png") {
        showErrors({ source: "Choose a PNG file" });
        return;
      }
      if (submit) submit.disabled = true;
      if (progress) progress.hidden = false;
      if (progressOutput) progressOutput.value = sourceFile ? "Reading local PNG…" : "Submitting repository reference…";
      try {
        const source = reference
          ? { kind: "reference", repositoryPath: reference.repositoryPath }
          : { kind: "upload", fileName: sourceFile!.name, pngBase64: base64(await sourceFile!.arrayBuffer()) };
        const response = await fetch(PRODUCTION_ASSET_INTAKE_ROUTE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            formatVersion: PRODUCTION_ASSET_INTAKE_FORMAT_VERSION,
            source,
            name: field<HTMLInputElement>(form, "name").value,
            id: field<HTMLInputElement>(form, "id").value,
            family: field<HTMLSelectElement>(form, "family").value,
            targetWidth: Number(field<HTMLInputElement>(form, "targetWidth").value),
            targetHeight: Number(field<HTMLInputElement>(form, "targetHeight").value),
            canvasSizing,
            layerRole: field<HTMLSelectElement>(form, "layerRole").value,
            collisionSemantics: field<HTMLSelectElement>(form, "collisionSemantics").value,
            runtimeCategory: field<HTMLSelectElement>(form, "runtimeCategory").value,
          }),
        });
        const payload = await response.json() as IntakeJob & { error?: string; fieldErrors?: Record<string, string> };
        if (!response.ok) {
          showErrors(payload.fieldErrors ?? { form: payload.error ?? `Intake failed with HTTP ${response.status}` });
          return;
        }
        sessionStorage.setItem(ACTIVE_JOB_KEY, payload.jobId);
        renderJob(payload);
        await poll(payload.jobId);
      } catch (error) {
        showErrors({ form: error instanceof Error ? error.message : "Asset intake could not start" });
      } finally {
        updateIdentityAvailability();
      }
    })();
  });

  const activeJobId = sessionStorage.getItem(ACTIVE_JOB_KEY);
  if (activeJobId) {
    dialog.showModal();
    void poll(activeJobId);
  }

  return {
    open(nextReference) {
      reference = nextReference;
      const revision = ++dimensionReadRevision;
      sourceDimensions = undefined;
      canvasSizing = "native";
      sourceReadPending = false;
      nameEdited = Boolean(reference);
      form.reset();
      clearErrors();
      currentJob = undefined;
      if (progress) progress.hidden = true;
      if (submit) {
        submit.hidden = false;
        submit.textContent = focusedFamily === "island" ? "Import island" : "Prepare pending candidate";
      }
      if (cancel) cancel.hidden = true;
      if (openCandidate) openCandidate.hidden = true;
      const family = focusedFamily ?? familyFor(reference);
      field<HTMLSelectElement>(form, "family").value = family;
      field<HTMLInputElement>(form, "name").value = reference?.name ?? "";
      applyDefaults(family, reference?.name);
      if (sourceSummary) sourceSummary.textContent = reference
        ? `Source reference: ${reference.name}`
        : focusedFamily === "island"
          ? "Choose one PNG. Its canvas size is read automatically and an editable centered collision circle is created."
          : "Choose one new local PNG. The source will be copied into the repository transaction.";
      if (uploadLabel) uploadLabel.hidden = Boolean(reference);
      updateDimensionControls();
      dialog.showModal();
      (reference ? field<HTMLInputElement>(form, "name") : field<HTMLInputElement>(form, "sourceFile")).focus();
      if (reference) {
        if (submit) submit.disabled = true;
        void fetch(reference.sourceUrl)
          .then((response) => {
            if (!response.ok) throw new Error(`Could not read source PNG (HTTP ${response.status})`);
            return response.arrayBuffer();
          })
          .then((bytes) => readSourceDimensions(bytes, revision))
          .catch((error) => {
            if (revision !== dimensionReadRevision) return;
            showErrors({ source: error instanceof Error ? error.message : "Could not read PNG dimensions" });
            updateDimensionControls();
          })
          .finally(() => {
            if (revision === dimensionReadRevision && submit) submit.disabled = false;
          });
      }
    },
    destroy() {
      window.clearTimeout(pollTimer);
      dialog.remove();
    },
  };
}
