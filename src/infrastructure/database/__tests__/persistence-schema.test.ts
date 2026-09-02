import initSqlJs from 'sql.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS, LATEST_DATABASE_VERSION } from '../migrations';

let Sql: Awaited<ReturnType<typeof initSqlJs>>;
let database: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

beforeAll(async () => {
  Sql = await initSqlJs();
});

afterEach(() => {
  database?.close();
});

function openMigratedDatabase(): void {
  database = new Sql.Database();
  database.run('PRAGMA foreign_keys = ON;');
  for (const migration of DATABASE_MIGRATIONS) {
    database.run(migration.sql);
    database.run(`PRAGMA user_version = ${migration.version}`);
  }
}

function scalar(sql: string): number {
  const result = database.exec(sql);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

describe('local SQLite persistence schema', () => {
  it('migrates to the latest version without a plaintext credential column', () => {
    openMigratedDatabase();

    expect(scalar('PRAGMA user_version')).toBe(LATEST_DATABASE_VERSION);
    const columns = database.exec('PRAGMA table_info(camera_profiles)')[0]?.values.map((row) => row[1]);
    expect(columns).toContain('credential_ref');
    expect(columns).not.toContain('password');
    expect(columns).not.toContain('username');
  });

  it('adds an HTTP ONVIF protocol default when upgrading legacy camera profiles', () => {
    database = new Sql.Database();
    const legacyMigrations = DATABASE_MIGRATIONS.filter((migration) => migration.version < 3);
    for (const migration of legacyMigrations) {
      database.run(migration.sql);
      database.run(`PRAGMA user_version = ${migration.version}`);
    }
    database.run(`INSERT INTO camera_profiles (
      id, name, host, main_rtsp_url, onvif_enabled, preferred_stream,
      preferred_still_source, capability_rtsp, capability_http_snapshot,
      capability_onvif, created_at, updated_at
    ) VALUES ('legacy-camera', 'Legacy camera', '192.168.50.20',
      'rtsp://192.168.50.20:554/main', 1, 'main', 'http-snapshot', 1, 1, 1,
      '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`);

    const protocolMigration = DATABASE_MIGRATIONS.find((migration) => migration.version === 3);
    expect(protocolMigration).toBeDefined();
    database.run(protocolMigration?.sql ?? '');

    expect(database.exec("SELECT onvif_protocol FROM camera_profiles WHERE id = 'legacy-camera'")[0]?.values)
      .toEqual([['http']]);
  });

  it('persists a session/capture/shot relationship and cascades on session removal', () => {
    openMigratedDatabase();
    database.run(
      `INSERT INTO camera_profiles (
        id, name, host, main_rtsp_url, onvif_enabled, preferred_stream,
        preferred_still_source, capability_rtsp, capability_http_snapshot,
        capability_onvif, created_at, updated_at
      ) VALUES ('camera-1', 'Target camera', '192.168.50.20',
        'rtsp://192.168.50.20:554/Preview_01_main', 0, 'main',
        'http-snapshot', 1, 1, 0, '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');
       INSERT INTO sessions (
        id, title, started_at, updated_at, target_distance_yards,
        camera_profile_id, target_type, status
      ) VALUES ('session-1', 'Morning group', '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z', 100, 'camera-1', 'paper', 'active');
       INSERT INTO targets (id, session_id, name, type, created_at, updated_at)
       VALUES ('target-1', 'session-1', 'Target 1', 'paper',
        '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');
       INSERT INTO captures (
        id, session_id, target_id, camera_profile_id, sequence_number,
        baseline_revision, captured_at, original_image_uri, width_pixels,
        height_pixels, camera_metadata_json, kind, analysis_status
      ) VALUES ('capture-1', 'session-1', 'target-1', 'camera-1', 1, 1,
        '2026-08-31T00:01:00.000Z', 'file:///captures/capture-1.jpg', 2560,
        1920, '{"source":"http-snapshot"}', 'baseline', 'not-requested');
       INSERT INTO shots (
        id, session_id, target_id, shot_number, position_x, position_y,
        confirmed_at, baseline_revision, source, is_cold_bore, is_flyer
      ) VALUES ('shot-1', 'session-1', 'target-1', 1, 1280, 960,
        '2026-08-31T00:02:00.000Z', 1, 'manual', 1, 0);`,
    );

    expect(scalar("SELECT COUNT(*) FROM captures WHERE session_id = 'session-1'"))
      .toBe(1);
    expect(scalar("SELECT shot_number FROM shots WHERE id = 'shot-1'"))
      .toBe(1);

    database.run("DELETE FROM sessions WHERE id = 'session-1'");
    expect(scalar('SELECT COUNT(*) FROM targets')).toBe(0);
    expect(scalar('SELECT COUNT(*) FROM captures')).toBe(0);
    expect(scalar('SELECT COUNT(*) FROM shots')).toBe(0);
  });

  it('keeps reviewable analysis candidates local, constrained, and auditable', () => {
    openMigratedDatabase();
    database.run(
      `INSERT INTO camera_profiles (
        id, name, host, main_rtsp_url, onvif_enabled, preferred_stream,
        preferred_still_source, capability_rtsp, capability_http_snapshot,
        capability_onvif, created_at, updated_at
      ) VALUES ('camera-analysis', 'Target camera', '192.168.50.20',
        'rtsp://192.168.50.20:554/Preview_01_main', 0, 'main',
        'http-snapshot', 1, 1, 0, '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');
       INSERT INTO sessions (
        id, title, started_at, updated_at, target_distance_yards,
        camera_profile_id, target_type, status
      ) VALUES ('session-analysis', 'Analysis session', '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z', 100, 'camera-analysis', 'paper', 'active');
       INSERT INTO targets (id, session_id, name, type, created_at, updated_at)
       VALUES ('target-analysis', 'session-analysis', 'Target 1', 'paper',
        '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');
       INSERT INTO captures (
        id, session_id, target_id, camera_profile_id, sequence_number,
        baseline_revision, captured_at, original_image_uri, width_pixels,
        height_pixels, camera_metadata_json, kind, analysis_status
      ) VALUES
       ('capture-analysis-reference', 'session-analysis', 'target-analysis', 'camera-analysis', 1, 1,
        '2026-08-31T00:01:00.000Z', 'file:///captures/reference.jpg', 2560, 1920,
        '{"source":"http-snapshot"}', 'baseline', 'not-requested'),
       ('capture-analysis-current', 'session-analysis', 'target-analysis', 'camera-analysis', 2, 1,
        '2026-08-31T00:02:00.000Z', 'file:///captures/current.jpg', 2560, 1920,
        '{"source":"http-snapshot"}', 'observation', 'completed');
       INSERT INTO shots (
        id, session_id, target_id, shot_number, position_x, position_y,
        confirmed_at, baseline_revision, source, is_cold_bore, is_flyer
      ) VALUES ('shot-analysis', 'session-analysis', 'target-analysis', 1, 1280, 960,
        '2026-08-31T00:03:00.000Z', 1, 'automatic', 1, 0);
       INSERT INTO analysis_jobs (
        id, session_id, target_id, capture_id, reference_capture_id,
        baseline_revision, reference_mode, sensitivity_json, analyzer_id,
        analyzer_version, status, requested_at, completed_at
      ) VALUES ('job-analysis', 'session-analysis', 'target-analysis', 'capture-analysis-current',
        'capture-analysis-reference', 1, 'clean-baseline',
        '{"preset":"medium","minimumDifference":12,"minimumAreaPixels":5,"maximumAreaPixels":100,"deduplicationRadiusPixels":8}',
        'shotsight-harness', '1.0.0', 'completed', '2026-08-31T00:02:01.000Z',
        '2026-08-31T00:02:02.000Z');
       INSERT INTO analysis_candidates (
        id, job_id, session_id, target_id, capture_id, baseline_revision,
        position_x, position_y, bounds_x, bounds_y, bounds_width, bounds_height,
        area_pixels, mean_difference, confidence, classification, scores_json,
        state, provenance_json, reviewed_at, confirmed_shot_id, rejection_reason,
        created_at, updated_at
      ) VALUES ('candidate-analysis', 'job-analysis', 'session-analysis', 'target-analysis',
        'capture-analysis-current', 1, 1280, 960, 1275, 955, 10, 10, 44, 28.4, .91,
        'probable-paper-impact',
        '{"locality":.9,"shape":.8,"size":.7,"contrast":.95,"temporalNovelty":.88}',
        'confirmed',
        '{"analyzerId":"shotsight-harness","referenceCaptureId":"capture-analysis-reference"}',
        '2026-08-31T00:03:00.000Z', 'shot-analysis', NULL,
        '2026-08-31T00:02:02.000Z', '2026-08-31T00:03:00.000Z');`,
    );

    expect(scalar("SELECT COUNT(*) FROM analysis_jobs WHERE capture_id = 'capture-analysis-current'"))
      .toBe(1);
    expect(scalar("SELECT COUNT(*) FROM analysis_candidates WHERE state = 'confirmed'"))
      .toBe(1);
    expect(() =>
      database.run(
        `INSERT INTO analysis_candidates (
          id, job_id, session_id, target_id, capture_id, baseline_revision,
          position_x, position_y, bounds_x, bounds_y, bounds_width, bounds_height,
          area_pixels, mean_difference, confidence, classification, scores_json,
          state, provenance_json, reviewed_at, created_at, updated_at
        ) VALUES ('bad-candidate', 'job-analysis', 'session-analysis', 'target-analysis',
          'capture-analysis-current', 1, 1, 1, 0, 0, 1, 1, 1, 1, .5,
          'unknown-change', '{}', 'confirmed', '{}', NULL,
          '2026-08-31T00:04:00.000Z', '2026-08-31T00:04:00.000Z')`,
      ),
    ).toThrow();

    database.run("DELETE FROM shots WHERE id = 'shot-analysis'");
    expect(scalar("SELECT COUNT(*) FROM analysis_candidates WHERE state = 'confirmed'"))
      .toBe(1);
    expect(scalar("SELECT COUNT(*) FROM analysis_candidates WHERE confirmed_shot_id IS NULL"))
      .toBe(1);

    database.run("DELETE FROM sessions WHERE id = 'session-analysis'");
    expect(scalar('SELECT COUNT(*) FROM analysis_jobs')).toBe(0);
    expect(scalar('SELECT COUNT(*) FROM analysis_candidates')).toBe(0);
  });
});
