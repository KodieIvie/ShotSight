import { describe, expect, it } from 'vitest';

import {
  reviewAnalysisCandidate,
  validateAnalysisCandidate,
  validateAnalysisJob,
  type AnalysisCandidate,
  type AnalysisJob,
} from '../index';

const timestamp = '2026-08-31T12:00:00.000Z';

function pendingCandidate(): AnalysisCandidate {
  return {
    id: 'candidate-1',
    jobId: 'job-1',
    sessionId: 'session-1',
    targetId: 'target-1',
    captureId: 'capture-2',
    baselineRevision: 1,
    position: { x: 120, y: 240 },
    bounds: { x: 116, y: 236, width: 8, height: 8 },
    areaPixels: 42,
    meanDifference: 28.4,
    confidence: 0.91,
    classification: 'probable-paper-impact',
    scores: {
      locality: 0.95,
      shape: 0.8,
      size: 0.73,
      contrast: 0.97,
      temporalNovelty: 0.9,
    },
    state: 'pending',
    provenance: {
      analyzerId: 'shotsight-harness',
      analyzerVersion: '1.0.0',
      referenceCaptureId: 'capture-1',
      registrationConfidence: 0.94,
      debugArtifactUris: ['file:///analysis/candidate-1-difference.png'],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function pendingJob(): AnalysisJob {
  return {
    id: 'job-1',
    sessionId: 'session-1',
    targetId: 'target-1',
    captureId: 'capture-2',
    referenceCaptureId: 'capture-1',
    baselineRevision: 1,
    referenceMode: 'clean-baseline',
    sensitivity: {
      preset: 'medium',
      minimumDifference: 12,
      minimumAreaPixels: 5,
      maximumAreaPixels: 100,
      deduplicationRadiusPixels: 8,
    },
    analyzerId: 'shotsight-harness',
    analyzerVersion: '1.0.0',
    status: 'pending',
    requestedAt: timestamp,
  };
}

describe('analysis candidate review records', () => {
  it('requires an explicit linked shot before a candidate can be confirmed', () => {
    const candidate = pendingCandidate();

    expect(() =>
      reviewAnalysisCandidate(candidate, {
        state: 'confirmed',
        reviewedAt: '2026-08-31T12:01:00.000Z',
      }),
    ).toThrow('requires confirmedShotId');

    const confirmed = reviewAnalysisCandidate(candidate, {
      state: 'confirmed',
      reviewedAt: '2026-08-31T12:01:00.000Z',
      confirmedShotId: 'shot-1',
    });

    expect(confirmed).toMatchObject({
      state: 'confirmed',
      confirmedShotId: 'shot-1',
      reviewedAt: '2026-08-31T12:01:00.000Z',
      updatedAt: '2026-08-31T12:01:00.000Z',
    });
    expect(Object.isFrozen(confirmed)).toBe(true);
    expect(Object.isFrozen(confirmed.provenance)).toBe(true);
    expect(() =>
      reviewAnalysisCandidate(confirmed, {
        state: 'rejected',
        reviewedAt: '2026-08-31T12:02:00.000Z',
      }),
    ).toThrow('already been reviewed');
  });

  it('retains a confirmed candidate audit record if its later-deleted shot link is absent', () => {
    const historical = {
      ...pendingCandidate(),
      state: 'confirmed' as const,
      reviewedAt: '2026-08-31T12:01:00.000Z',
      confirmedShotId: undefined,
      updatedAt: '2026-08-31T12:01:00.000Z',
    };

    expect(() => validateAnalysisCandidate(historical)).not.toThrow();
  });

  it('rejects review fields on a pending candidate', () => {
    expect(() =>
      validateAnalysisCandidate({
        ...pendingCandidate(),
        reviewedAt: '2026-08-31T12:01:00.000Z',
      }),
    ).toThrow('pending analysis candidate cannot have review fields');
  });
});

describe('analysis jobs', () => {
  it('requires terminal timestamps and a failure reason for failed work', () => {
    expect(() =>
      validateAnalysisJob({
        ...pendingJob(),
        status: 'failed',
        completedAt: '2026-08-31T12:03:00.000Z',
      }),
    ).toThrow('requires failureMessage');

    expect(() =>
      validateAnalysisJob({
        ...pendingJob(),
        status: 'completed',
      }),
    ).toThrow('requires completedAt');
  });
});
