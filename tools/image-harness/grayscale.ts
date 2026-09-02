import sharp from 'sharp';

import type { BinaryImage, GrayImage, LoadedGrayImage } from './types';

export interface LoadGrayImageOptions {
  /** Longest processing edge. Set to 0 to retain full resolution. */
  readonly maxDimension?: number;
  /** Force an exact processing size (used to match a reference capture). */
  readonly width?: number;
  readonly height?: number;
}

export interface NormalizeExposureOptions {
  readonly lowPercentile?: number;
  readonly highPercentile?: number;
  readonly outputLow?: number;
  readonly outputHigh?: number;
}

export interface MatchExposureOptions {
  readonly lowPercentile?: number;
  readonly medianPercentile?: number;
  readonly highPercentile?: number;
  readonly minimumScale?: number;
  readonly maximumScale?: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export function assertSameDimensions(
  left: Pick<GrayImage, 'width' | 'height'>,
  right: Pick<GrayImage, 'width' | 'height'>,
): void {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `Image dimensions must match (received ${left.width}x${left.height} and ${right.width}x${right.height})`,
    );
  }
}

export function cloneGrayImage(image: GrayImage): GrayImage {
  return {
    width: image.width,
    height: image.height,
    data: new Float32Array(image.data),
  };
}

export async function loadGrayImage(
  imagePath: string,
  options: LoadGrayImageOptions = {},
): Promise<LoadedGrayImage> {
  const metadata = await sharp(imagePath).metadata();
  const sourceWidth = metadata.autoOrient.width;
  const sourceHeight = metadata.autoOrient.height;
  let operation = sharp(imagePath).autoOrient().greyscale();

  if (options.width !== undefined || options.height !== undefined) {
    if (!options.width || !options.height) {
      throw new Error('Both width and height are required when forcing an image size');
    }
    operation = operation.resize(options.width, options.height, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    });
  } else if ((options.maxDimension ?? 1600) > 0) {
    const maxDimension = options.maxDimension ?? 1600;
    operation = operation.resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    });
  }

  const { data, info } = await operation.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) {
    throw new Error(`Expected one grayscale channel, received ${info.channels}`);
  }

  return {
    path: imagePath,
    width: info.width,
    height: info.height,
    sourceWidth,
    sourceHeight,
    scaleX: info.width / sourceWidth,
    scaleY: info.height / sourceHeight,
    data: Float32Array.from(data),
  };
}

function histogram(image: GrayImage, mask?: BinaryImage): { bins: Uint32Array; count: number } {
  if (mask) {
    assertSameDimensions(image, mask);
  }

  const bins = new Uint32Array(256);
  let count = 0;
  for (let index = 0; index < image.data.length; index += 1) {
    if (mask && mask.data[index] === 0) {
      continue;
    }
    const bin = Math.round(clamp(image.data[index], 0, 255));
    bins[bin] += 1;
    count += 1;
  }
  return { bins, count };
}

function percentileFromHistogram(bins: Uint32Array, count: number, percentile: number): number {
  if (count === 0) {
    throw new Error('Cannot calculate a percentile from an empty image region');
  }
  const desiredRank = clamp(percentile, 0, 1) * Math.max(0, count - 1);
  let cumulative = 0;
  for (let value = 0; value < bins.length; value += 1) {
    cumulative += bins[value];
    if (cumulative > desiredRank) {
      return value;
    }
  }
  return 255;
}

export function imagePercentile(
  image: GrayImage,
  percentile: number,
  mask?: BinaryImage,
): number {
  const { bins, count } = histogram(image, mask);
  return percentileFromHistogram(bins, count, percentile);
}

export function normalizeExposure(
  image: GrayImage,
  options: NormalizeExposureOptions = {},
): GrayImage {
  const lowPercentile = options.lowPercentile ?? 0.02;
  const highPercentile = options.highPercentile ?? 0.98;
  if (lowPercentile >= highPercentile) {
    throw new Error('lowPercentile must be less than highPercentile');
  }

  const low = imagePercentile(image, lowPercentile);
  const high = imagePercentile(image, highPercentile);
  if (high - low < 1) {
    return cloneGrayImage(image);
  }

  const outputLow = options.outputLow ?? 5;
  const outputHigh = options.outputHigh ?? 250;
  const scale = (outputHigh - outputLow) / (high - low);
  const normalized = new Float32Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    normalized[index] = clamp(outputLow + (image.data[index] - low) * scale, 0, 255);
  }

  return { width: image.width, height: image.height, data: normalized };
}

/**
 * Robustly maps a moving image's contrast and median to the reference image.
 * Percentiles make this insensitive to a small newly-created impact region.
 */
export function matchExposure(
  reference: GrayImage,
  moving: GrayImage,
  mask?: BinaryImage,
  options: MatchExposureOptions = {},
): GrayImage {
  assertSameDimensions(reference, moving);
  if (mask) {
    assertSameDimensions(reference, mask);
  }

  const lowPercentile = options.lowPercentile ?? 0.02;
  const medianPercentile = options.medianPercentile ?? 0.5;
  const highPercentile = options.highPercentile ?? 0.98;
  const referenceLow = imagePercentile(reference, lowPercentile, mask);
  const referenceMedian = imagePercentile(reference, medianPercentile, mask);
  const referenceHigh = imagePercentile(reference, highPercentile, mask);
  const movingLow = imagePercentile(moving, lowPercentile, mask);
  const movingMedian = imagePercentile(moving, medianPercentile, mask);
  const movingHigh = imagePercentile(moving, highPercentile, mask);

  const referenceSpan = Math.max(1, referenceHigh - referenceLow);
  const movingSpan = Math.max(1, movingHigh - movingLow);
  let scale = clamp(
    referenceSpan / movingSpan,
    options.minimumScale ?? 0.5,
    options.maximumScale ?? 2,
  );
  let offset = referenceMedian - movingMedian * scale;

  // Refine the marginal-percentile estimate using aligned pixel pairs. First
  // center residuals by their median, then reject localized changes and fit the
  // remaining inliers. This prevents a new dark hole from changing a histogram
  // percentile enough to create a frame-wide false difference.
  const residualHistogram = new Uint32Array(511);
  let residualCount = 0;
  for (let index = 0; index < moving.data.length; index += 1) {
    if (mask && mask.data[index] === 0) {
      continue;
    }
    const residual = clamp(
      Math.round(reference.data[index] - (moving.data[index] * scale + offset)),
      -255,
      255,
    );
    residualHistogram[residual + 255] += 1;
    residualCount += 1;
  }
  if (residualCount > 0) {
    const medianResidual = percentileFromHistogram(residualHistogram, residualCount, 0.5) - 255;
    offset += medianResidual;
    const absoluteResidualHistogram = new Uint32Array(256);
    for (let index = 0; index < moving.data.length; index += 1) {
      if (mask && mask.data[index] === 0) {
        continue;
      }
      const residual = Math.abs(
        reference.data[index] - (moving.data[index] * scale + offset),
      );
      absoluteResidualHistogram[Math.round(clamp(residual, 0, 255))] += 1;
    }
    const residualMad = percentileFromHistogram(
      absoluteResidualHistogram,
      residualCount,
      0.5,
    );
    const inlierLimit = Math.max(6, 4 * 1.4826 * residualMad);
    let sumMoving = 0;
    let sumReference = 0;
    let sumMovingSquared = 0;
    let sumProduct = 0;
    let inlierCount = 0;
    for (let index = 0; index < moving.data.length; index += 1) {
      if (mask && mask.data[index] === 0) {
        continue;
      }
      const movingValue = moving.data[index];
      const referenceValue = reference.data[index];
      const residual = referenceValue - (movingValue * scale + offset);
      if (Math.abs(residual) > inlierLimit) {
        continue;
      }
      sumMoving += movingValue;
      sumReference += referenceValue;
      sumMovingSquared += movingValue * movingValue;
      sumProduct += movingValue * referenceValue;
      inlierCount += 1;
    }
    if (inlierCount >= 16) {
      const denominator = inlierCount * sumMovingSquared - sumMoving * sumMoving;
      if (Math.abs(denominator) > 1e-6) {
        scale = clamp(
          (inlierCount * sumProduct - sumMoving * sumReference) / denominator,
          options.minimumScale ?? 0.5,
          options.maximumScale ?? 2,
        );
        offset = (sumReference - scale * sumMoving) / inlierCount;
      }
    }
  }
  const matched = new Float32Array(moving.data.length);

  for (let index = 0; index < moving.data.length; index += 1) {
    matched[index] = clamp(moving.data[index] * scale + offset, 0, 255);
  }
  return { width: moving.width, height: moving.height, data: matched };
}
