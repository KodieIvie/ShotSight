/** An ISO-8601 timestamp. Kept as a string so domain objects remain serializable. */
export type IsoTimestamp = string;

/** A file/content URI owned by a platform adapter. */
export type ResourceUri = string;

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

export interface PixelRect extends PixelPoint, PixelSize {}

export interface PhysicalSizeInches {
  readonly width: number;
  readonly height: number;
}

export interface RectangleRoi {
  readonly kind: "rectangle";
  readonly rect: PixelRect;
}

export interface PolygonRoi {
  readonly kind: "polygon";
  readonly points: readonly PixelPoint[];
}

/** Coordinates are in the target's registered, full-resolution image space. */
export type TargetRoi = RectangleRoi | PolygonRoi;

export function distanceBetween(a: PixelPoint, b: PixelPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function isFinitePoint(point: PixelPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

