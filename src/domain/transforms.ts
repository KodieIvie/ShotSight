import { isFinitePoint, type PixelPoint } from "./common";

/** Row-major 3x3 matrix, suitable for affine transforms and homographies. */
export type Matrix3x3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface CoordinateTransform {
  readonly matrix: Matrix3x3;
  readonly sourceSpace: string;
  readonly destinationSpace: string;
  readonly confidence?: number;
}

export const IDENTITY_MATRIX: Matrix3x3 = Object.freeze([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

function assertFiniteMatrix(matrix: Matrix3x3): void {
  if (!matrix.every(Number.isFinite)) {
    throw new RangeError("Transform matrix values must be finite");
  }
}

/** Maps a point using homogeneous coordinates. */
export function mapPoint(point: PixelPoint, matrix: Matrix3x3): PixelPoint {
  if (!isFinitePoint(point)) {
    throw new RangeError("Point coordinates must be finite");
  }
  assertFiniteMatrix(matrix);

  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = matrix;
  const denominator = m20 * point.x + m21 * point.y + m22;
  if (Math.abs(denominator) <= Number.EPSILON) {
    throw new RangeError("Point maps to infinity under this transform");
  }

  return Object.freeze({
    x: (m00 * point.x + m01 * point.y + m02) / denominator,
    y: (m10 * point.x + m11 * point.y + m12) / denominator,
  });
}

export function mapPoints(
  points: readonly PixelPoint[],
  matrix: Matrix3x3,
): readonly PixelPoint[] {
  return Object.freeze(points.map((point) => mapPoint(point, matrix)));
}

export function mapPointThroughTransform(
  point: PixelPoint,
  transform: CoordinateTransform,
): PixelPoint {
  return mapPoint(point, transform.matrix);
}

function multiplyMatrices(left: Matrix3x3, right: Matrix3x3): Matrix3x3 {
  const result: number[] = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) {
        result[row * 3 + column] +=
          left[row * 3 + index] * right[index * 3 + column];
      }
    }
  }
  return Object.freeze(result) as unknown as Matrix3x3;
}

/** Returns a transform that applies `first`, then `second`. */
export function composeTransforms(
  first: CoordinateTransform,
  second: CoordinateTransform,
): CoordinateTransform {
  if (first.destinationSpace !== second.sourceSpace) {
    throw new RangeError(
      `Cannot compose ${first.destinationSpace} with ${second.sourceSpace}`,
    );
  }
  return Object.freeze({
    matrix: multiplyMatrices(second.matrix, first.matrix),
    sourceSpace: first.sourceSpace,
    destinationSpace: second.destinationSpace,
    confidence:
      first.confidence === undefined && second.confidence === undefined
        ? undefined
        : Math.min(first.confidence ?? 1, second.confidence ?? 1),
  });
}

export function invertMatrix(matrix: Matrix3x3): Matrix3x3 {
  assertFiniteMatrix(matrix);
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);
  if (Math.abs(determinant) <= Number.EPSILON) {
    throw new RangeError("Transform matrix is singular");
  }

  return Object.freeze([
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ]);
}

export function invertTransform(
  transform: CoordinateTransform,
): CoordinateTransform {
  return Object.freeze({
    matrix: invertMatrix(transform.matrix),
    sourceSpace: transform.destinationSpace,
    destinationSpace: transform.sourceSpace,
    confidence: transform.confidence,
  });
}

