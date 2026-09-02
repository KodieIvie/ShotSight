import { distanceBetween, type IsoTimestamp, type PixelPoint } from "./common";

export interface CalibrationScale {
  readonly pixelsPerInchX: number;
  readonly pixelsPerInchY: number;
}

export interface TargetCalibrationBase extends CalibrationScale {
  readonly id: string;
  readonly targetId: string;
  readonly calibratedAt: IsoTimestamp;
}

export interface ManualCalibration extends TargetCalibrationBase {
  readonly kind: "manual";
}

export interface KnownLineCalibration extends TargetCalibrationBase {
  readonly kind: "known-line";
  readonly reference: {
    readonly start: PixelPoint;
    readonly end: PixelPoint;
    readonly knownLengthInches: number;
  };
}

export interface KnownRectangleCalibration extends TargetCalibrationBase {
  readonly kind: "known-rectangle";
  readonly reference: {
    readonly topLeft: PixelPoint;
    readonly topRight: PixelPoint;
    readonly bottomRight: PixelPoint;
    readonly bottomLeft: PixelPoint;
    readonly knownWidthInches: number;
    readonly knownHeightInches: number;
  };
}

export type TargetCalibration =
  | ManualCalibration
  | KnownLineCalibration
  | KnownRectangleCalibration;

interface CalibrationIdentity {
  readonly id: string;
  readonly targetId: string;
  readonly calibratedAt: IsoTimestamp;
}

function assertPositiveFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number`);
  }
}

export function calculatePixelsPerInch(
  pixelLength: number,
  knownLengthInches: number,
): number {
  assertPositiveFinite(pixelLength, "pixelLength");
  assertPositiveFinite(knownLengthInches, "knownLengthInches");
  return pixelLength / knownLengthInches;
}

export function validateCalibrationScale(scale: CalibrationScale): void {
  assertPositiveFinite(scale.pixelsPerInchX, "pixelsPerInchX");
  assertPositiveFinite(scale.pixelsPerInchY, "pixelsPerInchY");
}

export function createManualCalibration(
  identity: CalibrationIdentity,
  pixelsPerInchX: number,
  pixelsPerInchY: number = pixelsPerInchX,
): ManualCalibration {
  const calibration: ManualCalibration = {
    ...identity,
    kind: "manual",
    pixelsPerInchX,
    pixelsPerInchY,
  };
  validateCalibrationScale(calibration);
  return Object.freeze(calibration);
}

export function createKnownLineCalibration(
  identity: CalibrationIdentity,
  start: PixelPoint,
  end: PixelPoint,
  knownLengthInches: number,
): KnownLineCalibration {
  const pixelLength = distanceBetween(start, end);
  const pixelsPerInch = calculatePixelsPerInch(
    pixelLength,
    knownLengthInches,
  );
  return Object.freeze({
    ...identity,
    kind: "known-line",
    pixelsPerInchX: pixelsPerInch,
    pixelsPerInchY: pixelsPerInch,
    reference: Object.freeze({
      start: Object.freeze({ ...start }),
      end: Object.freeze({ ...end }),
      knownLengthInches,
    }),
  });
}

export interface RectangleReferenceInput {
  readonly topLeft: PixelPoint;
  readonly topRight: PixelPoint;
  readonly bottomRight: PixelPoint;
  readonly bottomLeft: PixelPoint;
  readonly knownWidthInches: number;
  readonly knownHeightInches: number;
}

/** Uses opposing-edge averages, tolerating a mildly imperfect corner selection. */
export function createKnownRectangleCalibration(
  identity: CalibrationIdentity,
  input: RectangleReferenceInput,
): KnownRectangleCalibration {
  assertPositiveFinite(input.knownWidthInches, "knownWidthInches");
  assertPositiveFinite(input.knownHeightInches, "knownHeightInches");

  const averagePixelWidth =
    (distanceBetween(input.topLeft, input.topRight) +
      distanceBetween(input.bottomLeft, input.bottomRight)) /
    2;
  const averagePixelHeight =
    (distanceBetween(input.topLeft, input.bottomLeft) +
      distanceBetween(input.topRight, input.bottomRight)) /
    2;
  const calibration: KnownRectangleCalibration = {
    ...identity,
    kind: "known-rectangle",
    pixelsPerInchX: calculatePixelsPerInch(
      averagePixelWidth,
      input.knownWidthInches,
    ),
    pixelsPerInchY: calculatePixelsPerInch(
      averagePixelHeight,
      input.knownHeightInches,
    ),
    reference: Object.freeze({
      topLeft: Object.freeze({ ...input.topLeft }),
      topRight: Object.freeze({ ...input.topRight }),
      bottomRight: Object.freeze({ ...input.bottomRight }),
      bottomLeft: Object.freeze({ ...input.bottomLeft }),
      knownWidthInches: input.knownWidthInches,
      knownHeightInches: input.knownHeightInches,
    }),
  };
  validateCalibrationScale(calibration);
  return Object.freeze(calibration);
}

export interface InchVector {
  readonly x: number;
  /** Positive is down, matching image coordinates. */
  readonly y: number;
}

export function pixelVectorToInches(
  from: PixelPoint,
  to: PixelPoint,
  scale: CalibrationScale,
): InchVector {
  validateCalibrationScale(scale);
  return Object.freeze({
    x: (to.x - from.x) / scale.pixelsPerInchX,
    y: (to.y - from.y) / scale.pixelsPerInchY,
  });
}

export function pixelDistanceToInches(
  a: PixelPoint,
  b: PixelPoint,
  scale: CalibrationScale,
): number {
  const vector = pixelVectorToInches(a, b, scale);
  return Math.hypot(vector.x, vector.y);
}
