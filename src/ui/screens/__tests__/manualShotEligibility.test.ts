import { describe, expect, it } from 'vitest';

import type { Capture, Target } from '../../../domain';
import { captureCoordinateSpace } from '../../../domain';
import { getManualShotEligibility } from '../manualShotEligibility';

function baseline(): Capture {
  const value: Capture = {
    id: 'baseline', sessionId: 'session-1', targetId: 'target-1', cameraProfileId: 'camera-1',
    sequenceNumber: 1, baselineRevision: 1, capturedAt: '2026-09-01T12:00:00.000Z',
    originalImageUri: 'file:///baseline.jpg', widthPixels: 2000, heightPixels: 1500,
    kind: 'baseline', analysisStatus: 'completed', cameraMetadata: { source: 'http-snapshot' },
  };
  return Object.freeze(value);
}

function target(): Target {
  const value: Target = {
    id: 'target-1', sessionId: 'session-1', name: 'Paper', type: 'paper',
    baseline: { captureId: 'baseline', revision: 1, establishedAt: '2026-09-01T12:00:00.000Z', reason: 'initial' },
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
  };
  return Object.freeze(value);
}

function observation(registered: boolean): Capture {
  const cleanBaseline = baseline();
  const value: Capture = {
    ...cleanBaseline,
    id: 'observation', sequenceNumber: 2, kind: 'observation',
    targetMetadata: registered ? {
      registrationTransform: {
        matrix: [1, 0, -2, 0, 1, 3, 0, 0, 1] as const,
        sourceSpace: captureCoordinateSpace({ id: 'observation' }),
        destinationSpace: captureCoordinateSpace(cleanBaseline),
      },
    } : undefined,
  };
  return Object.freeze(value);
}

describe('manual shot eligibility', () => {
  it('allows a baseline or registered current observation', () => {
    const cleanBaseline = baseline();
    const registered = observation(true);

    expect(getManualShotEligibility(cleanBaseline, target(), [cleanBaseline, registered]).eligible).toBe(true);
    expect(getManualShotEligibility(registered, target(), [cleanBaseline, registered]).eligible).toBe(true);
  });

  it('requires registration before an observation can be marked', () => {
    const cleanBaseline = baseline();
    const unregistered = observation(false);

    expect(getManualShotEligibility(unregistered, target(), [cleanBaseline, unregistered])).toEqual({
      eligible: false,
      reason: 'Run Detect or Search hard first to register this capture to the clean baseline.',
    });
  });

  it('rejects historical captures after a target reset', () => {
    const cleanBaseline = baseline();
    const historical = observation(true);
    const resetBaseline: Capture = Object.freeze({
      ...cleanBaseline,
      id: 'reset-baseline',
      sequenceNumber: 3,
      baselineRevision: 2,
      kind: 'reset-baseline',
    });
    const resetTarget: Target = Object.freeze({
      ...target(),
      baseline: {
        captureId: resetBaseline.id,
        revision: 2,
        establishedAt: '2026-09-01T13:00:00.000Z',
        reason: 'target-reset' as const,
      },
    });

    expect(getManualShotEligibility(historical, resetTarget, [cleanBaseline, resetBaseline, historical]).eligible).toBe(false);
  });
});
