import type { PixelPoint } from './common';
import type { Capture } from './session';
import type { CoordinateTransform } from './transforms';

/** A durable name for the original pixel space of a capture. */
export function captureCoordinateSpace(capture: Pick<Capture, 'id'>): string {
  return `capture:${capture.id}`;
}

/**
 * Returns the persisted mapping from this capture into the active clean
 * baseline's pixel space. A missing or mismatched mapping is deliberately not
 * treated as an identity transform: doing so would silently corrupt measured
 * positions after the camera or target has moved.
 */
export function captureToBaselineTransform(
  capture: Capture,
  baseline: Capture,
): CoordinateTransform | undefined {
  if (capture.id === baseline.id) return undefined;
  const transform = capture.targetMetadata?.registrationTransform;
  if (!transform) return undefined;
  return transform.sourceSpace === captureCoordinateSpace(capture)
    && transform.destinationSpace === captureCoordinateSpace(baseline)
    ? transform
    : undefined;
}

/** True only when a point can be represented by the clean baseline image. */
export function isPointWithinCapture(
  point: PixelPoint,
  capture: Pick<Capture, 'widthPixels' | 'heightPixels'>,
): boolean {
  return Number.isFinite(capture.widthPixels)
    && capture.widthPixels > 0
    && Number.isFinite(capture.heightPixels)
    && capture.heightPixels > 0
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && point.x >= 0
    && point.x <= capture.widthPixels
    && point.y >= 0
    && point.y <= capture.heightPixels;
}
