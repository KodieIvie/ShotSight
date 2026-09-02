/**
 * Native-safe, typed-array implementation of the small-translation impact
 * pipeline. It intentionally mirrors the stages in tools/image-harness, but
 * does not import sharp, node built-ins, or Expo modules so it can run under
 * Hermes as well as in Vitest.
 */

export interface GrayFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface BinaryFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface LocalRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LocalBounds extends LocalRect {
  readonly right: number;
  readonly bottom: number;
}

export type LocalChangePolarity = 'darkening' | 'lightening' | 'mixed';
export type LocalSensitivity = 'low' | 'medium' | 'high';

export interface LocalRegistrationResult {
  /** Sample this many moving-image pixels right/down to get a reference pixel. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly meanAbsoluteError: number;
  readonly confidence: number;
  readonly overlapRatio: number;
  readonly registered: GrayFrame;
  readonly validMask: BinaryFrame;
}

export interface LocalComponent {
  readonly id: number;
  readonly area: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly weightedCentroidX: number;
  readonly weightedCentroidY: number;
  readonly bounds: LocalBounds;
  readonly circularity: number;
  readonly fillRatio: number;
  readonly meanDifference: number;
  readonly maxDifference: number;
  readonly meanSignedDifference: number;
  readonly polarity: LocalChangePolarity;
}

export interface LocalCandidate {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly bounds: LocalBounds;
  readonly area: number;
  readonly meanDifference: number;
  readonly maxDifference: number;
  readonly circularity: number;
  readonly fillRatio: number;
  readonly polarity: LocalChangePolarity;
  readonly confidence: number;
  readonly scores: {
    readonly locality: number;
    readonly shape: number;
    readonly size: number;
    readonly contrast: number;
  };
}

export interface LocalAnalysisOptions {
  readonly sensitivity?: LocalSensitivity;
  readonly maxShift?: number;
  readonly roi?: LocalRect;
  readonly minimumArea?: number;
  readonly maximumArea?: number;
  readonly minimumThreshold?: number;
  readonly thresholdZScore?: number;
  readonly dedupeRadius?: number;
}

export interface LocalAnalysisArtifacts {
  readonly normalizedReference: GrayFrame;
  readonly normalizedCurrent: GrayFrame;
  readonly registration: LocalRegistrationResult;
  readonly difference: GrayFrame;
  readonly signedDifference: GrayFrame;
  readonly mask: BinaryFrame;
  readonly threshold: number;
  readonly components: readonly LocalComponent[];
  readonly candidates: readonly LocalCandidate[];
}

interface SensitivityPreset {
  readonly zScore: number;
  readonly minimumThreshold: number;
  readonly minimumArea: number;
  readonly minimumNeighbors: number;
}

const PRESETS: Readonly<Record<LocalSensitivity, SensitivityPreset>> = Object.freeze({
  low: Object.freeze({ zScore: 8, minimumThreshold: 20, minimumArea: 7, minimumNeighbors: 3 }),
  medium: Object.freeze({ zScore: 6, minimumThreshold: 12, minimumArea: 5, minimumNeighbors: 2 }),
  high: Object.freeze({ zScore: 4, minimumThreshold: 8, minimumArea: 3, minimumNeighbors: 1 }),
});

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const clamp01 = (value: number): number => clamp(value, 0, 1);

function assertFiniteDimensions(frame: Pick<GrayFrame | BinaryFrame, 'width' | 'height'>): void {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1) {
    throw new RangeError('Image dimensions must be positive integers');
  }
}

export function assertSameFrameDimensions(
  left: Pick<GrayFrame | BinaryFrame, 'width' | 'height'>,
  right: Pick<GrayFrame | BinaryFrame, 'width' | 'height'>,
): void {
  assertFiniteDimensions(left);
  assertFiniteDimensions(right);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `Image dimensions must match (received ${left.width}x${left.height} and ${right.width}x${right.height})`,
    );
  }
}

/** Converts JPEG-decoder RGBA bytes to luminance without allocating four copies. */
export function rgbaToGray(
  rgba: Uint8Array,
  width: number,
  height: number,
): GrayFrame {
  if (rgba.length !== width * height * 4) {
    throw new RangeError('RGBA byte length does not match the decoded image dimensions');
  }
  const data = new Float32Array(width * height);
  for (let index = 0, pixel = 0; pixel < data.length; index += 4, pixel += 1) {
    // Rec. 709 luma keeps paper contrast more stable than a channel average.
    data[pixel] = 0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2];
  }
  return { width, height, data };
}

export function resizeGrayFrame(frame: GrayFrame, width: number, height: number): GrayFrame {
  assertFiniteDimensions(frame);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Resize dimensions must be positive integers');
  }
  if (frame.width === width && frame.height === height) {
    return { width, height, data: new Float32Array(frame.data) };
  }
  const output = new Float32Array(width * height);
  const scaleX = frame.width / width;
  const scaleY = frame.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(frame.height - 1, (y + 0.5) * scaleY - 0.5));
    const top = Math.floor(sourceY);
    const bottom = Math.min(frame.height - 1, top + 1);
    const vertical = sourceY - top;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(frame.width - 1, (x + 0.5) * scaleX - 0.5));
      const left = Math.floor(sourceX);
      const right = Math.min(frame.width - 1, left + 1);
      const horizontal = sourceX - left;
      const topValue = frame.data[top * frame.width + left] * (1 - horizontal) +
        frame.data[top * frame.width + right] * horizontal;
      const bottomValue = frame.data[bottom * frame.width + left] * (1 - horizontal) +
        frame.data[bottom * frame.width + right] * horizontal;
      output[y * width + x] = topValue * (1 - vertical) + bottomValue * vertical;
    }
  }
  return { width, height, data: output };
}

function cloneFrame(frame: GrayFrame): GrayFrame {
  return { width: frame.width, height: frame.height, data: new Float32Array(frame.data) };
}

function histogram(frame: GrayFrame, mask?: BinaryFrame): { readonly bins: Uint32Array; readonly count: number } {
  if (mask) assertSameFrameDimensions(frame, mask);
  const bins = new Uint32Array(256);
  let count = 0;
  for (let index = 0; index < frame.data.length; index += 1) {
    if (mask && mask.data[index] === 0) continue;
    bins[Math.round(clamp(frame.data[index], 0, 255))] += 1;
    count += 1;
  }
  return { bins, count };
}

function percentile(bins: Uint32Array, count: number, value: number): number {
  if (count < 1) throw new Error('Cannot calculate an image percentile from an empty region');
  const rank = clamp(value, 0, 1) * (count - 1);
  let cumulative = 0;
  for (let index = 0; index < bins.length; index += 1) {
    cumulative += bins[index];
    if (cumulative > rank) return index;
  }
  return bins.length - 1;
}

export function normalizeLocalExposure(frame: GrayFrame): GrayFrame {
  const { bins, count } = histogram(frame);
  const low = percentile(bins, count, 0.02);
  const high = percentile(bins, count, 0.98);
  if (high - low < 1) return cloneFrame(frame);
  const output = new Float32Array(frame.data.length);
  const scale = 245 / (high - low);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = clamp(5 + (frame.data[index] - low) * scale, 0, 255);
  }
  return { width: frame.width, height: frame.height, data: output };
}

function matchLocalExposure(reference: GrayFrame, moving: GrayFrame, mask: BinaryFrame): GrayFrame {
  assertSameFrameDimensions(reference, moving);
  assertSameFrameDimensions(reference, mask);
  const referenceHistogram = histogram(reference, mask);
  const movingHistogram = histogram(moving, mask);
  const referenceLow = percentile(referenceHistogram.bins, referenceHistogram.count, 0.02);
  const referenceMedian = percentile(referenceHistogram.bins, referenceHistogram.count, 0.5);
  const referenceHigh = percentile(referenceHistogram.bins, referenceHistogram.count, 0.98);
  const movingLow = percentile(movingHistogram.bins, movingHistogram.count, 0.02);
  const movingMedian = percentile(movingHistogram.bins, movingHistogram.count, 0.5);
  const movingHigh = percentile(movingHistogram.bins, movingHistogram.count, 0.98);
  const scale = clamp(
    Math.max(1, referenceHigh - referenceLow) / Math.max(1, movingHigh - movingLow),
    0.5,
    2,
  );
  const offset = referenceMedian - movingMedian * scale;
  const output = new Float32Array(moving.data.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = clamp(moving.data[index] * scale + offset, 0, 255);
  }
  return { width: moving.width, height: moving.height, data: output };
}

function normalizeRect(rect: LocalRect | undefined, frame: GrayFrame): LocalRect | undefined {
  if (!rect) return undefined;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new RangeError('ROI must have finite positive dimensions');
  }
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(frame.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(frame.height, Math.ceil(rect.y + rect.height));
  if (right <= left || bottom <= top) throw new RangeError('ROI must overlap the decoded image');
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function downsampleAverage(frame: GrayFrame, factor: number): GrayFrame {
  const divisor = Math.max(1, Math.floor(factor));
  if (divisor === 1) return cloneFrame(frame);
  const width = Math.ceil(frame.width / divisor);
  const height = Math.ceil(frame.height / divisor);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const startY = y * divisor;
    const endY = Math.min(frame.height, startY + divisor);
    for (let x = 0; x < width; x += 1) {
      const startX = x * divisor;
      const endX = Math.min(frame.width, startX + divisor);
      let sum = 0;
      let samples = 0;
      for (let sourceY = startY; sourceY < endY; sourceY += 1) {
        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          sum += frame.data[sourceY * frame.width + sourceX];
          samples += 1;
        }
      }
      data[y * width + x] = samples ? sum / samples : 0;
    }
  }
  return { width, height, data };
}

function translationError(
  reference: GrayFrame,
  moving: GrayFrame,
  offsetX: number,
  offsetY: number,
  sampleStep: number,
  roi?: LocalRect,
): number {
  const left = Math.max(0, -offsetX, roi?.x ?? 0);
  const right = Math.min(reference.width, reference.width - offsetX, roi ? roi.x + roi.width : reference.width);
  const top = Math.max(0, -offsetY, roi?.y ?? 0);
  const bottom = Math.min(reference.height, reference.height - offsetY, roi ? roi.y + roi.height : reference.height);
  if (left >= right || top >= bottom) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(sampleStep));
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const difference = Math.abs(reference.data[y * reference.width + x] - moving.data[(y + offsetY) * moving.width + x + offsetX]);
      // A small new hole must not win registration by itself.
      sum += Math.min(64, difference);
      samples += 1;
    }
  }
  return samples ? sum / samples : Number.POSITIVE_INFINITY;
}

function applyTranslation(moving: GrayFrame, offsetX: number, offsetY: number, fallback: GrayFrame): { readonly frame: GrayFrame; readonly mask: BinaryFrame } {
  const data = new Float32Array(moving.data.length);
  const valid = new Uint8Array(moving.data.length);
  for (let y = 0; y < moving.height; y += 1) {
    for (let x = 0; x < moving.width; x += 1) {
      const index = y * moving.width + x;
      const sourceX = x + offsetX;
      const sourceY = y + offsetY;
      if (sourceX >= 0 && sourceY >= 0 && sourceX < moving.width && sourceY < moving.height) {
        data[index] = moving.data[sourceY * moving.width + sourceX];
        valid[index] = 1;
      } else {
        data[index] = fallback.data[index];
      }
    }
  }
  return { frame: { width: moving.width, height: moving.height, data }, mask: { width: moving.width, height: moving.height, data: valid } };
}

function standardDeviation(frame: GrayFrame, roi?: LocalRect): number {
  const left = roi?.x ?? 0;
  const right = roi ? roi.x + roi.width : frame.width;
  const top = roi?.y ?? 0;
  const bottom = roi ? roi.y + roi.height : frame.height;
  let sum = 0;
  let squared = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const value = frame.data[y * frame.width + x];
      sum += value;
      squared += value * value;
      count += 1;
    }
  }
  return count ? Math.sqrt(Math.max(0, squared / count - (sum / count) ** 2)) : 0;
}

export function registerLocalTranslation(
  reference: GrayFrame,
  moving: GrayFrame,
  maxShift = 20,
  inputRoi?: LocalRect,
): LocalRegistrationResult {
  assertSameFrameDimensions(reference, moving);
  const roi = normalizeRect(inputRoi, reference);
  const limit = Math.max(0, Math.floor(maxShift));
  const coarseFactor = Math.max(1, Math.ceil(Math.max(reference.width, reference.height) / 320));
  const coarseReference = downsampleAverage(reference, coarseFactor);
  const coarseMoving = downsampleAverage(moving, coarseFactor);
  const coarseRoi = roi && normalizeRect({
    x: roi.x / coarseFactor,
    y: roi.y / coarseFactor,
    width: roi.width / coarseFactor,
    height: roi.height / coarseFactor,
  }, coarseReference);
  const coarseLimit = Math.ceil(limit / coarseFactor) + (coarseFactor > 1 ? 1 : 0);
  let coarseX = 0;
  let coarseY = 0;
  let coarseError = Number.POSITIVE_INFINITY;
  for (let y = -coarseLimit; y <= coarseLimit; y += 1) {
    for (let x = -coarseLimit; x <= coarseLimit; x += 1) {
      const error = translationError(coarseReference, coarseMoving, x, y, 1, coarseRoi);
      if (error < coarseError - 1e-7 || (Math.abs(error - coarseError) <= 1e-7 && Math.hypot(x, y) < Math.hypot(coarseX, coarseY))) {
        coarseError = error;
        coarseX = x;
        coarseY = y;
      }
    }
  }
  const predictedX = coarseX * coarseFactor;
  const predictedY = coarseY * coarseFactor;
  const radius = Math.max(1, coarseFactor);
  let bestX = 0;
  let bestY = 0;
  let bestError = Number.POSITIVE_INFINITY;
  let secondError = Number.POSITIVE_INFINITY;
  for (let y = Math.max(-limit, predictedY - radius); y <= Math.min(limit, predictedY + radius); y += 1) {
    for (let x = Math.max(-limit, predictedX - radius); x <= Math.min(limit, predictedX + radius); x += 1) {
      const error = translationError(reference, moving, x, y, Math.max(1, coarseFactor), roi);
      const better = error < bestError - 1e-7 || (Math.abs(error - bestError) <= 1e-7 && Math.hypot(x, y) < Math.hypot(bestX, bestY));
      if (better) {
        if (Math.abs(x - bestX) > 1 || Math.abs(y - bestY) > 1) secondError = bestError;
        bestError = error;
        bestX = x;
        bestY = y;
      } else if ((Math.abs(x - bestX) > 1 || Math.abs(y - bestY) > 1) && error < secondError) {
        secondError = error;
      }
    }
  }
  const translated = applyTranslation(moving, bestX, bestY, reference);
  const separation = Number.isFinite(secondError) ? clamp01((secondError - bestError) / Math.max(1, secondError)) : 0;
  const texture = clamp01(standardDeviation(coarseReference, coarseRoi) / 24);
  const fit = Math.exp(-bestError / 24);
  const confidence = clamp01(fit * (0.35 + 0.45 * texture + 0.2 * separation));
  const roiWidth = roi?.width ?? reference.width;
  const roiHeight = roi?.height ?? reference.height;
  const overlapRatio = Math.max(0, roiWidth - Math.abs(bestX)) * Math.max(0, roiHeight - Math.abs(bestY)) / (roiWidth * roiHeight);
  return { offsetX: bestX, offsetY: bestY, meanAbsoluteError: bestError, confidence, overlapRatio, registered: translated.frame, validMask: translated.mask };
}

function boxBlur(frame: GrayFrame, radius: number): GrayFrame {
  const r = Math.max(0, Math.floor(radius));
  if (!r) return cloneFrame(frame);
  const horizontal = new Float32Array(frame.data.length);
  const data = new Float32Array(frame.data.length);
  for (let y = 0; y < frame.height; y += 1) {
    const row = y * frame.width;
    let sum = 0;
    let start = 0;
    let end = Math.min(frame.width - 1, r);
    for (let x = start; x <= end; x += 1) sum += frame.data[row + x];
    for (let x = 0; x < frame.width; x += 1) {
      horizontal[row + x] = sum / (end - start + 1);
      const nextStart = Math.max(0, x + 1 - r);
      const nextEnd = Math.min(frame.width - 1, x + 1 + r);
      while (start < nextStart) sum -= frame.data[row + start++];
      while (end < nextEnd) sum += frame.data[row + ++end];
    }
  }
  for (let x = 0; x < frame.width; x += 1) {
    let sum = 0;
    let start = 0;
    let end = Math.min(frame.height - 1, r);
    for (let y = start; y <= end; y += 1) sum += horizontal[y * frame.width + x];
    for (let y = 0; y < frame.height; y += 1) {
      data[y * frame.width + x] = sum / (end - start + 1);
      const nextStart = Math.max(0, y + 1 - r);
      const nextEnd = Math.min(frame.height - 1, y + 1 + r);
      while (start < nextStart) sum -= horizontal[start++ * frame.width + x];
      while (end < nextEnd) sum += horizontal[++end * frame.width + x];
    }
  }
  return { width: frame.width, height: frame.height, data };
}

function generateLocalDifference(reference: GrayFrame, current: GrayFrame, validMask: BinaryFrame): { readonly difference: GrayFrame; readonly signed: GrayFrame } {
  const referenceSmooth = boxBlur(reference, 1);
  const currentSmooth = boxBlur(current, 1);
  const referenceIllumination = boxBlur(referenceSmooth, 15);
  const currentIllumination = boxBlur(currentSmooth, 15);
  const difference = new Float32Array(reference.data.length);
  const signed = new Float32Array(reference.data.length);
  for (let index = 0; index < difference.length; index += 1) {
    if (!validMask.data[index]) continue;
    const raw = currentSmooth.data[index] - referenceSmooth.data[index];
    const detail = currentSmooth.data[index] - currentIllumination.data[index] -
      (referenceSmooth.data[index] - referenceIllumination.data[index]);
    signed[index] = detail;
    difference[index] = 0.8 * Math.abs(detail) + 0.2 * Math.abs(raw);
  }
  return { difference: { width: reference.width, height: reference.height, data: difference }, signed: { width: reference.width, height: reference.height, data: signed } };
}

function pixelInRoi(x: number, y: number, roi?: LocalRect): boolean {
  return !roi || (x >= roi.x && x < roi.x + roi.width && y >= roi.y && y < roi.y + roi.height);
}

function thresholdDifference(difference: GrayFrame, validMask: BinaryFrame, roi: LocalRect | undefined, zScore: number, minimum: number): { readonly mask: BinaryFrame; readonly threshold: number } {
  const bins = new Uint32Array(256);
  let count = 0;
  for (let y = 0; y < difference.height; y += 1) {
    for (let x = 0; x < difference.width; x += 1) {
      const index = y * difference.width + x;
      if (!validMask.data[index] || !pixelInRoi(x, y, roi)) continue;
      bins[Math.round(clamp(difference.data[index], 0, 255))] += 1;
      count += 1;
    }
  }
  const median = percentile(bins, count, 0.5);
  const deviations = new Uint32Array(256);
  for (let index = 0; index < bins.length; index += 1) deviations[Math.round(Math.abs(index - median))] += bins[index];
  const mad = percentile(deviations, count, 0.5);
  const threshold = clamp(median + zScore * 1.4826 * mad, minimum, 96);
  const data = new Uint8Array(difference.data.length);
  for (let y = 0; y < difference.height; y += 1) {
    for (let x = 0; x < difference.width; x += 1) {
      const index = y * difference.width + x;
      data[index] = validMask.data[index] && pixelInRoi(x, y, roi) && difference.data[index] >= threshold ? 1 : 0;
    }
  }
  return { mask: { width: difference.width, height: difference.height, data }, threshold };
}

function dilate(mask: BinaryFrame): BinaryFrame {
  const data = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let found = false;
      for (let offsetY = -1; offsetY <= 1 && !found; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (sampleX >= 0 && sampleY >= 0 && sampleX < mask.width && sampleY < mask.height && mask.data[sampleY * mask.width + sampleX]) {
            found = true;
            break;
          }
        }
      }
      data[y * mask.width + x] = found ? 1 : 0;
    }
  }
  return { width: mask.width, height: mask.height, data };
}

function erode(mask: BinaryFrame): BinaryFrame {
  const data = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let allSet = true;
      for (let offsetY = -1; offsetY <= 1 && allSet; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (sampleX < 0 || sampleY < 0 || sampleX >= mask.width || sampleY >= mask.height || !mask.data[sampleY * mask.width + sampleX]) {
            allSet = false;
            break;
          }
        }
      }
      data[y * mask.width + x] = allSet ? 1 : 0;
    }
  }
  return { width: mask.width, height: mask.height, data };
}

function removeSparsePixels(mask: BinaryFrame, requiredNeighbors: number): BinaryFrame {
  const data = new Uint8Array(mask.data.length);
  const required = clamp(Math.floor(requiredNeighbors), 0, 8);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;
      if (!mask.data[index]) continue;
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (sampleX >= 0 && sampleY >= 0 && sampleX < mask.width && sampleY < mask.height && mask.data[sampleY * mask.width + sampleX]) neighbors += 1;
        }
      }
      data[index] = neighbors >= required ? 1 : 0;
    }
  }
  return { width: mask.width, height: mask.height, data };
}

function cleanMask(mask: BinaryFrame, minimumNeighbors: number): BinaryFrame {
  return removeSparsePixels(erode(dilate(mask)), minimumNeighbors);
}

function polarity(meanSigned: number, meanDifference: number): LocalChangePolarity {
  const significant = Math.max(2, meanDifference * 0.15);
  if (meanSigned < -significant) return 'darkening';
  if (meanSigned > significant) return 'lightening';
  return 'mixed';
}

function componentsFromMask(mask: BinaryFrame, difference: GrayFrame, signed: GrayFrame): LocalComponent[] {
  const visited = new Uint8Array(mask.data.length);
  const queue = new Int32Array(mask.data.length);
  const components: LocalComponent[] = [];
  let identifier = 0;
  for (let seed = 0; seed < mask.data.length; seed += 1) {
    if (!mask.data[seed] || visited[seed]) continue;
    identifier += 1;
    let start = 0;
    let end = 1;
    queue[0] = seed;
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
    let left = mask.width;
    let right = 0;
    let top = mask.height;
    let bottom = 0;
    while (start < end) {
      const index = queue[start++];
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      const value = difference.data[index];
      const weight = Math.max(1, value);
      area += 1;
      sumX += x;
      sumY += y;
      weightedX += x * weight;
      weightedY += y * weight;
      totalWeight += weight;
      differenceSum += value;
      signedSum += signed.data[index];
      maxDifference = Math.max(maxDifference, value);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (const [offsetX, offsetY] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const sampleX = x + offsetX;
        const sampleY = y + offsetY;
        if (sampleX < 0 || sampleY < 0 || sampleX >= mask.width || sampleY >= mask.height || !mask.data[sampleY * mask.width + sampleX]) perimeter += 1;
      }
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          if (sampleX < 0 || sampleY < 0 || sampleX >= mask.width || sampleY >= mask.height) continue;
          const neighbor = sampleY * mask.width + sampleX;
          if (mask.data[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue[end++] = neighbor;
          }
        }
      }
    }
    const width = right - left + 1;
    const height = bottom - top + 1;
    const meanDifference = differenceSum / area;
    const meanSignedDifference = signedSum / area;
    components.push({
      id: identifier,
      area,
      centroidX: sumX / area,
      centroidY: sumY / area,
      weightedCentroidX: weightedX / totalWeight,
      weightedCentroidY: weightedY / totalWeight,
      bounds: { x: left, y: top, width, height, right, bottom },
      circularity: Math.min(1, (4 * Math.PI * area) / Math.max(1, perimeter * perimeter)),
      fillRatio: area / (width * height),
      meanDifference,
      maxDifference,
      meanSignedDifference,
      polarity: polarity(meanSignedDifference, meanDifference),
    });
  }
  return components;
}

function scoreCandidates(
  components: readonly LocalComponent[],
  width: number,
  height: number,
  threshold: number,
  registrationConfidence: number,
  minimumArea: number,
  maximumArea: number | undefined,
): LocalCandidate[] {
  const maximum = Math.max(minimumArea, maximumArea ?? Math.max(200, width * height * 0.015));
  const candidates: LocalCandidate[] = [];
  for (const component of components) {
    const aspect = Math.max(component.bounds.width / component.bounds.height, component.bounds.height / component.bounds.width);
    if (component.area < minimumArea || component.area > maximum || aspect > 4 || component.fillRatio < 0.12 || component.bounds.x < 3 || component.bounds.y < 3 || component.bounds.right >= width - 3 || component.bounds.bottom >= height - 3) continue;
    const contrast = clamp01((component.meanDifference - threshold + 0.3 * (component.maxDifference - threshold)) / 64);
    const shape = clamp01(0.6 * component.circularity + 0.4 * component.fillRatio);
    const areaGrowth = 1 - Math.exp(-(component.area - minimumArea + 1) / 8);
    const size = areaGrowth * clamp01(1 - component.area / (maximum * 1.15));
    const confidence = clamp01((0.18 + 0.42 * contrast + 0.25 * shape + 0.15 * size) * (0.75 + 0.25 * registrationConfidence));
    candidates.push({
      id: component.id,
      x: component.weightedCentroidX,
      y: component.weightedCentroidY,
      bounds: component.bounds,
      area: component.area,
      meanDifference: component.meanDifference,
      maxDifference: component.maxDifference,
      circularity: component.circularity,
      fillRatio: component.fillRatio,
      polarity: component.polarity,
      confidence,
      scores: { locality: 1, shape, size, contrast },
    });
  }
  return candidates.sort((left, right) => right.confidence - left.confidence || left.y - right.y || left.x - right.x);
}

function dedupeCandidates(candidates: readonly LocalCandidate[], radius: number): readonly LocalCandidate[] {
  const accepted: LocalCandidate[] = [];
  for (const candidate of candidates) {
    if (!accepted.some((known) => Math.hypot(candidate.x - known.x, candidate.y - known.y) <= radius)) accepted.push(candidate);
  }
  return Object.freeze(accepted);
}

/** Runs the same stages as the desktop harness over already-decoded grayscale frames. */
export function analyzeLocalFrames(
  referenceInput: GrayFrame,
  currentInput: GrayFrame,
  options: LocalAnalysisOptions = {},
): LocalAnalysisArtifacts {
  assertSameFrameDimensions(referenceInput, currentInput);
  const sensitivity = options.sensitivity ?? 'medium';
  const preset = PRESETS[sensitivity];
  const roi = normalizeRect(options.roi, referenceInput);
  const normalizedReference = normalizeLocalExposure(referenceInput);
  const normalizedCurrent = normalizeLocalExposure(currentInput);
  const registration = registerLocalTranslation(normalizedReference, normalizedCurrent, options.maxShift ?? 20, roi);
  const matched = matchLocalExposure(normalizedReference, registration.registered, registration.validMask);
  const registered = new Float32Array(matched.data);
  for (let index = 0; index < registered.length; index += 1) {
    if (!registration.validMask.data[index]) registered[index] = normalizedReference.data[index];
  }
  const registeredCurrent = { width: matched.width, height: matched.height, data: registered };
  const differenceResult = generateLocalDifference(normalizedReference, registeredCurrent, registration.validMask);
  const thresholdResult = thresholdDifference(
    differenceResult.difference,
    registration.validMask,
    roi,
    options.thresholdZScore ?? preset.zScore,
    options.minimumThreshold ?? preset.minimumThreshold,
  );
  const mask = cleanMask(thresholdResult.mask, preset.minimumNeighbors);
  const components = componentsFromMask(mask, differenceResult.difference, differenceResult.signed);
  const candidates = dedupeCandidates(
    scoreCandidates(
      components,
      referenceInput.width,
      referenceInput.height,
      thresholdResult.threshold,
      registration.confidence,
      options.minimumArea ?? preset.minimumArea,
      options.maximumArea,
    ),
    options.dedupeRadius ?? 1,
  );
  return Object.freeze({
    normalizedReference,
    normalizedCurrent,
    registration: { ...registration, registered: registeredCurrent },
    difference: differenceResult.difference,
    signedDifference: differenceResult.signed,
    mask,
    threshold: thresholdResult.threshold,
    components: Object.freeze(components),
    candidates,
  });
}
