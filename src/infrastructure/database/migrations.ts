export const SHOTSIGHT_DATABASE_NAME = 'shotsight.db';

export interface DatabaseMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Append-only schema migrations. Image bytes live under the app document directory;
 * SQLite stores only durable file URIs and searchable metadata.
 */
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'local_first_core',
    sql: `
      CREATE TABLE camera_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        manufacturer TEXT,
        model TEXT,
        credential_ref TEXT,
        main_rtsp_url TEXT NOT NULL,
        sub_rtsp_url TEXT,
        snapshot_url TEXT,
        onvif_enabled INTEGER NOT NULL DEFAULT 0 CHECK (onvif_enabled IN (0, 1)),
        onvif_port INTEGER CHECK (onvif_port IS NULL OR onvif_port BETWEEN 1 AND 65535),
        preferred_stream TEXT NOT NULL DEFAULT 'sub' CHECK (preferred_stream IN ('main', 'sub')),
        preferred_still_source TEXT NOT NULL DEFAULT 'http-snapshot' CHECK (
          preferred_still_source IN ('http-snapshot', 'main-stream-frame')
        ),
        capability_rtsp INTEGER NOT NULL DEFAULT 1 CHECK (capability_rtsp IN (0, 1)),
        capability_http_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (
          capability_http_snapshot IN (0, 1)
        ),
        capability_onvif INTEGER NOT NULL DEFAULT 0 CHECK (capability_onvif IN (0, 1)),
        target_distance_yards REAL CHECK (target_distance_yards IS NULL OR target_distance_yards > 0),
        camera_to_target_distance_yards REAL CHECK (
          camera_to_target_distance_yards IS NULL OR camera_to_target_distance_yards >= 0
        ),
        physical_target_width_inches REAL CHECK (
          physical_target_width_inches IS NULL OR physical_target_width_inches > 0
        ),
        physical_target_height_inches REAL CHECK (
          physical_target_height_inches IS NULL OR physical_target_height_inches > 0
        ),
        preset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT,
        range_name TEXT,
        target_distance_yards REAL NOT NULL CHECK (target_distance_yards > 0),
        camera_profile_id TEXT NOT NULL REFERENCES camera_profiles(id) ON DELETE RESTRICT,
        target_type TEXT NOT NULL CHECK (target_type IN ('paper', 'steel', 'other')),
        caliber TEXT,
        firearm_name TEXT,
        ammunition_name TEXT,
        notes TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived'))
      );

      CREATE TABLE targets (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('paper', 'steel', 'other')),
        roi_json TEXT,
        baseline_capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
        point_of_aim_json TEXT,
        desired_zero_point_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE captures (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        camera_profile_id TEXT NOT NULL REFERENCES camera_profiles(id) ON DELETE RESTRICT,
        sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
        baseline_revision INTEGER NOT NULL CHECK (baseline_revision > 0),
        captured_at TEXT NOT NULL,
        original_image_uri TEXT NOT NULL,
        preview_image_uri TEXT,
        width_pixels INTEGER NOT NULL CHECK (width_pixels > 0),
        height_pixels INTEGER NOT NULL CHECK (height_pixels > 0),
        camera_metadata_json TEXT,
        target_metadata_json TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('baseline', 'observation', 'reset-baseline')),
        analysis_status TEXT NOT NULL CHECK (
          analysis_status IN ('not-requested', 'pending', 'processing', 'completed', 'failed')
        ),
        newly_detected_shot_count INTEGER CHECK (
          newly_detected_shot_count IS NULL OR newly_detected_shot_count >= 0
        ),
        cumulative_shot_count INTEGER CHECK (
          cumulative_shot_count IS NULL OR cumulative_shot_count >= 0
        ),
        UNIQUE (session_id, sequence_number)
      );

      CREATE TABLE shots (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
        shot_number INTEGER NOT NULL CHECK (shot_number > 0),
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        confirmed_at TEXT NOT NULL,
        baseline_revision INTEGER NOT NULL CHECK (baseline_revision > 0),
        source TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        caliber_diameter_inches REAL CHECK (
          caliber_diameter_inches IS NULL OR caliber_diameter_inches > 0
        ),
        note TEXT,
        is_cold_bore INTEGER NOT NULL DEFAULT 0 CHECK (is_cold_bore IN (0, 1)),
        is_flyer INTEGER NOT NULL DEFAULT 0 CHECK (is_flyer IN (0, 1)),
        UNIQUE (session_id, shot_number)
      );

      CREATE TABLE shot_groups (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        color TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE shot_group_members (
        group_id TEXT NOT NULL REFERENCES shot_groups(id) ON DELETE CASCADE,
        shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
        exclude_from_statistics INTEGER NOT NULL DEFAULT 0 CHECK (exclude_from_statistics IN (0, 1)),
        PRIMARY KEY (group_id, shot_id)
      );

      CREATE TABLE target_calibrations (
        id TEXT PRIMARY KEY NOT NULL,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('manual', 'known-line', 'known-rectangle')),
        pixels_per_inch_x REAL NOT NULL CHECK (pixels_per_inch_x > 0),
        pixels_per_inch_y REAL NOT NULL CHECK (pixels_per_inch_y > 0),
        reference_json TEXT,
        calibrated_at TEXT NOT NULL
      );

      CREATE TABLE target_baselines (
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        reason TEXT NOT NULL CHECK (reason IN ('initial', 'target-reset')),
        established_at TEXT NOT NULL,
        PRIMARY KEY (target_id, revision),
        UNIQUE (target_id, capture_id)
      );

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX sessions_status_updated_idx ON sessions(status, updated_at DESC);
      CREATE INDEX targets_session_idx ON targets(session_id, created_at);
      CREATE INDEX captures_session_sequence_idx ON captures(session_id, sequence_number);
      CREATE INDEX captures_target_sequence_idx ON captures(target_id, sequence_number);
      CREATE INDEX shots_session_number_idx ON shots(session_id, shot_number);
      CREATE INDEX shots_target_number_idx ON shots(target_id, shot_number);
      CREATE INDEX shot_groups_target_idx ON shot_groups(target_id, created_at);
      CREATE INDEX target_calibrations_target_time_idx
        ON target_calibrations(target_id, calibrated_at DESC);
      CREATE INDEX target_baselines_target_time_idx
        ON target_baselines(target_id, revision DESC);
    `,
  },
  {
    version: 2,
    name: 'analysis_jobs_and_reviewable_candidates',
    sql: `
      CREATE TABLE analysis_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
        reference_capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
        baseline_revision INTEGER NOT NULL CHECK (baseline_revision > 0),
        reference_mode TEXT NOT NULL CHECK (
          reference_mode IN ('previous', 'clean-baseline', 'hybrid')
        ),
        sensitivity_json TEXT NOT NULL,
        analyzer_id TEXT NOT NULL,
        analyzer_version TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')
        ),
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        failure_message TEXT
      );

      CREATE TABLE analysis_candidates (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
        baseline_revision INTEGER NOT NULL CHECK (baseline_revision > 0),
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        bounds_x REAL NOT NULL,
        bounds_y REAL NOT NULL,
        bounds_width REAL NOT NULL CHECK (bounds_width >= 0),
        bounds_height REAL NOT NULL CHECK (bounds_height >= 0),
        area_pixels REAL NOT NULL CHECK (area_pixels >= 0),
        mean_difference REAL NOT NULL CHECK (mean_difference >= 0),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        classification TEXT NOT NULL CHECK (
          classification IN ('probable-paper-impact', 'probable-steel-impact', 'unknown-change')
        ),
        scores_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'rejected')),
        provenance_json TEXT NOT NULL,
        reviewed_at TEXT,
        confirmed_shot_id TEXT REFERENCES shots(id) ON DELETE SET NULL,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (state = 'pending' AND reviewed_at IS NULL AND confirmed_shot_id IS NULL AND rejection_reason IS NULL)
          OR (state = 'confirmed' AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
          OR (state = 'rejected' AND reviewed_at IS NOT NULL AND confirmed_shot_id IS NULL)
        )
      );

      CREATE INDEX analysis_jobs_capture_requested_idx
        ON analysis_jobs(capture_id, requested_at DESC);
      CREATE INDEX analysis_jobs_target_requested_idx
        ON analysis_jobs(target_id, requested_at DESC);
      CREATE INDEX analysis_candidates_capture_state_idx
        ON analysis_candidates(capture_id, state, created_at ASC);
      CREATE INDEX analysis_candidates_target_state_idx
        ON analysis_candidates(target_id, state, created_at ASC);
      CREATE INDEX analysis_candidates_job_idx
        ON analysis_candidates(job_id, created_at ASC);
    `,
  },
  {
    version: 3,
    name: 'camera_profile_onvif_protocol',
    sql: `
      ALTER TABLE camera_profiles
        ADD COLUMN onvif_protocol TEXT NOT NULL DEFAULT 'http'
        CHECK (onvif_protocol IN ('http', 'https'));
    `,
  },
];

export const LATEST_DATABASE_VERSION =
  DATABASE_MIGRATIONS[DATABASE_MIGRATIONS.length - 1]?.version ?? 0;
