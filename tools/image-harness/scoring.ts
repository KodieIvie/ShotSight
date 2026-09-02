import type { ConnectedComponent, LoadedGrayImage, ShotCandidate } from './types';

export interface CandidateScoringOptions {
  readonly threshold: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly registrationConfidence?: number;
  readonly registrationOffsetX?: number;
  readonly registrationOffsetY?: number;
  readonly currentImage?: Pick<LoadedGrayImage, 'scaleX' | 'scaleY'>;
  readonly minimumArea?: number;
  readonly maximumArea?: number;
  readonly maximumAspectRatio?: number;
  readonly edgeMargin?: number;
  readonly minimumFillRatio?: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number, digits = 3): number => {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};

/** Filters implausible regions and assigns a deterministic, explainable confidence score. */
export function scoreShotCandidates(
  components: readonly ConnectedComponent[],
  options: CandidateScoringOptions,
): ShotCandidate[] {
  const minimumArea = Math.max(1, options.minimumArea ?? 5);
  const maximumArea = Math.max(
    minimumArea,
    options.maximumArea ?? Math.max(200, options.imageWidth * options.imageHeight * 0.015),
  );
  const maximumAspectRatio = Math.max(1, options.maximumAspectRatio ?? 4);
  const edgeMargin = Math.max(0, options.edgeMargin ?? 3);
  const minimumFillRatio = clamp01(options.minimumFillRatio ?? 0.12);
  const registrationConfidence = clamp01(options.registrationConfidence ?? 1);
  const offsetX = options.registrationOffsetX ?? 0;
  const offsetY = options.registrationOffsetY ?? 0;
  const scaleX = options.currentImage?.scaleX ?? 1;
  const scaleY = options.currentImage?.scaleY ?? 1;

  const candidates: ShotCandidate[] = [];
  for (const component of components) {
    const aspectRatio = Math.max(
      component.bounds.width / component.bounds.height,
      component.bounds.height / component.bounds.width,
    );
    if (
      component.area < minimumArea ||
      component.area > maximumArea ||
      aspectRatio > maximumAspectRatio ||
      component.fillRatio < minimumFillRatio ||
      component.bounds.x < edgeMargin ||
      component.bounds.y < edgeMargin ||
      component.bounds.right >= options.imageWidth - edgeMargin ||
      component.bounds.bottom >= options.imageHeight - edgeMargin
    ) {
      continue;
    }

    const signal = clamp01(
      (component.meanDifference - options.threshold +
        0.3 * (component.maxDifference - options.threshold)) /
        64,
    );
    const shape = clamp01(0.6 * component.circularity + 0.4 * component.fillRatio);
    const areaGrowth = 1 - Math.exp(-(component.area - minimumArea + 1) / 8);
    const oversizedPenalty = clamp01(1 - component.area / (maximumArea * 1.15));
    const areaScore = areaGrowth * oversizedPenalty;
    const registrationFactor = 0.75 + 0.25 * registrationConfidence;
    const confidence = clamp01(
      (0.18 + 0.42 * signal + 0.25 * shape + 0.15 * areaScore) * registrationFactor,
    );
    const x = component.weightedCentroid.x;
    const y = component.weightedCentroid.y;
    const currentX = x + offsetX;
    const currentY = y + offsetY;

    candidates.push({
      id: component.label,
      x: round(x),
      y: round(y),
      currentX: round(currentX),
      currentY: round(currentY),
      sourceX: round(currentX / scaleX),
      sourceY: round(currentY / scaleY),
      confidence: round(confidence),
      area: component.area,
      bounds: component.bounds,
      meanDifference: round(component.meanDifference),
      maxDifference: round(component.maxDifference),
      circularity: round(component.circularity),
      polarity: component.polarity,
    });
  }

  return candidates.sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.x - right.x;
  });
}

