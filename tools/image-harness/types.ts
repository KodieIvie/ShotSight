export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface BinaryImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface LoadedGrayImage extends GrayImage {
  readonly path: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Processing pixels per source pixel. */
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBox extends Rect {
  readonly right: number;
  readonly bottom: number;
}

export interface RegistrationResult {
  /** Sample this many pixels to the right in the moving image to align it. */
  readonly offsetX: number;
  /** Sample this many pixels down in the moving image to align it. */
  readonly offsetY: number;
  readonly meanAbsoluteError: number;
  readonly confidence: number;
  readonly overlapRatio: number;
  readonly registered: GrayImage;
  readonly validMask: BinaryImage;
}

export interface DifferenceResult {
  readonly difference: GrayImage;
  /** Signed current-minus-reference detail change. */
  readonly signed: GrayImage;
}

export interface ThresholdResult {
  readonly mask: BinaryImage;
  readonly threshold: number;
  readonly median: number;
  readonly mad: number;
  readonly estimatedNoiseSigma: number;
  readonly sampleCount: number;
}

export type ChangePolarity = 'darkening' | 'lightening' | 'mixed';

export interface ConnectedComponent {
  readonly label: number;
  readonly area: number;
  readonly centroid: Point;
  readonly weightedCentroid: Point;
  readonly bounds: BoundingBox;
  readonly perimeter: number;
  readonly circularity: number;
  readonly fillRatio: number;
  readonly meanDifference: number;
  readonly maxDifference: number;
  readonly meanSignedDifference: number;
  readonly polarity: ChangePolarity;
}

export interface ShotCandidate {
  readonly id: number;
  /** Coordinates in the registered/reference processing image. */
  readonly x: number;
  readonly y: number;
  /** Corresponding location in the unregistered current processing image. */
  readonly currentX: number;
  readonly currentY: number;
  /** Coordinates mapped to the auto-oriented source image. */
  readonly sourceX: number;
  readonly sourceY: number;
  readonly confidence: number;
  readonly area: number;
  readonly bounds: BoundingBox;
  readonly meanDifference: number;
  readonly maxDifference: number;
  readonly circularity: number;
  readonly polarity: ChangePolarity;
}

export type Sensitivity = 'low' | 'medium' | 'high';

