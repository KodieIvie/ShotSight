import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  EstablishBaselineInput,
  PixelPoint,
  Target,
  TargetBaseline,
  TargetRoi,
} from '../../../domain';
import { deserializeJson, serializeJson } from '../serialization';
import {
  latestCalibrationRow,
  mapTargetCalibration,
  upsertCalibration,
} from './CalibrationRepository';

interface TargetRow {
  readonly id: string;
  readonly session_id: string;
  readonly name: string;
  readonly type: Target['type'];
  readonly roi_json: string | null;
  readonly baseline_capture_id: string | null;
  readonly point_of_aim_json: string | null;
  readonly desired_zero_point_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface BaselineRow {
  readonly capture_id: string;
  readonly revision: number;
  readonly reason: TargetBaseline['reason'];
  readonly established_at: string;
}

const TARGET_COLUMNS = `
  id, session_id, name, type, roi_json, baseline_capture_id,
  point_of_aim_json, desired_zero_point_json, created_at, updated_at
`;

export class TargetRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  /**
   * Creates a second (or later) physical target without touching any existing
   * target's baseline, calibration, captures, or shot groups.
   */
  async create(target: Target): Promise<Target> {
    const existing = await this.findById(target.id);
    if (existing) {
      throw new Error(`Target ${target.id} already exists.`);
    }
    await this.upsert(target);
    return (await this.findById(target.id)) ?? target;
  }

  async upsert(target: Target): Promise<void> {
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        `INSERT INTO targets (
          id, session_id, name, type, roi_json, baseline_capture_id,
          point_of_aim_json, desired_zero_point_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          roi_json = excluded.roi_json,
          baseline_capture_id = excluded.baseline_capture_id,
          point_of_aim_json = excluded.point_of_aim_json,
          desired_zero_point_json = excluded.desired_zero_point_json,
          updated_at = excluded.updated_at`,
        target.id,
        target.sessionId,
        target.name,
        target.type,
        serializeJson(target.roi),
        target.baseline?.captureId ?? null,
        serializeJson(target.pointOfAim),
        serializeJson(target.desiredZeroPoint),
        target.createdAt,
        target.updatedAt,
      );
      if (target.baseline) {
        await upsertBaseline(database, target.id, target.baseline);
      }
      if (target.calibration) {
        await upsertCalibration(database, target.calibration);
      }
    });
  }

  async findById(id: string): Promise<Target | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<TargetRow>(
      `SELECT ${TARGET_COLUMNS} FROM targets WHERE id = ?`,
      id,
    );
    return row ? hydrateTarget(database, row) : null;
  }

  async listForSession(sessionId: string): Promise<readonly Target[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<TargetRow>(
      `SELECT ${TARGET_COLUMNS} FROM targets
       WHERE session_id = ? ORDER BY created_at ASC`,
      sessionId,
    );
    return Promise.all(rows.map((row) => hydrateTarget(database, row)));
  }

  /** Creates an initial/reset baseline revision without creating another range session. */
  async establishBaseline(
    targetId: string,
    input: EstablishBaselineInput,
  ): Promise<Target> {
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      const latest = await latestBaselineRow(database, targetId);
      const expectedReason: TargetBaseline['reason'] = latest ? 'target-reset' : 'initial';
      if (input.reason && input.reason !== expectedReason) {
        throw new Error(`Baseline revision ${(latest?.revision ?? 0) + 1} must use reason ${expectedReason}.`);
      }
      const baseline: TargetBaseline = {
        captureId: input.captureId,
        revision: (latest?.revision ?? 0) + 1,
        establishedAt: input.establishedAt,
        reason: expectedReason,
      };
      // ROI, calibration, and aim references are all expressed in the old
      // baseline image's coordinate system. A reset intentionally starts a
      // new target surface, so retaining any of them could produce a false
      // measurement or zeroing recommendation.
      const clearCoordinateAnchors = baseline.reason === 'target-reset';
      // A baseline capture must belong to the same target and carry the new
      // revision itself. Without this update, the first observation after a
      // reset cannot locate its clean baseline by revision.
      const captureUpdate = await database.runAsync(
        `UPDATE captures SET
          baseline_revision = ?,
          kind = ?,
          analysis_status = 'not-requested',
          newly_detected_shot_count = NULL,
          target_metadata_json = NULL
         WHERE id = ? AND target_id = ?`,
        baseline.revision,
        baseline.reason === 'initial' ? 'baseline' : 'reset-baseline',
        input.captureId,
        targetId,
      );
      if (captureUpdate.changes !== 1) {
        throw new Error('The selected baseline capture must belong to this target.');
      }
      await upsertBaseline(database, targetId, baseline);
      await database.runAsync(
        `UPDATE targets SET
          baseline_capture_id = ?,
          roi_json = CASE WHEN ? THEN NULL ELSE roi_json END,
          point_of_aim_json = CASE WHEN ? THEN NULL ELSE point_of_aim_json END,
          desired_zero_point_json = CASE WHEN ? THEN NULL ELSE desired_zero_point_json END,
          updated_at = ?
         WHERE id = ?`,
        input.captureId,
        clearCoordinateAnchors ? 1 : 0,
        clearCoordinateAnchors ? 1 : 0,
        clearCoordinateAnchors ? 1 : 0,
        input.establishedAt,
        targetId,
      );
      if (input.clearCalibration || clearCoordinateAnchors) {
        await database.runAsync('DELETE FROM target_calibrations WHERE target_id = ?', targetId);
      }
    });
    const target = await this.findById(targetId);
    if (!target) {
      throw new Error(`Target ${targetId} does not exist.`);
    }
    return target;
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM targets WHERE id = ?', id);
    return result.changes > 0;
  }
}

async function hydrateTarget(database: SQLiteDatabase, row: TargetRow): Promise<Target> {
  const [baseline, calibrationRow] = await Promise.all([
    latestBaselineRow(database, row.id),
    latestCalibrationRow(database, row.id),
  ]);
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    type: row.type,
    roi: deserializeJson<TargetRoi>(row.roi_json),
    baseline: baseline ? mapBaseline(baseline) : undefined,
    calibration: calibrationRow ? mapTargetCalibration(calibrationRow) : undefined,
    pointOfAim: deserializeJson<PixelPoint>(row.point_of_aim_json),
    desiredZeroPoint: deserializeJson<PixelPoint>(row.desired_zero_point_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function latestBaselineRow(
  database: SQLiteDatabase,
  targetId: string,
): Promise<BaselineRow | null> {
  return database.getFirstAsync<BaselineRow>(
    `SELECT capture_id, revision, reason, established_at
     FROM target_baselines WHERE target_id = ? ORDER BY revision DESC LIMIT 1`,
    targetId,
  );
}

function mapBaseline(row: BaselineRow): TargetBaseline {
  return Object.freeze({
    captureId: row.capture_id,
    revision: row.revision,
    reason: row.reason,
    establishedAt: row.established_at,
  });
}

function upsertBaseline(
  database: SQLiteDatabase,
  targetId: string,
  baseline: TargetBaseline,
): Promise<unknown> {
  return database.runAsync(
    `INSERT INTO target_baselines (
      target_id, capture_id, revision, reason, established_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(target_id, revision) DO UPDATE SET
      capture_id = excluded.capture_id,
      reason = excluded.reason,
      established_at = excluded.established_at`,
    targetId,
    baseline.captureId,
    baseline.revision,
    baseline.reason,
    baseline.establishedAt,
  );
}
