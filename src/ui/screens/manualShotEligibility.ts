import { captureToBaselineTransform, type Capture, type Target } from '../../domain';

export interface ManualShotEligibility {
  readonly eligible: boolean;
  readonly reason?: string;
}

/**
 * Manual markers become part of measurement, zeroing, and playback, so they
 * must have a known position in the active baseline's coordinate system.
 */
export function getManualShotEligibility(
  capture: Capture | undefined,
  target: Target | undefined,
  captures: readonly Capture[],
): ManualShotEligibility {
  if (!capture) {
    return Object.freeze({ eligible: false, reason: 'Capture a target image first.' });
  }
  if (!target?.baseline) {
    return Object.freeze({ eligible: false, reason: 'Set a clean target baseline first.' });
  }
  if (capture.targetId !== target.id) {
    return Object.freeze({ eligible: false, reason: 'This capture belongs to a different target.' });
  }
  if (capture.baselineRevision !== target.baseline.revision) {
    return Object.freeze({ eligible: false, reason: 'This capture belongs to an older target baseline.' });
  }
  const baseline = captures.find((item) => item.id === target.baseline?.captureId);
  if (!baseline) {
    return Object.freeze({ eligible: false, reason: 'The current clean baseline is not available locally.' });
  }
  if (capture.id !== baseline.id && !captureToBaselineTransform(capture, baseline)) {
    return Object.freeze({
      eligible: false,
      reason: 'Run Detect or Search hard first to register this capture to the clean baseline.',
    });
  }
  return Object.freeze({ eligible: true });
}
