import type { SQLiteDatabase } from 'expo-sqlite';

import type { ConfirmShotInput, Shot } from '../../../domain';
import { fromIntegerBoolean, toIntegerBoolean } from '../serialization';

interface ShotRow {
  readonly id: string;
  readonly session_id: string;
  readonly target_id: string;
  readonly capture_id: string | null;
  readonly shot_number: number;
  readonly position_x: number;
  readonly position_y: number;
  readonly confirmed_at: string;
  readonly baseline_revision: number;
  readonly source: Shot['source'];
  readonly confidence: number | null;
  readonly caliber_diameter_inches: number | null;
  readonly note: string | null;
  readonly is_cold_bore: number;
  readonly is_flyer: number;
}

interface PendingAnalysisCandidateRow {
  readonly id: string;
  readonly session_id: string;
  readonly target_id: string;
  readonly capture_id: string;
  readonly baseline_revision: number;
  readonly state: 'pending' | 'confirmed' | 'rejected';
}

const SHOT_COLUMNS = `
  id, session_id, target_id, capture_id, shot_number,
  position_x, position_y, confirmed_at, baseline_revision, source,
  confidence, caliber_diameter_inches, note, is_cold_bore, is_flyer
`;

export class ShotRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  /** Confirms a shot and allocates max(number)+1 atomically in SQLite. */
  async confirm(input: ConfirmShotInput): Promise<Shot> {
    const database = await this.getDatabase();
    await insertConfirmedShot(database, input);
    const saved = await this.findById(input.id);
    if (!saved) {
      throw new Error('The confirmed shot could not be loaded.');
    }
    return saved;
  }

  /**
   * Commits the numbered automatic shot and its pending analysis-candidate
   * review together. A retry cannot allocate a second shot for the same
   * candidate, even if the UI receives a duplicate tap or reconnect event.
   */
  async confirmAnalysisCandidate(
    candidateId: string,
    input: ConfirmShotInput,
  ): Promise<Shot> {
    if (!input.captureId) {
      throw new Error('An automatic analysis candidate must be tied to a capture.');
    }
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      const candidate = await database.getFirstAsync<PendingAnalysisCandidateRow>(
        `SELECT id, session_id, target_id, capture_id, baseline_revision, state
         FROM analysis_candidates WHERE id = ?`,
        candidateId,
      );
      if (!candidate) {
        throw new Error(`Analysis candidate ${candidateId} does not exist.`);
      }
      if (candidate.state !== 'pending') {
        throw new Error(`Analysis candidate ${candidateId} has already been reviewed.`);
      }
      if (
        candidate.session_id !== input.sessionId ||
        candidate.target_id !== input.targetId ||
        candidate.capture_id !== input.captureId ||
        candidate.baseline_revision !== input.baselineRevision
      ) {
        throw new Error('Analysis candidate and shot metadata do not describe the same target capture.');
      }
      await insertConfirmedShot(database, input);
      const reviewed = await database.runAsync(
        `UPDATE analysis_candidates SET
          state = 'confirmed', reviewed_at = ?, confirmed_shot_id = ?,
          rejection_reason = NULL, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
        input.confirmedAt,
        input.id,
        input.confirmedAt,
        candidateId,
      );
      if (reviewed.changes !== 1) {
        throw new Error(`Analysis candidate ${candidateId} was reviewed by another operation.`);
      }
    });
    const saved = await this.findById(input.id);
    if (!saved) {
      throw new Error('The confirmed analysis shot could not be loaded.');
    }
    return saved;
  }

  async upsert(shot: Shot): Promise<void> {
    const database = await this.getDatabase();
    await database.runAsync(
      `INSERT INTO shots (
        id, session_id, target_id, capture_id, shot_number,
        position_x, position_y, confirmed_at, baseline_revision, source,
        confidence, caliber_diameter_inches, note, is_cold_bore, is_flyer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        capture_id = excluded.capture_id,
        position_x = excluded.position_x,
        position_y = excluded.position_y,
        confidence = excluded.confidence,
        caliber_diameter_inches = excluded.caliber_diameter_inches,
        note = excluded.note,
        is_cold_bore = excluded.is_cold_bore,
        is_flyer = excluded.is_flyer`,
      shot.id,
      shot.sessionId,
      shot.targetId,
      shot.captureId ?? null,
      shot.number,
      shot.position.x,
      shot.position.y,
      shot.confirmedAt,
      shot.baselineRevision,
      shot.source,
      shot.confidence ?? null,
      shot.caliberDiameterInches ?? null,
      shot.note ?? null,
      toIntegerBoolean(shot.isColdBore),
      toIntegerBoolean(shot.isFlyer),
    );
  }

  async findById(id: string): Promise<Shot | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<ShotRow>(
      `SELECT ${SHOT_COLUMNS} FROM shots WHERE id = ?`,
      id,
    );
    return row ? mapShot(row) : null;
  }

  async listForSession(sessionId: string): Promise<readonly Shot[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<ShotRow>(
      `SELECT ${SHOT_COLUMNS} FROM shots
       WHERE session_id = ? ORDER BY shot_number ASC`,
      sessionId,
    );
    return rows.map(mapShot);
  }

  async listForTarget(targetId: string): Promise<readonly Shot[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<ShotRow>(
      `SELECT ${SHOT_COLUMNS} FROM shots
       WHERE target_id = ? ORDER BY shot_number ASC`,
      targetId,
    );
    return rows.map(mapShot);
  }

  async setFlyer(id: string, isFlyer: boolean): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync(
      'UPDATE shots SET is_flyer = ? WHERE id = ?',
      toIntegerBoolean(isFlyer),
      id,
    );
    return result.changes > 0;
  }

  /**
   * A session has at most one designated cold-bore shot. The first confirmed
   * shot is assigned automatically, but this lets the shooter correct that
   * designation later without renumbering or rewriting the shot history.
   */
  async setColdBore(
    sessionId: string,
    shotId: string | undefined,
  ): Promise<void> {
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      if (shotId) {
        const shot = await database.getFirstAsync<{ readonly id: string }>(
          'SELECT id FROM shots WHERE id = ? AND session_id = ?',
          shotId,
          sessionId,
        );
        if (!shot) {
          throw new Error('The selected cold-bore shot is not in this session.');
        }
      }
      await database.runAsync(
        'UPDATE shots SET is_cold_bore = 0 WHERE session_id = ?',
        sessionId,
      );
      if (shotId) {
        await database.runAsync(
          'UPDATE shots SET is_cold_bore = 1 WHERE id = ?',
          shotId,
        );
      }
    });
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM shots WHERE id = ?', id);
    return result.changes > 0;
  }
}

function insertConfirmedShot(
  database: SQLiteDatabase,
  input: ConfirmShotInput,
): Promise<unknown> {
  return database.runAsync(
    `INSERT INTO shots (
      id, session_id, target_id, capture_id, shot_number,
      position_x, position_y, confirmed_at, baseline_revision, source,
      confidence, caliber_diameter_inches, note, is_cold_bore, is_flyer
    ) SELECT
      $id, $sessionId, $targetId, $captureId,
      COALESCE(MAX(shot_number), 0) + 1,
      $positionX, $positionY, $confirmedAt, $baselineRevision, $source,
      $confidence, $caliberDiameterInches, $note,
      COALESCE($isColdBore, CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END),
      $isFlyer
    FROM shots WHERE session_id = $sessionId`,
    {
      $id: input.id,
      $sessionId: input.sessionId,
      $targetId: input.targetId,
      $captureId: input.captureId ?? null,
      $positionX: input.position.x,
      $positionY: input.position.y,
      $confirmedAt: input.confirmedAt,
      $baselineRevision: input.baselineRevision,
      $source: input.source,
      $confidence: input.confidence ?? null,
      $caliberDiameterInches: input.caliberDiameterInches ?? null,
      $note: input.note ?? null,
      $isColdBore:
        input.isColdBore === undefined ? null : toIntegerBoolean(input.isColdBore),
      $isFlyer: toIntegerBoolean(input.isFlyer ?? false),
    },
  );
}

function mapShot(row: ShotRow): Shot {
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    targetId: row.target_id,
    captureId: row.capture_id ?? undefined,
    number: row.shot_number,
    position: Object.freeze({ x: row.position_x, y: row.position_y }),
    confirmedAt: row.confirmed_at,
    baselineRevision: row.baseline_revision,
    source: row.source,
    confidence: row.confidence ?? undefined,
    caliberDiameterInches: row.caliber_diameter_inches ?? undefined,
    note: row.note ?? undefined,
    isColdBore: fromIntegerBoolean(row.is_cold_bore),
    isFlyer: fromIntegerBoolean(row.is_flyer),
  });
}
