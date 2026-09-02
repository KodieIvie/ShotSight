import type { SQLiteDatabase } from 'expo-sqlite';

import type { TargetCalibration } from '../../../domain';
import { deserializeJson, serializeJson } from '../serialization';

export interface TargetCalibrationRow {
  readonly id: string;
  readonly target_id: string;
  readonly kind: TargetCalibration['kind'];
  readonly pixels_per_inch_x: number;
  readonly pixels_per_inch_y: number;
  readonly reference_json: string | null;
  readonly calibrated_at: string;
}

export const CALIBRATION_COLUMNS = `
  id, target_id, kind, pixels_per_inch_x, pixels_per_inch_y,
  reference_json, calibrated_at
`;

export class CalibrationRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async upsert(calibration: TargetCalibration): Promise<void> {
    const database = await this.getDatabase();
    await upsertCalibration(database, calibration);
  }

  async findById(id: string): Promise<TargetCalibration | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<TargetCalibrationRow>(
      `SELECT ${CALIBRATION_COLUMNS} FROM target_calibrations WHERE id = ?`,
      id,
    );
    return row ? mapTargetCalibration(row) : null;
  }

  async latestForTarget(targetId: string): Promise<TargetCalibration | null> {
    const database = await this.getDatabase();
    const row = await latestCalibrationRow(database, targetId);
    return row ? mapTargetCalibration(row) : null;
  }

  async listForTarget(targetId: string): Promise<readonly TargetCalibration[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<TargetCalibrationRow>(
      `SELECT ${CALIBRATION_COLUMNS} FROM target_calibrations
       WHERE target_id = ? ORDER BY calibrated_at ASC`,
      targetId,
    );
    return rows.map(mapTargetCalibration);
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM target_calibrations WHERE id = ?', id);
    return result.changes > 0;
  }
}

export async function upsertCalibration(
  database: SQLiteDatabase,
  calibration: TargetCalibration,
): Promise<void> {
  const reference = calibration.kind === 'manual' ? undefined : calibration.reference;
  await database.runAsync(
    `INSERT INTO target_calibrations (
      id, target_id, kind, pixels_per_inch_x, pixels_per_inch_y,
      reference_json, calibrated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      pixels_per_inch_x = excluded.pixels_per_inch_x,
      pixels_per_inch_y = excluded.pixels_per_inch_y,
      reference_json = excluded.reference_json,
      calibrated_at = excluded.calibrated_at`,
    calibration.id,
    calibration.targetId,
    calibration.kind,
    calibration.pixelsPerInchX,
    calibration.pixelsPerInchY,
    serializeJson(reference),
    calibration.calibratedAt,
  );
}

export function latestCalibrationRow(
  database: SQLiteDatabase,
  targetId: string,
): Promise<TargetCalibrationRow | null> {
  return database.getFirstAsync<TargetCalibrationRow>(
    `SELECT ${CALIBRATION_COLUMNS} FROM target_calibrations
     WHERE target_id = ? ORDER BY calibrated_at DESC LIMIT 1`,
    targetId,
  );
}

export function mapTargetCalibration(row: TargetCalibrationRow): TargetCalibration {
  const base = {
    id: row.id,
    targetId: row.target_id,
    kind: row.kind,
    pixelsPerInchX: row.pixels_per_inch_x,
    pixelsPerInchY: row.pixels_per_inch_y,
    calibratedAt: row.calibrated_at,
  };
  if (row.kind === 'manual') {
    return Object.freeze({ ...base, kind: 'manual' });
  }

  const reference = deserializeJson<
    Extract<TargetCalibration, { readonly kind: typeof row.kind }>['reference']
  >(row.reference_json);
  if (!reference) {
    throw new Error(`Calibration ${row.id} is missing its reference geometry.`);
  }
  return Object.freeze({ ...base, kind: row.kind, reference } as TargetCalibration);
}
