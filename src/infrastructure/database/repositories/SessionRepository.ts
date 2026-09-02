import type { SQLiteDatabase } from 'expo-sqlite';

import type { Caliber, Session, SessionStatus } from '../../../domain';
import { deserializeJson, serializeJson } from '../serialization';

interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly started_at: string;
  readonly updated_at: string;
  readonly ended_at: string | null;
  readonly range_name: string | null;
  readonly target_distance_yards: number;
  readonly camera_profile_id: string;
  readonly target_type: Session['targetType'];
  readonly caliber: string | null;
  readonly firearm_name: string | null;
  readonly ammunition_name: string | null;
  readonly notes: string | null;
  readonly status: SessionStatus;
}

const SESSION_COLUMNS = `
  id, title, started_at, updated_at, ended_at, range_name,
  target_distance_yards, camera_profile_id, target_type, caliber,
  firearm_name, ammunition_name, notes, status
`;

export class SessionRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async upsert(session: Session): Promise<void> {
    const database = await this.getDatabase();
    await database.runAsync(
      `INSERT INTO sessions (
        id, title, started_at, updated_at, ended_at, range_name,
        target_distance_yards, camera_profile_id, target_type, caliber,
        firearm_name, ammunition_name, notes, status
      ) VALUES (
        $id, $title, $startedAt, $updatedAt, $endedAt, $rangeName,
        $targetDistanceYards, $cameraProfileId, $targetType, $caliber,
        $firearmName, $ammunitionName, $notes, $status
      ) ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        ended_at = excluded.ended_at,
        range_name = excluded.range_name,
        target_distance_yards = excluded.target_distance_yards,
        camera_profile_id = excluded.camera_profile_id,
        target_type = excluded.target_type,
        caliber = excluded.caliber,
        firearm_name = excluded.firearm_name,
        ammunition_name = excluded.ammunition_name,
        notes = excluded.notes,
        status = excluded.status`,
      {
        $id: session.id,
        $title: session.title,
        $startedAt: session.startedAt,
        $updatedAt: session.updatedAt,
        $endedAt: session.endedAt ?? null,
        $rangeName: session.rangeName ?? null,
        $targetDistanceYards: session.targetDistanceYards,
        $cameraProfileId: session.cameraProfileId,
        $targetType: session.targetType,
        $caliber: serializeJson(session.caliber),
        $firearmName: session.firearmName ?? null,
        $ammunitionName: session.ammunitionName ?? null,
        $notes: session.notes ?? null,
        $status: session.status,
      },
    );
  }

  async findById(id: string): Promise<Session | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`,
      id,
    );
    return row ? mapSession(row) : null;
  }

  async list(status?: SessionStatus): Promise<readonly Session[]> {
    const database = await this.getDatabase();
    const rows = status
      ? await database.getAllAsync<SessionRow>(
          `SELECT ${SESSION_COLUMNS} FROM sessions WHERE status = ? ORDER BY updated_at DESC`,
          status,
        )
      : await database.getAllAsync<SessionRow>(
          `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY updated_at DESC`,
        );
    return rows.map(mapSession);
  }

  async setStatus(
    id: string,
    status: SessionStatus,
    updatedAt: string,
    endedAt?: string,
  ): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync(
      `UPDATE sessions
       SET status = ?, updated_at = ?, ended_at = COALESCE(?, ended_at)
       WHERE id = ?`,
      status,
      updatedAt,
      endedAt ?? null,
      id,
    );
    return result.changes > 0;
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM sessions WHERE id = ?', id);
    return result.changes > 0;
  }
}

function mapSession(row: SessionRow): Session {
  return Object.freeze({
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
    rangeName: row.range_name ?? undefined,
    targetDistanceYards: row.target_distance_yards,
    cameraProfileId: row.camera_profile_id,
    targetType: row.target_type,
    caliber: deserializeJson<Caliber>(row.caliber),
    firearmName: row.firearm_name ?? undefined,
    ammunitionName: row.ammunition_name ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
  });
}
