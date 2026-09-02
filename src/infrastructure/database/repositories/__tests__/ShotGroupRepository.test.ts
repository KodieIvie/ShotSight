import { describe, expect, it } from 'vitest';

import { ShotGroupRepository } from '../ShotGroupRepository';

interface GroupRow {
  readonly id: string;
  readonly session_id: string;
  readonly target_id: string;
  readonly label: string;
  readonly color: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

describe('ShotGroupRepository session listing', () => {
  it('hydrates every group in a session, not only the currently active target', async () => {
    const groupRows: readonly GroupRow[] = [
      {
        id: 'group-1',
        session_id: 'session-1',
        target_id: 'target-1',
        label: 'Load A',
        color: null,
        created_at: '2026-09-01T10:00:00.000Z',
        updated_at: '2026-09-01T10:00:00.000Z',
      },
      {
        id: 'group-2',
        session_id: 'session-1',
        target_id: 'target-2',
        label: 'Cold bore',
        color: '#E8B84B',
        created_at: '2026-09-01T10:01:00.000Z',
        updated_at: '2026-09-01T10:01:00.000Z',
      },
    ];
    const queries: string[] = [];
    const database = {
      async getAllAsync<T>(sql: string, groupId?: string): Promise<readonly T[]> {
        queries.push(sql);
        if (sql.includes('FROM shot_groups')) return groupRows as readonly T[];
        if (sql.includes('FROM shot_group_members')) {
          if (groupId === 'group-1') {
            return [{ group_id: 'group-1', shot_id: 'shot-1', exclude_from_statistics: 0 }] as unknown as readonly T[];
          }
          return [{ group_id: 'group-2', shot_id: 'shot-2', exclude_from_statistics: 1 }] as unknown as readonly T[];
        }
        return [];
      },
    };
    const repository = new ShotGroupRepository(async () => database as never);

    const groups = await repository.listForSession('session-1');

    expect(groups).toEqual([
      expect.objectContaining({ id: 'group-1', targetId: 'target-1', members: [{ shotId: 'shot-1', excludeFromStatistics: false }] }),
      expect.objectContaining({ id: 'group-2', targetId: 'target-2', members: [{ shotId: 'shot-2', excludeFromStatistics: true }] }),
    ]);
    expect(queries[0]).toContain('WHERE session_id = ?');
  });
});
