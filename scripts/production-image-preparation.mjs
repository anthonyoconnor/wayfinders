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
    throw new RangeError("Image must contain positive dimensions and a complete RGBA pixel buffer");
  }
  return {
    width: image.width,
    height: image.height,
    pixels: Buffer.from(image.pixels),
  };
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function finiteNumber(value, label, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${label} must be a finite number of at least ${minimum}`);
  }
  return value;
}

function channel(value, label) {
  return integer(value, label, 0) <= 255
    ? value
    : (() => { throw new RangeError(`${label} cannot exceed 255`); })();
}

function targetSize(preparation) {
  return {
    width: integer(preparation?.targetWidth, "preparation.targetWidth", 1),
    height: integer(preparation?.targetHeight, "preparation.targetHeight", 1),
  };
}

function pixelOffset(width, x, y) {
  return (y * width + x) * 4;
}

function colorDistance(pixels, offset, matteColor) {
  return Math.hypot(
    pixels[offset] - matteColor[0],
    pixels[offset + 1] - matteColor[1],
    pixels[offset + 2] - matteColor[2],
  );
}

/**
 * Removes only matte-colored pixels connected to the image border. A four-way
 * flood keeps enclosed instances of the same color intact, while the tolerance
 * band produces deterministic feathered alpha.
 */
export function applyConnectedBorderMatte(image, preparation) {
  const result = checkedImage(image);
  if (preparation?.mode !== "connected-border") return result;

  if (!Array.isArray(preparation.matteColor) || preparation.matteColor.length !== 3) {
    throw new RangeError("preparation.matteColor must contain three RGB channels");
  }
  const matteColor = preparation.matteColor.map((value, index) =>
    channel(value, `preparation.matteColor[${index}]`));
  const innerTolerance = finiteNumber(preparation.innerTolerance, "preparation.innerTolerance");
  const outerTolerance = finiteNumber(preparation.outerTolerance, "preparation.outerTolerance");
  if (innerTolerance > outerTolerance) {
    throw new RangeError("preparation.innerTolerance cannot exceed preparation.outerTolerance");
  }

  const pixelCount = result.width * result.height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const enqueue = (x, y) => {
    const index = y * result.width + x;
    if (visited[index]) return;
    const offset = index * 4;
    if (colorDistance(result.pixels, offset, matteColor) > outerTolerance) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < result.width; x++) {
    enqueue(x, 0);
    if (result.height > 1) enqueue(x, result.height - 1);
  }
  for (let y = 1; y < result.height - 1; y++) {
    enqueue(0, y);
    if (result.width > 1) enqueue(result.width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % result.width;
    const y = Math.floor(index / result.width);
    const offset = index * 4;
    const distance = colorDistance(result.pixels, offset, matteColor);
    const coverage = distance <= innerTolerance
      ? 0
      : outerTolerance === innerTolerance
        ? 1
        : Math.min(1, (distance - innerTolerance) / (outerTolerance - innerTolerance));
    result.pixels[offset + 3] = Math.round(result.pixels[offset + 3] * coverage);

    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < result.width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < result.height) enqueue(x, y + 1);
  }

  return result;
}

function alphaBounds(image, threshold) {
  let minimumX = image.width;
  let minimumY = image.height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.pixels[pixelOffset(image.width, x, y) + 3] <= threshold) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (maximumX < 0) return undefined;
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX + 1,
    height: maximumY - minimumY + 1,
  };
}

function placeNativeCanvas(image, target) {
  if (image.width > target.width || image.height > target.height) {
    throw new RangeError(
      `Native ${image.width}x${image.height} source canvas does not fit inside ${target.width}x${target.height}`,
    );
  }
  const output = {
    width: target.width,
    height: target.height,
    pixels: Buffer.alloc(target.width * target.height * 4),
  };
  const placement = {
    x: Math.floor((target.width - image.width) / 2),
    y: Math.floor((target.height - image.height) / 2),
    width: image.width,
    height: image.height,
  };
  for (let y = 0; y < image.height; y++) {
    image.pixels.copy(
      output.pixels,
      pixelOffset(output.width, placement.x, placement.y + y),
      pixelOffset(image.width, 0, y),
      pixelOffset(image.width, 0, y + 1),
    );
  }
  return {
    image: output,
    sourceBounds: { x: 0, y: 0, width: image.width, height: image.height },
    placement,
  };
}

function containCrop(image, sourceBounds, target) {
  const output = {
    width: target.width,
    height: target.height,
    pixels: Buffer.alloc(target.width * target.height * 4),
  };
  if (sourceBounds.width === 0 || sourceBounds.height === 0) {
    return {
      image: output,
      sourceBounds,
      placement: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  const scale = Math.min(target.width / sourceBounds.width, target.height / sourceBounds.height);
  const placement = {
    x: 0,
    y: 0,
    width: Math.min(target.width, Math.max(1, Math.round(sourceBounds.width * scale))),
    height: Math.min(target.height, Math.max(1, Math.round(sourceBounds.height * scale))),
  };
  placement.x = Math.floor((target.width - placement.width) / 2);
  placement.y = Math.floor((target.height - placement.height) / 2);

  for (let y = 0; y < placement.height; y++) {
    const sourceY = sourceBounds.y + Math.floor(y * sourceBounds.height / placement.height);
    if (sourceY < 0 || sourceY >= image.height) continue;
    for (let x = 0; x < placement.width; x++) {
      const sourceX = sourceBounds.x + Math.floor(x * sourceBounds.width / placement.width);
      if (sourceX < 0 || sourceX >= image.width) continue;
      image.pixels.copy(
        output.pixels,
        pixelOffset(output.width, placement.x + x, placement.y + y),
        pixelOffset(image.width, sourceX, sourceY),
        pixelOffset(image.width, sourceX, sourceY) + 4,
      );
    }
  }

  return { image: output, sourceBounds, placement };
}

/** Places pixels natively or trims and contain-fits them onto an exact target canvas. */
export function trimAndContainImage(image, preparation) {
  const source = checkedImage(image);
  const target = targetSize(preparation);
  if (preparation?.sizing === "native") return placeNativeCanvas(source, target);
  if (preparation?.mode === "preserve") {
    return containCrop(source, { x: 0, y: 0, width: source.width, height: source.height }, target);
  }

  const trimAlphaThreshold = integer(
    preparation?.trimAlphaThreshold ?? 0,
    "preparation.trimAlphaThreshold",
  );
  if (trimAlphaThreshold > 255) {
    throw new RangeError("preparation.trimAlphaThreshold cannot exceed 255");
  }
  const padding = integer(preparation?.padding ?? 0, "preparation.padding");
  const visibleBounds = alphaBounds(source, trimAlphaThreshold);
  if (!visibleBounds) {
    return containCrop(source, { x: 0, y: 0, width: 0, height: 0 }, target);
  }
  const sourceBounds = {
    x: visibleBounds.x - padding,
    y: visibleBounds.y - padding,
    width: visibleBounds.width + padding * 2,
    height: visibleBounds.height + padding * 2,
  };
  return containCrop(source, sourceBounds, target);
}

/** Runs the complete deterministic preparation operation for one decoded layer. */
export function prepareProductionImage(image, preparation) {
  const withoutMatte = applyConnectedBorderMatte(image, preparation);
  return trimAndContainImage(withoutMatte, preparation);
}
