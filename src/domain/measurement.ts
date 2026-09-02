import type { CalibrationScale } from "./calibration";
import {
  pixelDistanceToInches,
  pixelVectorToInches,
  validateCalibrationScale,
} from "./calibration";
import { distanceBetween, type PixelPoint } from "./common";
import type { Shot } from "./shot";

const INCHES_PER_YARD = 36;
const RADIANS_PER_MOA = Math.PI / (180 * 60);

function assertDistance(distanceYards: number): void {
  if (!Number.isFinite(distanceYards) || distanceYards <= 0) {
    throw new RangeError("distanceYards must be a positive finite number");
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

/** Exact angular conversion using atan, rather than the 1-inch-per-100yd shortcut. */
export function linearInchesToMoa(
  linearInches: number,
  distanceYards: number,
): number {
  assertDistance(distanceYards);
  if (!Number.isFinite(linearInches)) {
    throw new RangeError("linearInches must be finite");
  }
  const radians = Math.atan(linearInches / (distanceYards * INCHES_PER_YARD));
  return radians / RADIANS_PER_MOA;
}

/** Exact milliradian conversion using atan. */
export function linearInchesToMil(
  linearInches: number,
  distanceYards: number,
): number {
  assertDistance(distanceYards);
  if (!Number.isFinite(linearInches)) {
    throw new RangeError("linearInches must be finite");
  }
  return Math.atan(linearInches / (distanceYards * INCHES_PER_YARD)) * 1_000;
}

export function moaToLinearInches(moa: number, distanceYards: number): number {
  assertDistance(distanceYards);
  if (!Number.isFinite(moa)) throw new RangeError("moa must be finite");
  return Math.tan(moa * RADIANS_PER_MOA) * distanceYards * INCHES_PER_YARD;
}

export function milToLinearInches(mil: number, distanceYards: number): number {
  assertDistance(distanceYards);
  if (!Number.isFinite(mil)) throw new RangeError("mil must be finite");
  return Math.tan(mil / 1_000) * distanceYards * INCHES_PER_YARD;
}

export interface ExtremeSpread {
  readonly distance: number;
  readonly pointIndexes: readonly [number, number] | null;
}

/** Maximum center-point separation in the same units as the supplied points. */
export function calculateExtremeSpread(
  points: readonly PixelPoint[],
): ExtremeSpread {
  if (points.length < 2) {
    return Object.freeze({ distance: 0, pointIndexes: null });
  }
  let maximum = -1;
  let pair: readonly [number, number] = [0, 1];
  for (let left = 0; left < points.length - 1; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const distance = distanceBetween(points[left], points[right]);
      if (distance > maximum) {
        maximum = distance;
        pair = [left, right];
      }
    }
  }
  return Object.freeze({
    distance: maximum,
    pointIndexes: Object.freeze(pair),
  });
}

/** Converts a caliper-style outer-edge measurement to center-to-center size. */
export function calculateCenterToCenter(
  outerEdgeToEdgeInches: number,
  bulletDiameterInches: number,
): number {
  assertNonNegative(outerEdgeToEdgeInches, "outerEdgeToEdgeInches");
  assertNonNegative(bulletDiameterInches, "bulletDiameterInches");
  return Math.max(0, outerEdgeToEdgeInches - bulletDiameterInches);
}

export function calculateGroupCenter(
  points: readonly PixelPoint[],
): PixelPoint | null {
  if (points.length === 0) return null;
  const totals = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return Object.freeze({
    x: totals.x / points.length,
    y: totals.y / points.length,
  });
}

export interface GroupMeasurementOptions {
  readonly includeFlyers?: boolean;
  readonly bulletDiameterInches?: number;
}

export interface GroupMeasurement {
  readonly shotCount: number;
  readonly includedShotIds: readonly string[];
  readonly groupCenter: PixelPoint | null;
  readonly extremeSpreadPixels: number;
  /** Center-to-center extreme spread derived from registered hole centers. */
  readonly centerToCenterInches: number;
  /** Available when bullet diameter is known. */
  readonly outerEdgeToEdgeInches?: number;
  readonly moa: number;
  readonly mil: number;
  readonly farthestShotIds: readonly [string, string] | null;
}

export function measureShotGroup(
  shots: readonly Shot[],
  calibration: CalibrationScale,
  distanceYards: number,
  options: GroupMeasurementOptions = {},
): GroupMeasurement {
  validateCalibrationScale(calibration);
  assertDistance(distanceYards);
  if (options.bulletDiameterInches !== undefined) {
    assertNonNegative(options.bulletDiameterInches, "bulletDiameterInches");
  }
  const included = options.includeFlyers
    ? [...shots]
    : shots.filter((shot) => !shot.isFlyer);
  const groupCenter = calculateGroupCenter(included.map((shot) => shot.position));

  let maximumInches = 0;
  let maximumPixels = 0;
  let farthest: readonly [string, string] | null = null;
  for (let left = 0; left < included.length - 1; left += 1) {
    for (let right = left + 1; right < included.length; right += 1) {
      const physicalDistance = pixelDistanceToInches(
        included[left].position,
        included[right].position,
        calibration,
      );
      if (physicalDistance > maximumInches) {
        maximumInches = physicalDistance;
        maximumPixels = distanceBetween(
          included[left].position,
          included[right].position,
        );
        farthest = [included[left].id, included[right].id];
      }
    }
  }

  return Object.freeze({
    shotCount: included.length,
    includedShotIds: Object.freeze(included.map((shot) => shot.id)),
    groupCenter,
    extremeSpreadPixels: maximumPixels,
    centerToCenterInches: maximumInches,
    outerEdgeToEdgeInches:
      options.bulletDiameterInches === undefined
        ? undefined
        : maximumInches + options.bulletDiameterInches,
    moa: linearInchesToMoa(maximumInches, distanceYards),
    mil: linearInchesToMil(maximumInches, distanceYards),
    farthestShotIds: farthest ? Object.freeze(farthest) : null,
  });
}

export type HorizontalOffsetDirection = "left" | "right" | "centered";
export type VerticalOffsetDirection = "low" | "high" | "centered";

export interface AngularOffset {
  /** Positive horizontal values are right; positive vertical values are high. */
  readonly horizontalInches: number;
  readonly verticalInches: number;
  readonly horizontalMoa: number;
  readonly verticalMoa: number;
  readonly horizontalMil: number;
  readonly verticalMil: number;
}

export interface PoaPoiOffset {
  readonly pointOfAim: PixelPoint;
  readonly pointOfImpact: PixelPoint;
  readonly shotCount: number;
  readonly horizontalDirection: HorizontalOffsetDirection;
  readonly verticalDirection: VerticalOffsetDirection;
  readonly poiRelativeToPoa: AngularOffset;
  /** Equal and opposite adjustment required to move average POI to POA. */
  readonly correctionToPoa: AngularOffset;
}

function directionForHorizontal(value: number): HorizontalOffsetDirection {
  return value < 0 ? "left" : value > 0 ? "right" : "centered";
}

function directionForVertical(value: number): VerticalOffsetDirection {
  return value < 0 ? "low" : value > 0 ? "high" : "centered";
}

function angularOffset(
  horizontalInches: number,
  verticalInches: number,
  distanceYards: number,
): AngularOffset {
  return Object.freeze({
    horizontalInches,
    verticalInches,
    horizontalMoa: linearInchesToMoa(horizontalInches, distanceYards),
    verticalMoa: linearInchesToMoa(verticalInches, distanceYards),
    horizontalMil: linearInchesToMil(horizontalInches, distanceYards),
    verticalMil: linearInchesToMil(verticalInches, distanceYards),
  });
}

/**
 * Calculates average POI relative to POA. Image Y grows downward, while the
 * returned vertical measurement follows shooting convention (positive = high).
 */
export function calculatePoaPoiOffset(
  shots: readonly Shot[],
  pointOfAim: PixelPoint,
  calibration: CalibrationScale,
  distanceYards: number,
  includeFlyers = false,
): PoaPoiOffset {
  validateCalibrationScale(calibration);
  assertDistance(distanceYards);
  const included = includeFlyers
    ? shots
    : shots.filter((shot) => !shot.isFlyer);
  const pointOfImpact = calculateGroupCenter(
    included.map((shot) => shot.position),
  );
  if (!pointOfImpact) {
    throw new RangeError("At least one included shot is required");
  }
  const imageVector = pixelVectorToInches(
    pointOfAim,
    pointOfImpact,
    calibration,
  );
  const horizontalInches = imageVector.x;
  const verticalInches = -imageVector.y;
  return Object.freeze({
    pointOfAim: Object.freeze({ ...pointOfAim }),
    pointOfImpact,
    shotCount: included.length,
    horizontalDirection: directionForHorizontal(horizontalInches),
    verticalDirection: directionForVertical(verticalInches),
    poiRelativeToPoa: angularOffset(
      horizontalInches,
      verticalInches,
      distanceYards,
    ),
    correctionToPoa: angularOffset(
      -horizontalInches,
      -verticalInches,
      distanceYards,
    ),
  });
}
