import { describe, expect, it } from 'vitest';

import type { AnalysisCandidate } from '../../../../domain';
import { AnalysisRepository } from '../AnalysisRepository';

interface RecordedWrite {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

const timestamp = '2026-08-31T12:00:00.000Z';

function pendingCandidate(): AnalysisCandidate {
  return {
    id: 'candidate-1',
    jobId: 'job-1',
    sessionId: 'session-1',
    targetId: 'target-1',
    captureId: 'capture-1',
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
      analyzerId: 'local-jpeg',
      analyzerVersion: '1.0.0',
      referenceCaptureId: 'capture-baseline',
      registrationConfidence: 0.94,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function repositoryForJob(
  job: {
    readonly session_id: string;
    readonly target_id: string;
    readonly capture_id: string;
    readonly baseline_revision: number;
  } | null,
): { readonly repository: AnalysisRepository; readonly writes: RecordedWrite[] } {
  const writes: RecordedWrite[] = [];
  const database = {
    async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
      await callback();
    },
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      if (sql.includes('FROM analysis_jobs')) {
        return job as T | null;
      }
      return null;
    },
    async runAsync(sql: string, ...parameters: unknown[]): Promise<{ readonly changes: number }> {
      writes.push({ sql, parameters });
      return { changes: 1 };
    },
  };
  return {
    repository: new AnalysisRepository(async () => database as never),
    writes,
  };
}

describe('AnalysisRepository candidate persistence', () => {
  it('serializes a valid candidate only after its job identity has been verified', async () => {
    const { repository, writes } = repositoryForJob({
      session_id: 'session-1',
      target_id: 'target-1',
      capture_id: 'capture-1',
      baseline_revision: 1,
    });

    await repository.upsertCandidate(pendingCandidate());

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      sql: expect.stringContaining('INSERT INTO analysis_candidates'),
      parameters: [
        expect.objectContaining({
          $id: 'candidate-1',
          $jobId: 'job-1',
          $state: 'pending',
          $provenanceJson: expect.stringContaining('local-jpeg'),
        }),
      ],
    });
  });

  it('rejects a cross-target candidate before it can be written', async () => {
    const { repository, writes } = repositoryForJob({
      session_id: 'session-1',
      target_id: 'target-1',
      capture_id: 'capture-1',
      baseline_revision: 1,
    });

    await expect(
      repository.upsertCandidate({ ...pendingCandidate(), targetId: 'other-target' }),
    ).rejects.toThrow("must match its job's session, target, and capture");

    expect(writes).toHaveLength(0);
  });
});
