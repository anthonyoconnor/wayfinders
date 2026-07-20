import type { GreatHallPresentationModel } from "../../rendering/greatHall/GreatHallPresentationModel";

export type GreatHallPreviewViewport = "desktop" | "narrow";

export function buildGreatHallPreviewWorkbenchMarkup(
  model: Readonly<GreatHallPresentationModel>,
  viewport: GreatHallPreviewViewport,
): string {
  const selected = model.navigators[model.selectedGeneration - 1]!;
  return `<section class="gh-preview-workbench">
      <header><div><p class="eyebrow">Selected memorial</p><h3>Generation ${selected.generation}</h3></div><span>${selected.state}</span></header>
      <label>Preview width <select data-gh-control="viewport"><option value="desktop" ${viewport === "desktop" ? "selected" : ""}>Desktop</option><option value="narrow" ${viewport === "narrow" ? "selected" : ""}>Narrow</option></select></label>
      <dl><div><dt>Contract</dt><dd>V${model.version}</dd></div><div><dt>Visible ceiling</dt><dd>12 portraits</dd></div><div><dt>Portrait asset</dt><dd><code>${selected.portraitUrl.split("/").at(-1)}</code></dd></div></dl>
      <p class="gh-preview-readonly">View-only fixture host. Selection, era paging, voyages, symbols, exact detail, and ceremony markup belong to the shared renderer.</p>
    </section>`;
}
