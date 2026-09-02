import { describe, expect, it } from 'vitest';

import type { Capture, Target } from '../../../domain';
import { selectTargetToolCapture } from '../targetToolUtils';

function capture(
  id: string,
  baselineRevision: number,
  targetId = 'target-1',
): Capture {
  return Object.freeze({
    id,
    sessionId: 'session-1',
    targetId,
    cameraProfileId: 'camera-1',
    sequenceNumber: baselineRevision,
    baselineRevision,
    capturedAt: '2026-09-01T12:00:00.000Z',
    originalImageUri: `file:///captures/${id}.jpg`,
    widthPixels: 2000,
    heightPixels: 1500,
    kind: id.startsWith('baseline') ? 'baseline' : 'observation',
    analysisStatus: 'not-requested',
    cameraMetadata: Object.freeze({ source: 'http-snapshot' as const }),
  });
}

function target(): Target {
  return Object.freeze({
    id: 'target-1',
    sessionId: 'session-1',
    name: 'Paper',
    type: 'paper',
    baseline: Object.freeze({
      captureId: 'baseline-v2',
      revision: 2,
      reason: 'target-reset' as const,
      establishedAt: '2026-09-01T13:00:00.000Z',
    }),
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T13:00:00.000Z',
  });
}

describe('target tool coordinate capture', () => {
  it('uses only the active clean baseline after a reset', () => {
    const baseline = capture('baseline-v2', 2);
    const stale = capture('observation-v1', 1);
    const currentObservation = capture('observation-v2', 2);

    expect(selectTargetToolCapture(
      [stale, baseline, currentObservation],
      target(),
      stale.id,
    )).toBe(baseline);
    expect(selectTargetToolCapture(
      [stale, baseline, currentObservation],
      target(),
      currentObservation.id,
    )).toBe(baseline);
  });

  it('does not fall back to an unrelated or stale capture when the baseline is unavailable', () => {
    expect(selectTargetToolCapture(
      [capture('old-baseline', 1), capture('other-target', 2, 'target-2')],
      target(),
      'old-baseline',
    )).toBeUndefined();
  });
});
