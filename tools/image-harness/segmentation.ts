import { assertSameDimensions } from './grayscale';
import type {
  BinaryImage,
  ChangePolarity,
  ConnectedComponent,
  GrayImage,
  Rect,
  ThresholdResult,
} from './types';

export interface RobustThresholdOptions {
  readonly zScore?: number;
  readonly minimumThreshold?: number;
  readonly maximumThreshold?: number;
  readonly roi?: Rect;
}

export interface MorphologyOptions {
  readonly closeRadius?: number;
  readonly openRadius?: number;
  /** Removes isolated codec speckles without eroding compact small impacts. */
  readonly minimumNeighbors?: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

function pixelIsInRect(x: number, y: number, rect?: Rect): boolean {
  return (
    !rect ||
    (x >= rect.x &&
      y >= rect.y &&
      x < rect.x + rect.width &&
      y < rect.y + rect.height)
  );
}

function floatHistogram(
  image: GrayImage,
  validMask?: BinaryImage,
  roi?: Rect,
): { bins: Uint32Array; count: number } {
  if (validMask) {
    assertSameDimensions(image, validMask);
  }
  const bins = new Uint32Array(256);
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      if ((validMask && validMask.data[index] === 0) || !pixelIsInRect(x, y, roi)) {
        continue;
      }
      const value = Math.round(clamp(image.data[index], 0, 255));
      bins[value] += 1;
      count += 1;
    }
  }
  return { bins, count };
}

function histogramQuantile(bins: Uint32Array, count: number, quantile: number): number {
  if (count <= 0) {
    throw new Error('The selected image region contains no valid pixels');
  }
  const rank = clamp(quantile, 0, 1) * Math.max(0, count - 1);
  let cumulative = 0;
  for (let value = 0; value < bins.length; value += 1) {
    cumulative += bins[value];
    if (cumulative > rank) {
      return value;
    }
  }
  return 255;
}

export function robustThreshold(
  difference: GrayImage,
  validMask?: BinaryImage,
  options: RobustThresholdOptions = {},
): ThresholdResult {
  const { bins, count } = floatHistogram(difference, validMask, options.roi);
  const median = histogramQuantile(bins, count, 0.5);
  const deviationBins = new Uint32Array(256);
  for (let value = 0; value < bins.length; value += 1) {
    deviationBins[Math.round(Math.abs(value - median))] += bins[value];
  }
  const mad = histogramQuantile(deviationBins, count, 0.5);
  const estimatedNoiseSigma = 1.4826 * mad;
  const threshold = clamp(
    median + (options.zScore ?? 6) * estimatedNoiseSigma,
    options.minimumThreshold ?? 12,
    options.maximumThreshold ?? 96,
  );
  const data = new Uint8Array(difference.data.length);

  for (let y = 0; y < difference.height; y += 1) {
    for (let x = 0; x < difference.width; x += 1) {
      const index = y * difference.width + x;
      if (
        (!validMask || validMask.data[index] !== 0) &&
        pixelIsInRect(x, y, options.roi) &&
        difference.data[index] >= threshold
      ) {
        data[index] = 1;
      }
    }
  }

  return {
    mask: { width: difference.width, height: difference.height, data },
    threshold,
    median,
    mad,
    estimatedNoiseSigma,
    sampleCount: count,
  };
}

export function dilate(mask: BinaryImage, radius = 1): BinaryImage {
  const integerRadius = Math.max(0, Math.floor(radius));
  if (integerRadius === 0) {
    return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
  }
  const output = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let found = false;
      for (let offsetY = -integerRadius; offsetY <= integerRadius && !found; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= mask.height) {
          continue;
        }
        for (let offsetX = -integerRadius; offsetX <= integerRadius; offsetX += 1) {
          const sampleX = x + offsetX;
          if (
            sampleX >= 0 &&
            sampleX < mask.width &&
            mask.data[sampleY * mask.width + sampleX] !== 0
          ) {
            found = true;
            break;
          }
        }
      }
      output[y * mask.width + x] = found ? 1 : 0;
    }
  }
  return { width: mask.width, height: mask.height, data: output };
}

export function erode(mask: BinaryImage, radius = 1): BinaryImage {
  const integerRadius = Math.max(0, Math.floor(radius));
  if (integerRadius === 0) {
    return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
  }
  const output = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let allSet = true;
      for (let offsetY = -integerRadius; offsetY <= integerRadius && allSet; offsetY += 1) {
        const sampleY = y + offsetY;
        for (let offsetX = -integerRadius; offsetX <= integerRadius; offsetX += 1) {
          const sampleX = x + offsetX;
          if (
            sampleX < 0 ||
            sampleX >= mask.width ||
            sampleY < 0 ||
            sampleY >= mask.height ||
            mask.data[sampleY * mask.width + sampleX] === 0
          ) {
            allSet = false;
            break;
          }
        }
      }
      output[y * mask.width + x] = allSet ? 1 : 0;
    }
  }
  return { width: mask.width, height: mask.height, data: output };
}

export function removeSparsePixels(mask: BinaryImage, minimumNeighbors = 2): BinaryImage {
  const required = Math.max(0, Math.min(8, Math.floor(minimumNeighbors)));
  if (required === 0) {
    return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
  }
  const output = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;
      if (mask.data[index] === 0) {
        continue;
      }
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (
            sampleX >= 0 &&
            sampleX < mask.width &&
            sampleY >= 0 &&
            sampleY < mask.height &&
            mask.data[sampleY * mask.width + sampleX] !== 0
          ) {
            neighbors += 1;
          }
        }
      }
      output[index] = neighbors >= required ? 1 : 0;
    }
  }
  return { width: mask.width, height: mask.height, data: output };
}

export function applyMorphology(
  mask: BinaryImage,
  options: MorphologyOptions = {},
): BinaryImage {
  const closeRadius = Math.max(0, Math.floor(options.closeRadius ?? 1));
  const openRadius = Math.max(0, Math.floor(options.openRadius ?? 0));
  let output = mask;
  if (closeRadius > 0) {
    output = erode(dilate(output, closeRadius), closeRadius);
  }
  if (openRadius > 0) {
    output = dilate(erode(output, openRadius), openRadius);
  }
  return removeSparsePixels(output, options.minimumNeighbors ?? 2);
}

function polarityFor(meanSignedDifference: number, meanDifference: number): ChangePolarity {
  const meaningfulChange = Math.max(2, meanDifference * 0.15);
  if (meanSignedDifference < -meaningfulChange) {
    return 'darkening';
  }
  if (meanSignedDifference > meaningfulChange) {
    return 'lightening';
  }
  return 'mixed';
}

export function connectedComponents(
  mask: BinaryImage,
  difference?: GrayImage,
  signedDifference?: GrayImage,
): ConnectedComponent[] {
  if (difference) {
    assertSameDimensions(mask, difference);
  }
  if (signedDifference) {
    assertSameDimensions(mask, signedDifference);
  }
  const visited = new Uint8Array(mask.data.length);
  const queue = new Int32Array(mask.data.length);
  const components: ConnectedComponent[] = [];
  let label = 0;

  for (let seed = 0; seed < mask.data.length; seed += 1) {
    if (mask.data[seed] === 0 || visited[seed] !== 0) {
      continue;
    }
    label += 1;
    let queueStart = 0;
    let queueEnd = 0;
    queue[queueEnd] = seed;
    queueEnd += 1;
    visited[seed] = 1;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    let differenceSum = 0;
    let signedSum = 0;
    let maxDifference = 0;
    let perimeter = 0;
    let minimumX = mask.width;
    let maximumX = 0;
    let minimumY = mask.height;
    let maximumY = 0;

    while (queueStart < queueEnd) {
      const index = queue[queueStart];
      queueStart += 1;
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      const intensity = difference?.data[index] ?? 1;
      const weight = Math.max(1, intensity);
      area += 1;
      sumX += x;
      sumY += y;
      weightedX += x * weight;
      weightedY += y * weight;
      totalWeight += weight;
      differenceSum += intensity;
      signedSum += signedDifference?.data[index] ?? 0;
      maxDifference = Math.max(maxDifference, intensity);
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);

      const cardinalNeighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [neighborX, neighborY] of cardinalNeighbors) {
        if (
          neighborX < 0 ||
          neighborX >= mask.width ||
          neighborY < 0 ||
          neighborY >= mask.height ||
          mask.data[neighborY * mask.width + neighborX] === 0
        ) {
          perimeter += 1;
        }
      }

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (
            neighborX < 0 ||
            neighborX >= mask.width ||
            neighborY < 0 ||
            neighborY >= mask.height
          ) {
            continue;
          }
          const neighborIndex = neighborY * mask.width + neighborX;
          if (mask.data[neighborIndex] !== 0 && visited[neighborIndex] === 0) {
            visited[neighborIndex] = 1;
            queue[queueEnd] = neighborIndex;
            queueEnd += 1;
          }
        }
      }
    }

    const boundsWidth = maximumX - minimumX + 1;
    const boundsHeight = maximumY - minimumY + 1;
    const meanDifference = differenceSum / area;
    const meanSignedDifference = signedSum / area;
    components.push({
      label,
      area,
      centroid: { x: sumX / area, y: sumY / area },
      weightedCentroid: {
        x: weightedX / totalWeight,
        y: weightedY / totalWeight,
      },
      bounds: {
        x: minimumX,
        y: minimumY,
        width: boundsWidth,
        height: boundsHeight,
        right: maximumX,
        bottom: maximumY,
      },
      perimeter,
      circularity: Math.min(1, (4 * Math.PI * area) / Math.max(1, perimeter * perimeter)),
      fillRatio: area / (boundsWidth * boundsHeight),
      meanDifference,
      maxDifference,
      meanSignedDifference,
      polarity: polarityFor(meanSignedDifference, meanDifference),
    });
  }
  return components;
}

