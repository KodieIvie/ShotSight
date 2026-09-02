import { assertSameDimensions } from './grayscale';
import type { BinaryImage, GrayImage, Rect, RegistrationResult } from './types';

export interface TranslationRegistrationOptions {
  /** Maximum integer translation, in full-resolution processing pixels. */
  readonly maxShift?: number;
  /** Longest edge used for the exhaustive coarse search. */
  readonly coarseMaxDimension?: number;
  /** Difference values above this are clipped so a new hole cannot dominate alignment. */
  readonly differenceClip?: number;
  /**
   * Optional target lock in processing-image pixels. Alignment is scored only
   * inside this region, so movement outside the paper/steel target cannot pull
   * the registration away from the target itself.
   */
  readonly roi?: Rect;
}

interface OffsetScore {
  readonly x: number;
  readonly y: number;
  readonly error: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Average-pools by an integer factor. Kept public for registration-stage tests. */
export function downsampleAverage(image: GrayImage, factor: number): GrayImage {
  const integerFactor = Math.max(1, Math.floor(factor));
  if (integerFactor === 1) {
    return {
      width: image.width,
      height: image.height,
      data: new Float32Array(image.data),
    };
  }

  const width = Math.ceil(image.width / integerFactor);
  const height = Math.ceil(image.height / integerFactor);
  const output = new Float32Array(width * height);
  for (let outputY = 0; outputY < height; outputY += 1) {
    const startY = outputY * integerFactor;
    const endY = Math.min(image.height, startY + integerFactor);
    for (let outputX = 0; outputX < width; outputX += 1) {
      const startX = outputX * integerFactor;
      const endX = Math.min(image.width, startX + integerFactor);
      let sum = 0;
      let count = 0;
      for (let y = startY; y < endY; y += 1) {
        const row = y * image.width;
        for (let x = startX; x < endX; x += 1) {
          sum += image.data[row + x];
          count += 1;
        }
      }
      output[outputY * width + outputX] = count === 0 ? 0 : sum / count;
    }
  }
  return { width, height, data: output };
}

/**
 * Scores reference(x, y) against moving(x + offsetX, y + offsetY).
 * A truncated L1 loss is deliberately robust to a small new target change.
 */
export function translationError(
  reference: GrayImage,
  moving: GrayImage,
  offsetX: number,
  offsetY: number,
  sampleStep = 1,
  differenceClip = 64,
  roi?: Rect,
): number {
  assertSameDimensions(reference, moving);
  const startX = Math.max(0, -offsetX, roi?.x ?? 0);
  const endX = Math.min(
    reference.width,
    reference.width - offsetX,
    roi ? roi.x + roi.width : reference.width,
  );
  const startY = Math.max(0, -offsetY, roi?.y ?? 0);
  const endY = Math.min(
    reference.height,
    reference.height - offsetY,
    roi ? roi.y + roi.height : reference.height,
  );
  if (startX >= endX || startY >= endY) {
    return Number.POSITIVE_INFINITY;
  }

  const step = Math.max(1, Math.floor(sampleStep));
  let sum = 0;
  let count = 0;
  for (let y = startY; y < endY; y += step) {
    const referenceRow = y * reference.width;
    const movingRow = (y + offsetY) * moving.width;
    for (let x = startX; x < endX; x += step) {
      const difference = Math.abs(
        reference.data[referenceRow + x] - moving.data[movingRow + x + offsetX],
      );
      sum += Math.min(differenceClip, difference);
      count += 1;
    }
  }
  return count === 0 ? Number.POSITIVE_INFINITY : sum / count;
}

function isBetter(candidate: OffsetScore, best: OffsetScore | undefined): boolean {
  if (!best || candidate.error < best.error - 1e-7) {
    return true;
  }
  if (Math.abs(candidate.error - best.error) <= 1e-7) {
    return Math.hypot(candidate.x, candidate.y) < Math.hypot(best.x, best.y);
  }
  return false;
}

function searchOffsets(
  reference: GrayImage,
  moving: GrayImage,
  minimumX: number,
  maximumX: number,
  minimumY: number,
  maximumY: number,
  sampleStep: number,
  differenceClip: number,
  roi?: Rect,
): OffsetScore[] {
  const scores: OffsetScore[] = [];
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      scores.push({
        x,
        y,
        error: translationError(reference, moving, x, y, sampleStep, differenceClip, roi),
      });
    }
  }
  return scores;
}

function imageStandardDeviation(image: GrayImage, sampleStep: number, roi?: Rect): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  const step = Math.max(1, sampleStep);
  const startX = roi?.x ?? 0;
  const endX = roi ? roi.x + roi.width : image.width;
  const startY = roi?.y ?? 0;
  const endY = roi ? roi.y + roi.height : image.height;
  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const value = image.data[y * image.width + x];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (count === 0) {
    return 0;
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
}

function normalizeRoi(roi: Rect | undefined, image: GrayImage): Rect | undefined {
  if (!roi) return undefined;
  if (
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y) ||
    !Number.isFinite(roi.width) ||
    !Number.isFinite(roi.height) ||
    roi.width <= 0 ||
    roi.height <= 0
  ) {
    throw new RangeError('registration ROI must have finite positive width and height');
  }
  const left = Math.max(0, Math.floor(roi.x));
  const top = Math.max(0, Math.floor(roi.y));
  const right = Math.min(image.width, Math.ceil(roi.x + roi.width));
  const bottom = Math.min(image.height, Math.ceil(roi.y + roi.height));
  if (right <= left || bottom <= top) {
    throw new RangeError('registration ROI must overlap the image');
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function scaleRoi(roi: Rect | undefined, factor: number, image: GrayImage): Rect | undefined {
  if (!roi) return undefined;
  return normalizeRoi({
    x: roi.x / factor,
    y: roi.y / factor,
    width: roi.width / factor,
    height: roi.height / factor,
  }, image);
}

export function applyIntegerTranslation(
  moving: GrayImage,
  offsetX: number,
  offsetY: number,
  fallback?: GrayImage,
): { registered: GrayImage; validMask: BinaryImage } {
  if (fallback) {
    assertSameDimensions(moving, fallback);
  }
  const registered = new Float32Array(moving.data.length);
  const valid = new Uint8Array(moving.data.length);

  for (let y = 0; y < moving.height; y += 1) {
    for (let x = 0; x < moving.width; x += 1) {
      const outputIndex = y * moving.width + x;
      const sourceX = x + offsetX;
      const sourceY = y + offsetY;
      if (
        sourceX >= 0 &&
        sourceX < moving.width &&
        sourceY >= 0 &&
        sourceY < moving.height
      ) {
        registered[outputIndex] = moving.data[sourceY * moving.width + sourceX];
        valid[outputIndex] = 1;
      } else {
        registered[outputIndex] = fallback?.data[outputIndex] ?? 0;
      }
    }
  }

  return {
    registered: { width: moving.width, height: moving.height, data: registered },
    validMask: { width: moving.width, height: moving.height, data: valid },
  };
}

export function registerSmallTranslation(
  reference: GrayImage,
  moving: GrayImage,
  options: TranslationRegistrationOptions = {},
): RegistrationResult {
  assertSameDimensions(reference, moving);
  const maxShift = Math.max(0, Math.floor(options.maxShift ?? 20));
  const coarseMaxDimension = Math.max(64, options.coarseMaxDimension ?? 320);
  const differenceClip = Math.max(1, options.differenceClip ?? 64);
  const roi = normalizeRoi(options.roi, reference);
  const factor = Math.max(
    1,
    Math.ceil(Math.max(reference.width, reference.height) / coarseMaxDimension),
  );
  const coarseReference = downsampleAverage(reference, factor);
  const coarseMoving = downsampleAverage(moving, factor);
  const coarseRoi = scaleRoi(roi, factor, coarseReference);
  const coarseLimit = Math.ceil(maxShift / factor) + (factor > 1 ? 1 : 0);
  const coarseScores = searchOffsets(
    coarseReference,
    coarseMoving,
    -coarseLimit,
    coarseLimit,
    -coarseLimit,
    coarseLimit,
    1,
    differenceClip,
    coarseRoi,
  );
  let coarseBest: OffsetScore | undefined;
  for (const score of coarseScores) {
    if (isBetter(score, coarseBest)) {
      coarseBest = score;
    }
  }

  const predictedX = (coarseBest?.x ?? 0) * factor;
  const predictedY = (coarseBest?.y ?? 0) * factor;
  const refinementRadius = Math.max(1, factor);
  const minimumX = clamp(predictedX - refinementRadius, -maxShift, maxShift);
  const maximumX = clamp(predictedX + refinementRadius, -maxShift, maxShift);
  const minimumY = clamp(predictedY - refinementRadius, -maxShift, maxShift);
  const maximumY = clamp(predictedY + refinementRadius, -maxShift, maxShift);
  const fullScores = searchOffsets(
    reference,
    moving,
    minimumX,
    maximumX,
    minimumY,
    maximumY,
    Math.max(1, factor),
    differenceClip,
    roi,
  );
  let best: OffsetScore | undefined;
  for (const score of fullScores) {
    if (isBetter(score, best)) {
      best = score;
    }
  }
  if (!best) {
    best = { x: 0, y: 0, error: Number.POSITIVE_INFINITY };
  }

  const nonAdjacentScores = fullScores
    .filter((score) => Math.abs(score.x - best.x) > 1 || Math.abs(score.y - best.y) > 1)
    .sort((left, right) => left.error - right.error);
  const secondBestError = nonAdjacentScores[0]?.error ?? best.error;
  const separation = clamp((secondBestError - best.error) / Math.max(1, secondBestError), 0, 1);
  const texture = clamp(imageStandardDeviation(coarseReference, 1, coarseRoi) / 24, 0, 1);
  const fitQuality = Math.exp(-best.error / 24);
  const confidence = clamp(fitQuality * (0.35 + 0.45 * texture + 0.2 * separation), 0, 1);
  const translated = applyIntegerTranslation(moving, best.x, best.y, reference);
  const overlapWidth = Math.max(0, (roi?.width ?? reference.width) - Math.abs(best.x));
  const overlapHeight = Math.max(0, (roi?.height ?? reference.height) - Math.abs(best.y));
  const overlapArea = (roi?.width ?? reference.width) * (roi?.height ?? reference.height);
  const overlapRatio = overlapArea === 0 ? 0 : (overlapWidth * overlapHeight) / overlapArea;

  return {
    offsetX: best.x,
    offsetY: best.y,
    meanAbsoluteError: best.error,
    confidence,
    overlapRatio,
    registered: translated.registered,
    validMask: translated.validMask,
  };
}
