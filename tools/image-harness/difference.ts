import { assertSameDimensions } from './grayscale';
import type { BinaryImage, DifferenceResult, GrayImage } from './types';

export interface DifferenceOptions {
  /** Small blur used to suppress codec noise. */
  readonly denoiseRadius?: number;
  /** Broad local mean removed to reduce gradients caused by lighting/shadows. */
  readonly illuminationRadius?: number;
  readonly detailWeight?: number;
  readonly rawWeight?: number;
}

/** A separable, edge-normalized box blur with O(width * height) complexity. */
export function boxBlur(image: GrayImage, radius: number): GrayImage {
  const integerRadius = Math.max(0, Math.floor(radius));
  if (integerRadius === 0) {
    return {
      width: image.width,
      height: image.height,
      data: new Float32Array(image.data),
    };
  }

  const horizontal = new Float32Array(image.data.length);
  const output = new Float32Array(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * image.width;
    let sum = 0;
    let start = 0;
    let end = Math.min(image.width - 1, integerRadius);
    for (let x = start; x <= end; x += 1) {
      sum += image.data[row + x];
    }
    for (let x = 0; x < image.width; x += 1) {
      horizontal[row + x] = sum / (end - start + 1);
      const nextStart = Math.max(0, x + 1 - integerRadius);
      const nextEnd = Math.min(image.width - 1, x + 1 + integerRadius);
      while (start < nextStart) {
        sum -= image.data[row + start];
        start += 1;
      }
      while (end < nextEnd) {
        end += 1;
        sum += image.data[row + end];
      }
    }
  }

  for (let x = 0; x < image.width; x += 1) {
    let sum = 0;
    let start = 0;
    let end = Math.min(image.height - 1, integerRadius);
    for (let y = start; y <= end; y += 1) {
      sum += horizontal[y * image.width + x];
    }
    for (let y = 0; y < image.height; y += 1) {
      output[y * image.width + x] = sum / (end - start + 1);
      const nextStart = Math.max(0, y + 1 - integerRadius);
      const nextEnd = Math.min(image.height - 1, y + 1 + integerRadius);
      while (start < nextStart) {
        sum -= horizontal[start * image.width + x];
        start += 1;
      }
      while (end < nextEnd) {
        end += 1;
        sum += horizontal[end * image.width + x];
      }
    }
  }

  return { width: image.width, height: image.height, data: output };
}

/**
 * Generates a locally-normalized difference rather than naive pixel subtraction.
 * `signed` is current-minus-reference after local mean removal.
 */
export function generateDifference(
  reference: GrayImage,
  current: GrayImage,
  validMask?: BinaryImage,
  options: DifferenceOptions = {},
): DifferenceResult {
  assertSameDimensions(reference, current);
  if (validMask) {
    assertSameDimensions(reference, validMask);
  }

  const denoiseRadius = Math.max(0, Math.floor(options.denoiseRadius ?? 1));
  const illuminationRadius = Math.max(
    denoiseRadius + 1,
    Math.floor(options.illuminationRadius ?? 15),
  );
  const detailWeight = Math.max(0, options.detailWeight ?? 0.8);
  const rawWeight = Math.max(0, options.rawWeight ?? 0.2);
  const totalWeight = detailWeight + rawWeight || 1;
  const referenceSmooth = boxBlur(reference, denoiseRadius);
  const currentSmooth = boxBlur(current, denoiseRadius);
  const referenceIllumination = boxBlur(referenceSmooth, illuminationRadius);
  const currentIllumination = boxBlur(currentSmooth, illuminationRadius);
  const difference = new Float32Array(reference.data.length);
  const signed = new Float32Array(reference.data.length);

  for (let index = 0; index < difference.length; index += 1) {
    if (validMask && validMask.data[index] === 0) {
      continue;
    }
    const rawSigned = currentSmooth.data[index] - referenceSmooth.data[index];
    const detailSigned =
      currentSmooth.data[index] -
      currentIllumination.data[index] -
      (referenceSmooth.data[index] - referenceIllumination.data[index]);
    signed[index] = detailSigned;
    difference[index] =
      (detailWeight * Math.abs(detailSigned) + rawWeight * Math.abs(rawSigned)) / totalWeight;
  }

  return {
    difference: { width: reference.width, height: reference.height, data: difference },
    signed: { width: reference.width, height: reference.height, data: signed },
  };
}

