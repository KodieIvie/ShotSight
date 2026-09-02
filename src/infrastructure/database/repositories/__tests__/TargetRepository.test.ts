import initSqlJs from 'sql.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS } from '../../migrations';
import { TargetRepository } from '../TargetRepository';

let Sql: Awaited<ReturnType<typeof initSqlJs>>;
let transactionDatabase: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

beforeAll(async () => {
  Sql = await initSqlJs();
});

afterEach(() => {
  transactionDatabase?.close();
});

function openTransactionDatabase(): void {
  transactionDatabase = new Sql.Database();
  transactionDatabase.run('PRAGMA foreign_keys = ON;');
  for (const migration of DATABASE_MIGRATIONS) {
    transactionDatabase.run(migration.sql);
  }
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

function firstRow(sql: string): Readonly<Record<string, unknown>> | undefined {
  const result = transactionDatabase.exec(sql)[0];
  if (!result || !result.values[0]) return undefined;
  return Object.freeze(
    Object.fromEntries(result.columns.map((column, index) => [column, result.values[0]?.[index]])),
  );
}

function sqlValue(sql: string): unknown {
  return transactionDatabase.exec(sql)[0]?.values[0]?.[0];
}

function repositoryForBaselineReset(): TargetRepository {
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
    async getAllAsync<T>(sql: string, ...parameters: unknown[]): Promise<readonly T[]> {
      const statement = transactionDatabase.prepare(sql);
      try {
        statement.bind(sqlParameters(parameters) as never);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
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
  return new TargetRepository(async () => database as never);
}

function seedTargetAndCaptures(): void {
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
      'session-1', 'Baseline reset', '2026-08-31T00:00:00.000Z',
      '2026-08-31T00:00:00.000Z', 100, 'camera-1', 'paper', 'active'
    );
    INSERT INTO targets (id, session_id, name, type, created_at, updated_at)
    VALUES
      ('target-1', 'session-1', 'Primary target', 'paper', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
      ('target-2', 'session-1', 'Other target', 'paper', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');
    INSERT INTO captures (
      id, session_id, target_id, camera_profile_id, sequence_number,
      baseline_revision, captured_at, original_image_uri, width_pixels,
      height_pixels, camera_metadata_json, target_metadata_json, kind,
      analysis_status, newly_detected_shot_count, cumulative_shot_count
    ) VALUES
      (
        'capture-old-baseline', 'session-1', 'target-1', 'camera-1', 1, 1,
        '2026-08-31T00:01:00.000Z', 'file:///captures/old-baseline.jpg', 2560,
        1920, '{"source":"http-snapshot"}', NULL, 'baseline', 'not-requested', NULL, 5
      ),
      (
        'capture-promote', 'session-1', 'target-1', 'camera-1', 2, 1,
        '2026-08-31T00:02:00.000Z', 'file:///captures/promote.jpg', 2560,
        1920, '{"source":"http-snapshot"}',
        '{"registrationTransform":{"kind":"translation","x":12,"y":-4},"registrationConfidence":0.91}',
        'observation', 'completed', 3, 8
      ),
      (
        'capture-other-target', 'session-1', 'target-2', 'camera-1', 3, 1,
        '2026-08-31T00:03:00.000Z', 'file:///captures/other.jpg', 2560,
        1920, '{"source":"http-snapshot"}', NULL, 'observation', 'completed', 2, 2
      );
    INSERT INTO target_baselines (target_id, capture_id, revision, reason, established_at)
    VALUES ('target-1', 'capture-old-baseline', 1, 'initial', '2026-08-31T00:01:00.000Z');
    UPDATE targets SET
      baseline_capture_id = 'capture-old-baseline',
      roi_json = '{"kind":"rectangle","rect":{"x":400,"y":300,"width":1200,"height":900}}',
      point_of_aim_json = '{"x":1000,"y":900}',
      desired_zero_point_json = '{"x":1002,"y":898}'
    WHERE id = 'target-1';
    INSERT INTO target_calibrations (
      id, target_id, kind, pixels_per_inch_x, pixels_per_inch_y,
      reference_json, calibrated_at
    ) VALUES (
      'calibration-1', 'target-1', 'manual', 200, 200, NULL,
      '2026-08-31T00:01:30.000Z'
    );
  `);
}

describe('TargetRepository baseline reset', () => {
  it('creates and lists independent named targets within one session', async () => {
    openTransactionDatabase();
    seedTargetAndCaptures();
    const repository = repositoryForBaselineReset();

    const created = await repository.create({
      id: 'target-3',
      sessionId: 'session-1',
      name: 'Load B',
      type: 'steel',
      createdAt: '2026-08-31T00:05:00.000Z',
      updatedAt: '2026-08-31T00:05:00.000Z',
    });

    expect(created).toMatchObject({
      id: 'target-3',
      sessionId: 'session-1',
      name: 'Load B',
      type: 'steel',
    });
    expect(created.baseline).toBeUndefined();
    expect((await repository.listForSession('session-1')).map((target) => target.id)).toEqual([
      'target-1',
      'target-2',
      'target-3',
    ]);
    await expect(repository.create(created)).rejects.toThrow('already exists');
  });

  it('atomically promotes the selected capture and clears stale coordinate anchors', async () => {
    openTransactionDatabase();
    seedTargetAndCaptures();
    const repository = repositoryForBaselineReset();

    const target = await repository.establishBaseline('target-1', {
      captureId: 'capture-promote',
      establishedAt: '2026-08-31T00:04:00.000Z',
      reason: 'target-reset',
    });

    expect(target.baseline).toEqual({
      captureId: 'capture-promote',
      revision: 2,
      reason: 'target-reset',
      establishedAt: '2026-08-31T00:04:00.000Z',
    });
    expect(target.roi).toBeUndefined();
    expect(target.calibration).toBeUndefined();
    expect(target.pointOfAim).toBeUndefined();
    expect(target.desiredZeroPoint).toBeUndefined();
    expect(firstRow(`
      SELECT roi_json, point_of_aim_json, desired_zero_point_json
      FROM targets WHERE id = 'target-1'
    `)).toEqual({
      roi_json: null,
      point_of_aim_json: null,
      desired_zero_point_json: null,
    });
    expect(sqlValue(`SELECT COUNT(*) FROM target_calibrations WHERE target_id = 'target-1'`)).toBe(0);
    expect(firstRow(`
      SELECT baseline_revision, kind, analysis_status, newly_detected_shot_count,
             cumulative_shot_count, target_metadata_json
      FROM captures WHERE id = 'capture-promote'
    `)).toEqual({
      baseline_revision: 2,
      kind: 'reset-baseline',
      analysis_status: 'not-requested',
      newly_detected_shot_count: null,
      // This remains historical session context; it is not a result of the stale analysis.
      cumulative_shot_count: 8,
      target_metadata_json: null,
    });
    expect(firstRow(`
      SELECT capture_id, revision, reason, established_at
      FROM target_baselines WHERE target_id = 'target-1' ORDER BY revision DESC LIMIT 1
    `)).toEqual({
      capture_id: 'capture-promote',
      revision: 2,
      reason: 'target-reset',
      established_at: '2026-08-31T00:04:00.000Z',
    });
  });

  it('keeps coordinate anchors when establishing an initial baseline', async () => {
    openTransactionDatabase();
    seedTargetAndCaptures();
    transactionDatabase.run(`
      UPDATE targets SET
        roi_json = '{"kind":"rectangle","rect":{"x":40,"y":30,"width":120,"height":90}}',
        point_of_aim_json = '{"x":100,"y":90}',
        desired_zero_point_json = '{"x":102,"y":88}'
      WHERE id = 'target-2';
      INSERT INTO target_calibrations (
        id, target_id, kind, pixels_per_inch_x, pixels_per_inch_y,
        reference_json, calibrated_at
      ) VALUES (
        'calibration-2', 'target-2', 'manual', 150, 150, NULL,
        '2026-08-31T00:03:30.000Z'
      );
    `);
    const repository = repositoryForBaselineReset();

    const target = await repository.establishBaseline('target-2', {
      captureId: 'capture-other-target',
      establishedAt: '2026-08-31T00:04:00.000Z',
      reason: 'initial',
    });

    expect(target.baseline).toEqual({
      captureId: 'capture-other-target',
      revision: 1,
      reason: 'initial',
      establishedAt: '2026-08-31T00:04:00.000Z',
    });
    expect(target.roi).toEqual({
      kind: 'rectangle',
      rect: { x: 40, y: 30, width: 120, height: 90 },
    });
    expect(target.calibration).toMatchObject({
      id: 'calibration-2',
      pixelsPerInchX: 150,
      pixelsPerInchY: 150,
    });
    expect(target.pointOfAim).toEqual({ x: 100, y: 90 });
    expect(target.desiredZeroPoint).toEqual({ x: 102, y: 88 });
  });

  it('rejects an initial reason for a later revision before changing coordinate anchors', async () => {
    openTransactionDatabase();
    seedTargetAndCaptures();
    const repository = repositoryForBaselineReset();

    await expect(repository.establishBaseline('target-1', {
      captureId: 'capture-promote',
      establishedAt: '2026-08-31T00:04:00.000Z',
      reason: 'initial',
    })).rejects.toThrow('Baseline revision 2 must use reason target-reset');

    expect(firstRow(`
      SELECT baseline_capture_id, roi_json, point_of_aim_json, desired_zero_point_json
      FROM targets WHERE id = 'target-1'
    `)).toEqual({
      baseline_capture_id: 'capture-old-baseline',
      roi_json: '{"kind":"rectangle","rect":{"x":400,"y":300,"width":1200,"height":900}}',
      point_of_aim_json: '{"x":1000,"y":900}',
      desired_zero_point_json: '{"x":1002,"y":898}',
    });
    expect(sqlValue(`SELECT COUNT(*) FROM target_calibrations WHERE target_id = 'target-1'`)).toBe(1);
  });

  it.each([
    ['a missing capture', 'capture-missing'],
    ['a capture owned by another target', 'capture-other-target'],
  ])('rejects %s before changing the current baseline', async (_label, captureId) => {
    openTransactionDatabase();
    seedTargetAndCaptures();
    const repository = repositoryForBaselineReset();

    await expect(
      repository.establishBaseline('target-1', {
        captureId,
        establishedAt: '2026-08-31T00:04:00.000Z',
        reason: 'target-reset',
      }),
    ).rejects.toThrow('must belong to this target');

    expect(firstRow(`
      SELECT baseline_capture_id, updated_at FROM targets WHERE id = 'target-1'
    `)).toEqual({
      baseline_capture_id: 'capture-old-baseline',
      updated_at: '2026-08-31T00:00:00.000Z',
    });
    expect(sqlValue(`SELECT COUNT(*) FROM target_baselines WHERE target_id = 'target-1'`)).toBe(1);
    expect(firstRow(`
      SELECT baseline_revision, kind, analysis_status, newly_detected_shot_count, target_metadata_json
      FROM captures WHERE id = 'capture-promote'
    `)).toEqual({
      baseline_revision: 1,
      kind: 'observation',
      analysis_status: 'completed',
      newly_detected_shot_count: 3,
      target_metadata_json:
        '{"registrationTransform":{"kind":"translation","x":12,"y":-4},"registrationConfidence":0.91}',
    });
  });
});
