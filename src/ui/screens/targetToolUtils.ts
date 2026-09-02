import type { Capture, Target, TargetRoi } from '../../domain';
import type { NormalizedRectangle } from '../components';

export function selectTargetToolCapture(
  captures: readonly Capture[],
  target: Target | undefined,
  requestedCaptureId?: string,
): Capture | undefined {
  const baseline = target?.baseline;
  if (!target || !baseline) return undefined;

  // ROI, calibration, and POA/desired-zero values are persisted in the clean
  // baseline's pixel space. A route can carry an old capture ID after a
  // target reset, but it must never change the coordinate surface used here.
  void requestedCaptureId;
  return captures.find((capture) => (
    capture.id === baseline.captureId
    && capture.targetId === target.id
    && capture.baselineRevision === baseline.revision
  ));
}

export function normalizeRectangleRoi(
  roi: TargetRoi | undefined,
  capture: Capture,
): NormalizedRectangle | undefined {
  if (!roi || roi.kind !== 'rectangle') return undefined;
  return Object.freeze({
    x: clamp(roi.rect.x / capture.widthPixels),
    y: clamp(roi.rect.y / capture.heightPixels),
    width: clamp(roi.rect.width / capture.widthPixels),
    height: clamp(roi.rect.height / capture.heightPixels),
  });
}

export function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function formatCalibration(
  calibration: Target['calibration'],
): string {
  if (!calibration) return 'Not calibrated';
  const kind = calibration.kind === 'known-line'
    ? 'Known line'
    : calibration.kind === 'known-rectangle'
      ? 'Known rectangle'
      : 'Manual scale';
  const x = calibration.pixelsPerInchX.toFixed(1);
  const y = calibration.pixelsPerInchY.toFixed(1);
  return `${kind} · ${x} × ${y} px/in`;
}
