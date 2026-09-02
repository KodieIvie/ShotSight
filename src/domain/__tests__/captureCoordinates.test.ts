import { describe, expect, it } from 'vitest';

import {
  captureCoordinateSpace,
  captureToBaselineTransform,
  isPointWithinCapture,
  mapPointThroughTransform,
  type Capture,
  type CoordinateTransform,
} from '../index';

function capture(id: string, transform?: CoordinateTransform): Capture {
  const value: Capture = {
    id,
    sessionId: 'session-1',
    targetId: 'target-1',
    cameraProfileId: 'camera-1',
    sequenceNumber: id === 'baseline' ? 1 : 2,
    baselineRevision: 1,
    capturedAt: '2026-09-01T12:00:00.000Z',
    originalImageUri: `file:///captures/${id}.jpg`,
    widthPixels: 2000,
    heightPixels: 1500,
    kind: id === 'baseline' ? 'baseline' : 'observation',
    analysisStatus: 'completed',
    cameraMetadata: { source: 'http-snapshot' },
    targetMetadata: transform ? { registrationTransform: transform } : undefined,
  };
  return Object.freeze(value);
}

describe('capture baseline coordinate safety', () => {
  it('accepts only a registration with the expected source and destination spaces', () => {
    const baseline = capture('baseline');
    const transform: CoordinateTransform = Object.freeze({
      matrix: [1, 0, -4, 0, 1, 3, 0, 0, 1] as const,
      sourceSpace: captureCoordinateSpace({ id: 'current' }),
      destinationSpace: captureCoordinateSpace(baseline),
      confidence: 0.94,
    });
    const current = capture('current', transform);

    expect(captureToBaselineTransform(current, baseline)).toBe(transform);
  });

  it('does not silently use raw observation coordinates as baseline coordinates', () => {
    const baseline = capture('baseline');
    const unregistered = capture('current');
    const wrongTarget = capture('wrong-space', Object.freeze({
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
      sourceSpace: 'capture:another',
      destinationSpace: captureCoordinateSpace(baseline),
    }));

    expect(captureToBaselineTransform(unregistered, baseline)).toBeUndefined();
    expect(captureToBaselineTransform(wrongTarget, baseline)).toBeUndefined();
  });

  it('identifies a registered point that falls outside the clean baseline', () => {
    const baseline = capture('baseline');
    const transform: CoordinateTransform = Object.freeze({
      matrix: [1, 0, -4, 0, 1, 0, 0, 0, 1] as const,
      sourceSpace: captureCoordinateSpace({ id: 'current' }),
      destinationSpace: captureCoordinateSpace(baseline),
    });
    const current = capture('current', transform);
    const mapped = mapPointThroughTransform({ x: 1, y: 200 }, transform);

    expect(captureToBaselineTransform(current, baseline)).toBe(transform);
    expect(isPointWithinCapture(mapped, baseline)).toBe(false);
    expect(isPointWithinCapture({ x: 0, y: baseline.heightPixels }, baseline)).toBe(true);
  });
});
