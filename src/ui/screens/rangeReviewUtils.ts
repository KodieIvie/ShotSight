import type { Capture, Shot, ShotGroup } from '../../domain';

export interface HeatmapCell {
  readonly column: number;
  readonly row: number;
  readonly count: number;
  /** A 0..1 value relative to the densest displayed cell. */
  readonly intensity: number;
}

/**
 * A target reset starts a new visual timeline. Historical impacts remain in
 * the session, but must never be drawn over a freshly replaced target.
 */
export function shotsForTargetBaseline(
  shots: readonly Shot[],
  targetId: string | undefined,
  baselineRevision: number | undefined,
): readonly Shot[] {
  if (!targetId || !baselineRevision) return Object.freeze([]);
  return Object.freeze(
    shots
      .filter(
        (shot) =>
          shot.targetId === targetId && shot.baselineRevision === baselineRevision,
      )
      .sort((left, right) => left.number - right.number),
  );
}

/**
 * Like shot playback, image comparison must not cross a target reset. An old
 * capture can remain in session history, but it belongs to a different target
 * surface and must not be selected for the current comparison baseline.
 */
export function capturesForTargetBaseline(
  captures: readonly Capture[],
  targetId: string | undefined,
  baselineRevision: number | undefined,
): readonly Capture[] {
  if (!targetId || !baselineRevision) return Object.freeze([]);
  return Object.freeze(
    captures
      .filter(
        (capture) =>
          capture.targetId === targetId
          && capture.baselineRevision === baselineRevision,
      )
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber),
  );
}

/**
 * Selects the shots represented by a visual review filter. Group-specific
 * statistic exclusions and global flyer flags are hidden by default, but the
 * caller can make them visible without modifying the saved record.
 */
export function selectRangeReviewShots(
  targetShots: readonly Shot[],
  group: ShotGroup | undefined,
  includeExcluded: boolean,
): readonly Shot[] {
  if (!group) {
    return Object.freeze(
      targetShots.filter((shot) => includeExcluded || !shot.isFlyer),
    );
  }

  const members = new Map(
    group.members.map((member) => [member.shotId, member]),
  );
  return Object.freeze(
    targetShots.filter((shot) => {
      const membership = members.get(shot.id);
      if (!membership) return false;
      return includeExcluded || (!shot.isFlyer && !membership.excludeFromStatistics);
    }),
  );
}

/** Returns the exact prefix that should be visible at a playback position. */
export function shotsAtPlaybackPosition(
  shots: readonly Shot[],
  position: number,
): readonly Shot[] {
  const count = Math.max(0, Math.min(shots.length, Math.floor(position)));
  return Object.freeze(shots.slice(0, count));
}

/**
 * Builds a small deterministic density grid, avoiding a heavy graphics or
 * cloud dependency. The result is expressed in normalized image cells so the
 * native canvas can stretch with its source image without coordinate drift.
 */
export function buildShotHeatmap(
  shots: readonly Pick<Shot, 'position'>[],
  widthPixels: number,
  heightPixels: number,
  columns = 14,
  rows = 14,
): readonly HeatmapCell[] {
  if (
    !Number.isFinite(widthPixels) || widthPixels <= 0 ||
    !Number.isFinite(heightPixels) || heightPixels <= 0 ||
    !Number.isInteger(columns) || columns < 1 ||
    !Number.isInteger(rows) || rows < 1
  ) {
    return Object.freeze([]);
  }

  const counts = new Map<number, number>();
  for (const shot of shots) {
    if (!Number.isFinite(shot.position.x) || !Number.isFinite(shot.position.y)) {
      continue;
    }
    const x = clampUnit(shot.position.x / widthPixels);
    const y = clampUnit(shot.position.y / heightPixels);
    const column = Math.min(columns - 1, Math.floor(x * columns));
    const row = Math.min(rows - 1, Math.floor(y * rows));
    const key = row * columns + column;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const maximum = Math.max(0, ...counts.values());
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([key, count]) => Object.freeze({
        column: key % columns,
        row: Math.floor(key / columns),
        count,
        // A square-root curve makes a 1-shot cell visible while preserving a
        // useful distinction in tight groups.
        intensity: maximum ? Math.sqrt(count / maximum) : 0,
      })),
  );
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
