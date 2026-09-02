import { describe, expect, it } from 'vitest';

import type { Capture, Shot, ShotGroup } from '../../../domain';
import {
  buildShotHeatmap,
  capturesForTargetBaseline,
  selectRangeReviewShots,
  shotsAtPlaybackPosition,
  shotsForTargetBaseline,
} from '../rangeReviewUtils';

function shot(
  id: string,
  number: number,
  x: number,
  y: number,
  options: { readonly revision?: number; readonly flyer?: boolean } = {},
): Shot {
  return Object.freeze({
    id,
    sessionId: 'session-1',
    targetId: 'target-1',
    number,
    position: Object.freeze({ x, y }),
    confirmedAt: '2026-09-01T12:00:00.000Z',
    baselineRevision: options.revision ?? 1,
    source: 'manual',
    isColdBore: number === 1,
    isFlyer: options.flyer ?? false,
  });
}

function capture(
  id: string,
  sequenceNumber: number,
  options: { readonly revision?: number; readonly targetId?: string } = {},
): Capture {
  return Object.freeze({
    id,
    sessionId: 'session-1',
    targetId: options.targetId ?? 'target-1',
    cameraProfileId: 'camera-1',
    sequenceNumber,
    baselineRevision: options.revision ?? 1,
    capturedAt: '2026-09-01T12:00:00.000Z',
    originalImageUri: `file:///captures/${id}.jpg`,
    widthPixels: 2000,
    heightPixels: 1500,
    kind: sequenceNumber === 1 ? 'baseline' : 'observation',
    analysisStatus: 'not-requested',
    cameraMetadata: Object.freeze({ source: 'http-snapshot' as const }),
  });
}

const group: ShotGroup = Object.freeze({
  id: 'group-1',
  sessionId: 'session-1',
  targetId: 'target-1',
  label: 'Load A',
  members: Object.freeze([
    Object.freeze({ shotId: 'shot-1', excludeFromStatistics: false }),
    Object.freeze({ shotId: 'shot-2', excludeFromStatistics: true }),
  ]),
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
});

describe('range review visual data', () => {
  const shots = [
    shot('shot-2', 2, 20, 20),
    shot('shot-1', 1, 10, 10),
    shot('old-shot', 3, 25, 25, { revision: 2 }),
    shot('flyer', 4, 80, 80, { flyer: true }),
  ];

  it('keeps playback confined to the active baseline and ordered by shot number', () => {
    expect(shotsForTargetBaseline(shots, 'target-1', 1).map((item) => item.id))
      .toEqual(['shot-1', 'shot-2', 'flyer']);
    expect(shotsForTargetBaseline(shots, 'target-1', 2).map((item) => item.id))
      .toEqual(['old-shot']);
  });

  it('keeps visual capture comparisons confined to the active baseline', () => {
    const captures = [
      capture('old-baseline', 1),
      capture('new-baseline', 2, { revision: 2 }),
      capture('new-observation', 3, { revision: 2 }),
      capture('other-target', 4, { revision: 2, targetId: 'target-2' }),
    ];

    expect(capturesForTargetBaseline(captures, 'target-1', 2).map((item) => item.id))
      .toEqual(['new-baseline', 'new-observation']);
  });

  it('applies group and exclusion filters without changing shot records', () => {
    const active = shotsForTargetBaseline(shots, 'target-1', 1);
    expect(selectRangeReviewShots(active, group, false).map((item) => item.id))
      .toEqual(['shot-1']);
    expect(selectRangeReviewShots(active, group, true).map((item) => item.id))
      .toEqual(['shot-1', 'shot-2']);
    expect(selectRangeReviewShots(active, undefined, false).map((item) => item.id))
      .toEqual(['shot-1', 'shot-2']);
  });

  it('renders a safe prefix for playback', () => {
    const active = shotsForTargetBaseline(shots, 'target-1', 1);
    expect(shotsAtPlaybackPosition(active, 2).map((item) => item.number)).toEqual([1, 2]);
    expect(shotsAtPlaybackPosition(active, 99)).toHaveLength(3);
    expect(shotsAtPlaybackPosition(active, -1)).toHaveLength(0);
  });

  it('creates a deterministic density grid and clamps edge coordinates', () => {
    const heatmap = buildShotHeatmap(
      [shot('a', 1, 0, 0), shot('b', 2, 99, 99), shot('c', 3, 100, 100)],
      100,
      100,
      2,
      2,
    );
    expect(heatmap).toEqual([
      { column: 0, row: 0, count: 1, intensity: Math.sqrt(1 / 2) },
      { column: 1, row: 1, count: 2, intensity: 1 },
    ]);
  });
});
