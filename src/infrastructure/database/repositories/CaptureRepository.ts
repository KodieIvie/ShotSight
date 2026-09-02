import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CameraCaptureMetadata,
  Capture,
  CaptureAnalysisStatus,
  TargetCaptureMetadata,
} from '../../../domain';
import { deserializeJson, serializeJson } from '../serialization';

interface CaptureRow {
  readonly id: string;
  readonly session_id: string;
  readonly target_id: string | null;
  readonly camera_profile_id: string;
  readonly sequence_number: number;
  readonly baseline_revision: number;
  readonly captured_at: string;
  readonly original_image_uri: string;
  readonly preview_image_uri: string | null;
  readonly width_pixels: number;
  readonly height_pixels: number;
  readonly camera_metadata_json: string | null;
  readonly target_metadata_json: string | null;
  readonly kind: Capture['kind'];
  readonly analysis_status: CaptureAnalysisStatus;
  readonly newly_detected_shot_count: number | null;
  readonly cumulative_shot_count: number | null;
}

const CAPTURE_COLUMNS = `
  id, session_id, target_id, camera_profile_id, sequence_number, baseline_revision,
  captured_at, original_image_uri, preview_image_uri, width_pixels, height_pixels,
  camera_metadata_json, target_metadata_json, kind, analysis_status,
  newly_detected_shot_count, cumulative_shot_count
`;

export class CaptureRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async upsert(capture: Capture): Promise<void> {
    const database = await this.getDatabase();
    await this.upsertWithDatabase(database, capture);
  }

  /** Allocates a monotonically increasing capture sequence without renumbering history. */
  async addWithNextSequence(
    capture: Omit<Capture, 'sequenceNumber'>,
  ): Promise<Capture> {
    const database = await this.getDatabase();
    let saved: Capture | undefined;
    await database.withTransactionAsync(async () => {
      const row = await database.getFirstAsync<{ readonly next_sequence: number }>(
        `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
         FROM captures WHERE session_id = ?`,
        capture.sessionId,
      );
      saved = Object.freeze({ ...capture, sequenceNumber: row?.next_sequence ?? 1 });
      await this.upsertWithDatabase(database, saved);
    });
    if (!saved) {
      throw new Error('The capture sequence could not be allocated.');
    }
    return saved;
  }

  async findById(id: string): Promise<Capture | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<CaptureRow>(
      `SELECT ${CAPTURE_COLUMNS} FROM captures WHERE id = ?`,
      id,
    );
    return row ? mapCapture(row) : null;
  }

  async listForSession(sessionId: string): Promise<readonly Capture[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<CaptureRow>(
      `SELECT ${CAPTURE_COLUMNS} FROM captures
       WHERE session_id = ? ORDER BY sequence_number ASC`,
      sessionId,
    );
    return rows.map(mapCapture);
  }

  async listForTarget(targetId: string): Promise<readonly Capture[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<CaptureRow>(
      `SELECT ${CAPTURE_COLUMNS} FROM captures
       WHERE target_id = ? ORDER BY sequence_number ASC`,
      targetId,
    );
    return rows.map(mapCapture);
  }

  async setAnalysisStatus(id: string, status: CaptureAnalysisStatus): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync(
      'UPDATE captures SET analysis_status = ? WHERE id = ?',
      status,
      id,
    );
    return result.changes > 0;
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM captures WHERE id = ?', id);
    return result.changes > 0;
  }

  private async upsertWithDatabase(database: SQLiteDatabase, capture: Capture): Promise<void> {
    await database.runAsync(
      `INSERT INTO captures (
        id, session_id, target_id, camera_profile_id, sequence_number, baseline_revision,
        captured_at, original_image_uri, preview_image_uri, width_pixels, height_pixels,
        camera_metadata_json, target_metadata_json, kind, analysis_status,
        newly_detected_shot_count, cumulative_shot_count
      ) VALUES (
        $id, $sessionId, $targetId, $cameraProfileId, $sequenceNumber, $baselineRevision,
        $capturedAt, $originalImageUri, $previewImageUri, $widthPixels, $heightPixels,
        $cameraMetadata, $targetMetadata, $kind, $analysisStatus,
        $newlyDetectedShotCount, $cumulativeShotCount
      ) ON CONFLICT(id) DO UPDATE SET
        target_id = excluded.target_id,
        camera_profile_id = excluded.camera_profile_id,
        sequence_number = excluded.sequence_number,
        baseline_revision = excluded.baseline_revision,
        captured_at = excluded.captured_at,
        original_image_uri = excluded.original_image_uri,
        preview_image_uri = excluded.preview_image_uri,
        width_pixels = excluded.width_pixels,
        height_pixels = excluded.height_pixels,
        camera_metadata_json = excluded.camera_metadata_json,
        target_metadata_json = excluded.target_metadata_json,
        kind = excluded.kind,
        analysis_status = excluded.analysis_status,
        newly_detected_shot_count = excluded.newly_detected_shot_count,
        cumulative_shot_count = excluded.cumulative_shot_count`,
      {
        $id: capture.id,
        $sessionId: capture.sessionId,
        $targetId: capture.targetId,
        $cameraProfileId: capture.cameraProfileId,
        $sequenceNumber: capture.sequenceNumber,
        $baselineRevision: capture.baselineRevision,
        $capturedAt: capture.capturedAt,
        $originalImageUri: capture.originalImageUri,
        $previewImageUri: capture.previewImageUri ?? null,
        $widthPixels: capture.widthPixels,
        $heightPixels: capture.heightPixels,
        $cameraMetadata: serializeJson(capture.cameraMetadata),
        $targetMetadata: serializeJson(capture.targetMetadata),
        $kind: capture.kind,
        $analysisStatus: capture.analysisStatus,
        $newlyDetectedShotCount: capture.newlyDetectedShotCount ?? null,
        $cumulativeShotCount: capture.cumulativeShotCount ?? null,
      },
    );
  }
}

function mapCapture(row: CaptureRow): Capture {
  if (row.target_id === null) {
    throw new Error(`Capture ${row.id} is not associated with a target.`);
  }
  const cameraMetadata = deserializeJson<CameraCaptureMetadata>(row.camera_metadata_json);
  if (!cameraMetadata) {
    throw new Error(`Capture ${row.id} has no camera metadata.`);
  }
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    targetId: row.target_id,
    cameraProfileId: row.camera_profile_id,
    sequenceNumber: row.sequence_number,
    baselineRevision: row.baseline_revision,
    capturedAt: row.captured_at,
    originalImageUri: row.original_image_uri,
    previewImageUri: row.preview_image_uri ?? undefined,
    widthPixels: row.width_pixels,
    heightPixels: row.height_pixels,
    cameraMetadata,
    targetMetadata: deserializeJson<TargetCaptureMetadata>(row.target_metadata_json),
    kind: row.kind,
    analysisStatus: row.analysis_status,
    newlyDetectedShotCount: row.newly_detected_shot_count ?? undefined,
    cumulativeShotCount: row.cumulative_shot_count ?? undefined,
  });
}
