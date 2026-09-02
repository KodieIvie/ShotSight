import initSqlJs from 'sql.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ShotRepository } from '../ShotRepository';
import { DATABASE_MIGRATIONS } from '../../migrations';

let Sql: Awaited<ReturnType<typeof initSqlJs>>;
let transactionDatabase: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

beforeAll(async () => {
  Sql = await initSqlJs();
});

afterEach(() => {
  transactionDatabase?.close();
});

interface RecordedCall {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function repositoryForColdBore(
  selectedShotExists = true,
): { readonly repository: ShotRepository; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const database = {
    async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
      await callback();
    },
    async getFirstAsync<T>(): Promise<T | null> {
      return (selectedShotExists ? { id: 'shot-2' } : null) as T | null;
    },
    async runAsync(sql: string, ...parameters: unknown[]): Promise<{ readonly changes: number }> {
      calls.push({ sql, parameters });
      return { changes: 1 };
    },
  };
  return {
    repository: new ShotRepository(async () => database as never),
    calls,
  };
}

describe('ShotRepository cold-bore designation', () => {
  it('clears the session before assigning exactly one replacement shot', async () => {
    const { repository, calls } = repositoryForColdBore();

    await repository.setColdBore('session-1', 'shot-2');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      sql: expect.stringContaining('UPDATE shots SET is_cold_bore = 0'),
      parameters: ['session-1'],
    });
    expect(calls[1]).toMatchObject({
      sql: expect.stringContaining('UPDATE shots SET is_cold_bore = 1'),
      parameters: ['shot-2'],
    });
  });

  it('does not clear an existing designation when the requested shot is outside the session', async () => {
    const { repository, calls } = repositoryForColdBore(false);

    await expect(repository.setColdBore('session-1', 'other-session-shot')).rejects.toThrow(
      'not in this session',
    );

    expect(calls).toHaveLength(0);
  });

  it('allows an intentional clear without selecting another shot', async () => {
    const { repository, calls } = repositoryForColdBore();

    await repository.setColdBore('session-1', undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sql: expect.stringContaining('UPDATE shots SET is_cold_bore = 0'),
      parameters: ['session-1'],
    });
  });
});

function openTransactionDatabase(): void {
  transactionDatabase = new Sql.Database();
  transactionDatabase.run('PRAGMA foreign_keys = ON;');
  for (const migration of DATABASE_MIGRATIONS) {
    transactionDatabase.run(migration.sql);
  }
}

function sqlValue(sql: string): unknown {
  const result = transactionDatabase.exec(sql);
  return result[0]?.values[0]?.[0];
}

function sqlParameters(parameters: readonly unknown[]): unknown {
  if (
    parameters.length === 1 &&
    typeof parameters[0] === 'object' &&
    parameters[0] !== null &&
    !Array.isArray(parameters[0])
  ) {
    return parameters[0];
  }
  return parameters;
}

function repositoryForCandidateConfirmation(): ShotRepository {
  const database = {
    async withTransactionAsync(callback: () => Promise<void>): Promise<void> {
      transactionDatabase.run('BEGIN IMMEDIATE;');
      try {
        await callback();
        transactionDatabase.run('COMMIT;');
      } catch (error) {
        transactionDatabase.run('ROLLBACK;');
        throw error;
      }
    },
    async getFirstAsync<T>(sql: string, ...parameters: unknown[]): Promise<T | null> {
      const statement = transactionDatabase.prepare(sql);
      try {
        statement.bind(sqlParameters(parameters) as never);
        return statement.step() ? (statement.getAsObject() as T) : null;
      } finally {
        statement.free();
      }
    },
    async runAsync(
      sql: string,
      ...parameters: unknown[]
    ): Promise<{ readonly changes: number }> {
      transactionDatabase.run(sql, sqlParameters(parameters) as never);
      return { changes: Number(sqlValue('SELECT changes()')) };
    },
  };
  return new ShotRepository(async () => database as never);
}

function seedPendingAnalysisCandidate(): void {
  transactionDatabase.run(`
    INSERT INTO camera_profiles (
      id, name, host, main_rtsp_url, onvif_enabled, preferred_stream,
      preferred_still_source, capability_rtsp, capability_http_snapshot,
      capability_onvif, created_at, updated_at
    ) VALUES (
      'camera-1', 'Target camera', '192.168.50.20',
      'rtsp://192.168.50.20:554/Preview_01_main', 0, 'main',
      'http-snapshot', 1, 1, 0, '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
    );
    INSERT INTO sessions (
      id, title, started_at, updated_at, target_distance_yards,
      camera_profile_id, target_type, status
    ) VALUES (
      'session-1', 'Candidate review', '2026-08-31T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z', 100, 'camera-1', 'paper', 'active'
    );
    INSERT INTO targets (id, session_id, name, type, created_at, updated_at)
    VALUES (
      'target-1', 'session-1', 'Target 1', 'paper',
      '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
    );
    INSERT INTO captures (
      id, session_id, target_id, camera_profile_id, sequence_number,
      baseline_revision, captured_at, original_image_uri, width_pixels,
      height_pixels, camera_metadata_json, kind, analysis_status
    ) VALUES
      (
        'capture-reference', 'session-1', 'target-1', 'camera-1', 1, 1,
        '2026-08-31T00:01:00.000Z', 'file:///captures/reference.jpg', 2560,
        1920, '{"source":"http-snapshot"}', 'baseline', 'not-requested'
      ),
      (
        'capture-current', 'session-1', 'target-1', 'camera-1', 2, 1,
        '2026-08-31T00:02:00.000Z', 'file:///captures/current.jpg', 2560,
        1920, '{"source":"http-snapshot"}', 'observation', 'completed'
      );
    INSERT INTO shots (
      id, session_id, target_id, capture_id, shot_number, position_x, position_y,
      confirmed_at, baseline_revision, source, is_cold_bore, is_flyer
    ) VALUES (
      'existing-shot', 'session-1', 'target-1', 'capture-reference', 1, 100, 100,
      '2026-08-31T00:01:30.000Z', 1, 'manual', 1, 0
    );
    INSERT INTO analysis_jobs (
      id, session_id, target_id, capture_id, reference_capture_id,
      baseline_revision, reference_mode, sensitivity_json, analyzer_id,
      analyzer_version, status, requested_at, completed_at
    ) VALUES (
      'job-1', 'session-1', 'target-1', 'capture-current', 'capture-reference',
      1, 'clean-baseline',
      '{"preset":"medium","minimumDifference":12,"minimumAreaPixels":5,"maximumAreaPixels":100,"deduplicationRadiusPixels":8}',
      'local-jpeg', '1.0.0', 'completed', '2026-08-31T00:02:01.000Z',
      '2026-08-31T00:02:02.000Z'
    );
    INSERT INTO analysis_candidates (
      id, job_id, session_id, target_id, capture_id, baseline_revision,
      position_x, position_y, bounds_x, bounds_y, bounds_width, bounds_height,
      area_pixels, mean_difference, confidence, classification, scores_json,
      state, provenance_json, reviewed_at, confirmed_shot_id, rejection_reason,
      created_at, updated_at
    ) VALUES (
      'candidate-1', 'job-1', 'session-1', 'target-1', 'capture-current', 1,
      140, 240, 136, 236, 8, 8, 44, 28.4, .91, 'probable-paper-impact',
      '{"locality":.9,"shape":.8,"size":.7,"contrast":.95,"temporalNovelty":.88}',
      'pending', '{"analyzerId":"local-jpeg","referenceCaptureId":"capture-reference"}',
      NULL, NULL, NULL, '2026-08-31T00:02:02.000Z', '2026-08-31T00:02:02.000Z'
    );
  `);
}

function automaticConfirmation(overrides: Partial<Parameters<ShotRepository['confirmAnalysisCandidate']>[1]> = {}) {
  return {
    id: 'shot-from-candidate',
    sessionId: 'session-1',
    targetId: 'target-1',
    captureId: 'capture-current',
    position: { x: 140, y: 240 },
    confirmedAt: '2026-08-31T00:03:00.000Z',
    baselineRevision: 1,
    source: 'automatic' as const,
    confidence: 0.91,
    ...overrides,
  };
}

describe('ShotRepository analysis candidate confirmation', () => {
  it('allocates one next-numbered shot and marks its candidate confirmed in the same durable transaction', async () => {
    openTransactionDatabase();
    seedPendingAnalysisCandidate();
    const repository = repositoryForCandidateConfirmation();

    const saved = await repository.confirmAnalysisCandidate(
      'candidate-1',
      automaticConfirmation(),
    );

    expect(saved).toMatchObject({
      id: 'shot-from-candidate',
      number: 2,
      captureId: 'capture-current',
      source: 'automatic',
      isColdBore: false,
    });
    expect(sqlValue("SELECT state FROM analysis_candidates WHERE id = 'candidate-1'")).toBe(
      'confirmed',
    );
    expect(
      sqlValue("SELECT confirmed_shot_id FROM analysis_candidates WHERE id = 'candidate-1'"),
    ).toBe('shot-from-candidate');

    await expect(
      repository.confirmAnalysisCandidate('candidate-1', automaticConfirmation()),
    ).rejects.toThrow('already been reviewed');
    expect(sqlValue("SELECT COUNT(*) FROM shots WHERE id = 'shot-from-candidate'")).toBe(1);
  });

  it('does not create a shot when the candidate metadata does not match the requested capture', async () => {
    openTransactionDatabase();
    seedPendingAnalysisCandidate();
    const repository = repositoryForCandidateConfirmation();

    await expect(
      repository.confirmAnalysisCandidate(
        'candidate-1',
        automaticConfirmation({ baselineRevision: 2 }),
      ),
    ).rejects.toThrow('do not describe the same target capture');

    expect(sqlValue('SELECT COUNT(*) FROM shots')).toBe(1);
    expect(sqlValue("SELECT state FROM analysis_candidates WHERE id = 'candidate-1'")).toBe(
      'pending',
    );
  });

  it('rolls back the new shot if the compare-and-set candidate review loses its race', async () => {
    openTransactionDatabase();
    seedPendingAnalysisCandidate();
    transactionDatabase.run(`
      CREATE TRIGGER keep_candidate_pending
      BEFORE UPDATE OF state ON analysis_candidates
      WHEN NEW.id = 'candidate-1' AND NEW.state = 'confirmed'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);
    const repository = repositoryForCandidateConfirmation();

    await expect(
      repository.confirmAnalysisCandidate('candidate-1', automaticConfirmation()),
    ).rejects.toThrow('was reviewed by another operation');

    expect(sqlValue('SELECT COUNT(*) FROM shots')).toBe(1);
    expect(sqlValue("SELECT state FROM analysis_candidates WHERE id = 'candidate-1'")).toBe(
      'pending',
    );
  });
});
