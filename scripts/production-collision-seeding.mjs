export const PRODUCTION_SHORELINE_SEED_METHOD = "prepared-alpha-connected-shoreline-v1";
export const PRODUCTION_CENTER_CIRCLE_SEED_METHOD = "prepared-canvas-centered-circle-v1";

const CENTER_CIRCLE_RADIUS_RATIO = 0.25;

const ALPHA_THRESHOLD = 64;
const MINIMUM_COMPONENT_OPAQUE_PIXELS = 4;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function checkedImage(image) {
  if (
    typeof image !== "object"
    || image === null
    || !Number.isInteger(image.width)
    || image.width < 1
    || !Number.isInteger(image.height)
    || image.height < 1
    || !(image.pixels instanceof Uint8Array)
    || image.pixels.length !== image.width * image.height * 4
  ) {
    throw new RangeError("Prepared collision input must contain positive dimensions and complete RGBA pixels");
  }
  return image;
}

function checkedGrid(image, settings) {
  const tileSize = positiveInteger(settings?.tileSize, "collision.tileSize");
  const subcellSize = positiveInteger(settings?.subcellSize, "collision.subcellSize");
  if (tileSize % subcellSize !== 0) {
    throw new RangeError("collision.subcellSize must divide collision.tileSize exactly");
  }
  if (
    image.width % tileSize !== 0
    || image.height % tileSize !== 0
    || image.width % subcellSize !== 0
    || image.height % subcellSize !== 0
  ) {
    throw new RangeError(
      `Prepared canvas ${image.width}x${image.height} must align to ${tileSize}px cells and ${subcellSize}px subcells`,
    );
  }
  return {
    tileSize,
    subcellSize,
    width: image.width / tileSize,
    height: image.height / tileSize,
    subcellColumns: image.width / subcellSize,
    subcellRows: image.height / subcellSize,
  };
}

function connectedComponents(opaqueCounts, columns, rows) {
  const visited = new Uint8Array(opaqueCounts.length);
  const components = [];
  const queue = new Int32Array(opaqueCounts.length);
  for (let start = 0; start < opaqueCounts.length; start++) {
    if (opaqueCounts[start] === 0 || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let opaquePixels = 0;
    const indexes = [];
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      indexes.push(index);
      opaquePixels += opaqueCounts[index];
      const x = index % columns;
      const y = Math.floor(index / columns);
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= columns || nextY >= rows) continue;
          const next = nextY * columns + nextX;
          if (opaqueCounts[next] === 0 || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push({ indexes, opaquePixels });
  }
  return components;
}

/**
 * Seeds an editable sparse hybrid-grid draft from prepared alpha. Connected
 * subcell components retain thin projections while isolated sub-pixel noise is
 * ignored. The result remains review data and never becomes runtime authority.
 */
export function seedPreparedShorelineCollision(imageInput, settings) {
  const image = checkedImage(imageInput);
  const grid = checkedGrid(image, settings);
  const opaqueCounts = new Uint32Array(grid.subcellColumns * grid.subcellRows);
  for (let y = 0; y < image.height; y++) {
    const subcellY = Math.floor(y / grid.subcellSize);
    for (let x = 0; x < image.width; x++) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      const subcellX = Math.floor(x / grid.subcellSize);
      opaqueCounts[subcellY * grid.subcellColumns + subcellX]++;
    }
  }

  const components = connectedComponents(opaqueCounts, grid.subcellColumns, grid.subcellRows);
  const kept = components.filter(({ opaquePixels }) => opaquePixels >= MINIMUM_COMPONENT_OPAQUE_PIXELS);
  const ignored = components.length - kept.length;
  const solidIndexes = new Set(kept.flatMap(({ indexes }) => indexes));
  const solidSubcells = [];
  let touchesCanvasEdge = false;
  for (let index = 0; index < opaqueCounts.length; index++) {
    if (!solidIndexes.has(index)) continue;
    const x = index % grid.subcellColumns;
    const y = Math.floor(index / grid.subcellColumns);
    if (x === 0 || y === 0 || x === grid.subcellColumns - 1 || y === grid.subcellRows - 1) {
      touchesCanvasEdge = true;
    }
    solidSubcells.push(Object.freeze({ x, y }));
  }

  const warnings = [];
  if (solidSubcells.length === 0) {
    warnings.push("No connected opaque shoreline met the seed threshold; author collision manually.");
  }
  if (ignored > 0) {
    warnings.push(`Ignored ${ignored} disconnected low-coverage alpha region${ignored === 1 ? "" : "s"}; review detached details.`);
  }
  if (kept.length > 1) {
    warnings.push(`Detected ${kept.length} disconnected shoreline regions; review separate land or structures.`);
  }
  if (touchesCanvasEdge) {
    warnings.push("Visible shoreline touches the prepared canvas edge; review possible cropping.");
  }
  if (solidSubcells.length / opaqueCounts.length >= 0.8) {
    warnings.push("The draft covers most of the prepared canvas; review exterior-water transparency.");
  }

  return Object.freeze({
    method: PRODUCTION_SHORELINE_SEED_METHOD,
    warnings: Object.freeze(warnings),
    grid: Object.freeze({
      width: grid.width,
      height: grid.height,
      subcellColumns: grid.subcellColumns,
      subcellRows: grid.subcellRows,
    }),
    solidSubcells: Object.freeze(solidSubcells),
  });
}

/**
 * Seeds a conservative editable island collision mask without sampling art.
 * Imported island art may include an opaque water apron, so its pixels cannot
 * distinguish navigable water from land. The initial circle occupies half the
 * shorter canvas dimension and can be refined in the island asset tool.
 */
export function seedPreparedCenterCircleCollision(imageInput, settings) {
  const image = checkedImage(imageInput);
  const grid = checkedGrid(image, settings);
  const centerX = image.width / 2;
  const centerY = image.height / 2;
  const radius = Math.min(image.width, image.height) * CENTER_CIRCLE_RADIUS_RATIO;
  const radiusSquared = radius * radius;
  const solidSubcells = [];

  for (let y = 0; y < grid.subcellRows; y++) {
    const subcellCenterY = y * grid.subcellSize + grid.subcellSize / 2;
    for (let x = 0; x < grid.subcellColumns; x++) {
      const subcellCenterX = x * grid.subcellSize + grid.subcellSize / 2;
      const offsetX = subcellCenterX - centerX;
      const offsetY = subcellCenterY - centerY;
      if (offsetX * offsetX + offsetY * offsetY > radiusSquared) continue;
      solidSubcells.push(Object.freeze({ x, y }));
    }
  }

  return Object.freeze({
    method: PRODUCTION_CENTER_CIRCLE_SEED_METHOD,
    warnings: Object.freeze([
      "Centered-circle collision is a conservative import default; refine the saved mask in the asset tool.",
    ]),
    grid: Object.freeze({
      width: grid.width,
      height: grid.height,
      subcellColumns: grid.subcellColumns,
      subcellRows: grid.subcellRows,
    }),
    solidSubcells: Object.freeze(solidSubcells),
  });
}
