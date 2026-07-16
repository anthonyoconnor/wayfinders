import {
  PRODUCTION_ASSET_FAMILY_DEFAULTS,
  PRODUCTION_ASSET_INTAKE_FORMAT_VERSION,
  PRODUCTION_ASSET_INTAKE_ROUTE,
  suggestedProductionAssetId,
  type ProductionAssetFamilyDefaults,
} from "./ProductionAssetIntake";
import type { ProductionAssetFamily } from "./ProductionAssetRecipe";

export interface ProductionAssetIntakeReference {
  readonly name: string;
  readonly repositoryPath: string;
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
}: Readonly<{ onCompleted?: (recipeId: string) => void }> = {}): ProductionAssetIntakeUi {
  const dialog = document.createElement("dialog");
  dialog.className = "production-intake-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="production-intake-form">
      <header>
        <div><p class="eyebrow">GR-3.5 guided intake</p><h2>Import and prepare</h2></div>
        <button type="button" data-intake-close aria-label="Close">×</button>
      </header>
      <p data-intake-source-summary class="production-intake-source-summary"></p>
      <label data-intake-upload>Local PNG
        <input name="sourceFile" type="file" accept="image/png,.png">
        <small data-field-error="source"></small>
      </label>
      <div class="production-intake-grid">
        <label>Asset name<input name="name" required maxlength="80"><small data-field-error="name"></small></label>
        <label>Family<select name="family">
          <option value="island">Island</option><option value="vessel">Vessel</option>
          <option value="shoal">Shoal</option><option value="world-feature">World feature</option>
          <option value="environment">Environment</option>
        </select><small data-field-error="family"></small></label>
        <label class="production-intake-wide">Stable ID<input name="id" required maxlength="96" spellcheck="false"><small data-field-error="id"></small></label>
        <label>Width (px)<input name="targetWidth" type="number" min="1" max="4096" required><small data-field-error="targetWidth"></small></label>
        <label>Height (px)<input name="targetHeight" type="number" min="1" max="4096" required><small data-field-error="targetHeight"></small></label>
        <label>Layer role<select name="layerRole"><option value="base">Base</option><option value="overlay">Overlay</option><option value="effect">Effect</option><option value="reference">Reference</option></select><small data-field-error="layerRole"></small></label>
        <label>Collision<select name="collisionSemantics"><option value="solid">Solid draft</option><option value="passable">Explicitly passable</option></select><small data-field-error="collisionSemantics"></small></label>
        <label class="production-intake-wide">Runtime/test category<select name="runtimeCategory">
          <option value="none">None</option><option value="home-island">Home island</option>
          <option value="player-boat">Player boat</option><option value="fishing-shoal">Fishing shoal</option>
        </select><small data-field-error="runtimeCategory"></small></label>
      </div>
      <p data-intake-defaults class="production-intake-defaults"></p>
      <label class="production-intake-confirm"><input name="idConfirmed" type="checkbox"> I confirm this stable ID; import must never silently replace it.<small data-field-error="idConfirmed"></small></label>
      <div class="production-intake-progress" data-intake-progress hidden>
        <progress max="4" value="0"></progress><output></output>
      </div>
      <p data-field-error="form" class="production-intake-form-error"></p>
      <footer>
        <button type="button" data-intake-cancel hidden>Cancel job</button>
        <button type="submit" data-intake-submit>Prepare pending candidate</button>
        <button type="button" data-intake-open hidden>Open pending candidate</button>
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
  let reference: Readonly<ProductionAssetIntakeReference> | undefined;
  let currentJob: IntakeJob | undefined;
  let pollTimer: number | undefined;

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
  const applyDefaults = (family: ProductionAssetFamily, name?: string) => {
    const selected: ProductionAssetFamilyDefaults = PRODUCTION_ASSET_FAMILY_DEFAULTS[family];
    field<HTMLInputElement>(form, "targetWidth").value = String(selected.targetWidth);
    field<HTMLInputElement>(form, "targetHeight").value = String(selected.targetHeight);
    field<HTMLSelectElement>(form, "layerRole").value = selected.layerRole;
    field<HTMLSelectElement>(form, "collisionSemantics").value = selected.collisionSemantics;
    field<HTMLSelectElement>(form, "runtimeCategory").value = selected.runtimeCategory;
    if (defaults) defaults.textContent = `Family defaults: ${selected.summary}. You can adjust them before confirmation.`;
    const assetName = name ?? field<HTMLInputElement>(form, "name").value;
    field<HTMLInputElement>(form, "id").value = suggestedProductionAssetId(assetName, family);
    field<HTMLInputElement>(form, "idConfirmed").checked = false;
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
  field<HTMLInputElement>(form, "name").addEventListener("input", () => {
    const family = field<HTMLSelectElement>(form, "family").value as ProductionAssetFamily;
    field<HTMLInputElement>(form, "id").value = suggestedProductionAssetId(field<HTMLInputElement>(form, "name").value, family);
    field<HTMLInputElement>(form, "idConfirmed").checked = false;
  });
  field<HTMLInputElement>(form, "id").addEventListener("input", () => {
    field<HTMLInputElement>(form, "idConfirmed").checked = false;
  });
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
            idConfirmed: field<HTMLInputElement>(form, "idConfirmed").checked,
            family: field<HTMLSelectElement>(form, "family").value,
            targetWidth: Number(field<HTMLInputElement>(form, "targetWidth").value),
            targetHeight: Number(field<HTMLInputElement>(form, "targetHeight").value),
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
        if (submit) submit.disabled = false;
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
      form.reset();
      clearErrors();
      currentJob = undefined;
      if (progress) progress.hidden = true;
      if (submit) {
        submit.hidden = false;
        submit.textContent = "Prepare pending candidate";
      }
      if (cancel) cancel.hidden = true;
      if (openCandidate) openCandidate.hidden = true;
      const family = familyFor(reference);
      field<HTMLSelectElement>(form, "family").value = family;
      field<HTMLInputElement>(form, "name").value = reference?.name ?? "";
      applyDefaults(family, reference?.name);
      if (sourceSummary) sourceSummary.textContent = reference
        ? `Source reference: ${reference.name} (${reference.repositoryPath})`
        : "Choose one new local PNG. The source will be copied into the repository transaction.";
      if (uploadLabel) uploadLabel.hidden = Boolean(reference);
      dialog.showModal();
      (reference ? field<HTMLInputElement>(form, "name") : field<HTMLInputElement>(form, "sourceFile")).focus();
    },
    destroy() {
      window.clearTimeout(pollTimer);
      dialog.remove();
    },
  };
}
