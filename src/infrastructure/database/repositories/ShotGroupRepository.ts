import type { SQLiteDatabase } from 'expo-sqlite';

import type { ShotGroup, ShotGroupMembership } from '../../../domain';
import { fromIntegerBoolean, toIntegerBoolean } from '../serialization';

interface ShotGroupRow {
  readonly id: string;
  readonly session_id: string;
  readonly target_id: string;
  readonly label: string;
  readonly color: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ShotGroupMemberRow {
  readonly group_id: string;
  readonly shot_id: string;
  readonly exclude_from_statistics: number;
}

const GROUP_COLUMNS = 'id, session_id, target_id, label, color, created_at, updated_at';

export class ShotGroupRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async upsert(group: ShotGroup): Promise<void> {
    assertUniqueMembers(group.members);
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      await assertMembersBelongToTarget(database, group.targetId, group.members);
      await database.runAsync(
        `INSERT INTO shot_groups (
          id, session_id, target_id, label, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          color = excluded.color,
          updated_at = excluded.updated_at`,
        group.id,
        group.sessionId,
        group.targetId,
        group.label,
        group.color ?? null,
        group.createdAt,
        group.updatedAt,
      );
      await database.runAsync('DELETE FROM shot_group_members WHERE group_id = ?', group.id);
      for (const member of group.members) {
        await database.runAsync(
          `INSERT INTO shot_group_members (group_id, shot_id, exclude_from_statistics)
           VALUES (?, ?, ?)`,
          group.id,
          member.shotId,
          toIntegerBoolean(member.excludeFromStatistics),
        );
      }
    });
  }

  async findById(id: string): Promise<ShotGroup | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<ShotGroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM shot_groups WHERE id = ?`,
      id,
    );
    return row ? hydrateGroup(database, row) : null;
  }

  async listForTarget(targetId: string): Promise<readonly ShotGroup[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<ShotGroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM shot_groups
       WHERE target_id = ? ORDER BY created_at ASC`,
      targetId,
    );
    return Promise.all(rows.map((row) => hydrateGroup(database, row)));
  }

  /**
   * Session export needs every group, including groups on targets other than
   * the currently selected one. Hydration preserves each group's independent
   * membership/statistic exclusions.
   */
  async listForSession(sessionId: string): Promise<readonly ShotGroup[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<ShotGroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM shot_groups
       WHERE session_id = ? ORDER BY created_at ASC`,
      sessionId,
    );
    return Promise.all(rows.map((row) => hydrateGroup(database, row)));
  }

  async setMemberExclusion(
    groupId: string,
    shotId: string,
    excludeFromStatistics: boolean,
  ): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync(
      `UPDATE shot_group_members SET exclude_from_statistics = ?
       WHERE group_id = ? AND shot_id = ?`,
      toIntegerBoolean(excludeFromStatistics),
      groupId,
      shotId,
    );
    return result.changes > 0;
  }

  async remove(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM shot_groups WHERE id = ?', id);
    return result.changes > 0;
  }
}

async function hydrateGroup(database: SQLiteDatabase, row: ShotGroupRow): Promise<ShotGroup> {
  const members = await database.getAllAsync<ShotGroupMemberRow>(
    `SELECT group_id, shot_id, exclude_from_statistics
     FROM shot_group_members WHERE group_id = ? ORDER BY rowid ASC`,
    row.id,
  );
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    targetId: row.target_id,
    label: row.label,
    color: row.color ?? undefined,
    members: Object.freeze(
      members.map((member) =>
        Object.freeze({
          shotId: member.shot_id,
          excludeFromStatistics: fromIntegerBoolean(member.exclude_from_statistics),
        }),
      ),
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function assertUniqueMembers(members: readonly ShotGroupMembership[]): void {
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.shotId)) {
      throw new Error(`Shot ${member.shotId} occurs more than once in the group.`);
    }
    seen.add(member.shotId);
  }
}

async function assertMembersBelongToTarget(
  database: SQLiteDatabase,
  targetId: string,
  members: readonly ShotGroupMembership[],
): Promise<void> {
  for (const member of members) {
    const row = await database.getFirstAsync<{ readonly target_id: string }>(
      'SELECT target_id FROM shots WHERE id = ?',
      member.shotId,
    );
    if (!row || row.target_id !== targetId) {
      throw new Error(`Shot ${member.shotId} does not belong to target ${targetId}.`);
    }
  }
}
