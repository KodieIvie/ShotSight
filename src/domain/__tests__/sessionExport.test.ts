import { describe, expect, it } from 'vitest';

import {
  buildSessionCsvDocument,
  createSessionCsvFilename,
  escapeCsvText,
  SESSION_CSV_COLUMNS,
  type SessionCsvExportInput,
} from '../sessionExport';

function makeInput(): SessionCsvExportInput {
  return {
    exportedAt: '2026-09-01T12:34:56.000Z',
    session: {
      id: 'session-1',
      title: 'Load A / September',
      startedAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
      rangeName: 'North Ridge',
      targetDistanceYards: 100,
      cameraProfileId: 'rtsp://should-not-appear.example/private',
      targetType: 'paper',
      caliber: { name: '.308', bulletDiameterInches: 0.308 },
      firearmName: 'Practice rifle',
      ammunitionName: '168 gr test lot',
      notes: 'Cold morning',
      status: 'active',
    },
    targets: [
      {
        id: 'target-1',
        sessionId: 'session-1',
        name: 'Primary bull',
        type: 'paper',
        baseline: {
          captureId: 'capture-baseline',
          revision: 1,
          establishedAt: '2026-09-01T11:05:00.000Z',
          reason: 'initial',
        },
        calibration: {
          id: 'calibration-1',
          targetId: 'target-1',
          calibratedAt: '2026-09-01T11:06:00.000Z',
          kind: 'manual',
          pixelsPerInchX: 200,
          pixelsPerInchY: 201,
        },
        pointOfAim: { x: 1000, y: 1000 },
        desiredZeroPoint: { x: 1002, y: 998 },
        createdAt: '2026-09-01T11:00:00.000Z',
        updatedAt: '2026-09-01T11:06:00.000Z',
      },
      {
        id: 'target-2',
        sessionId: 'session-1',
        name: 'Backup',
        type: 'paper',
        createdAt: '2026-09-01T11:30:00.000Z',
        updatedAt: '2026-09-01T11:30:00.000Z',
      },
    ],
    shots: [
      {
        id: 'shot-2',
        sessionId: 'session-1',
        targetId: 'target-1',
        captureId: 'capture-2',
        number: 2,
        position: { x: 1012.5, y: 990.25 },
        confirmedAt: '2026-09-01T11:20:00.000Z',
        baselineRevision: 1,
        source: 'automatic',
        confidence: 0.92,
        caliberDiameterInches: 0.308,
        note: 'second',
        isColdBore: false,
        isFlyer: true,
      },
      {
        id: 'shot-1',
        sessionId: 'session-1',
        targetId: 'target-1',
        captureId: 'capture-1',
        number: 1,
        position: { x: 990, y: 1005 },
        confirmedAt: '2026-09-01T11:10:00.000Z',
        baselineRevision: 1,
        source: 'manual',
        isColdBore: true,
        isFlyer: false,
      },
    ],
    groups: [
      {
        id: 'group-1',
        sessionId: 'session-1',
        targetId: 'target-1',
        label: 'Load A',
        color: '#E8B84B',
        members: [
          { shotId: 'shot-2', excludeFromStatistics: true },
          { shotId: 'shot-1', excludeFromStatistics: false },
        ],
        createdAt: '2026-09-01T11:25:00.000Z',
        updatedAt: '2026-09-01T11:25:00.000Z',
      },
    ],
  };
}

describe('session CSV export', () => {
  it('writes stable session, target, shot, and group records without private camera data', () => {
    const document = buildSessionCsvDocument(makeInput());
    const records = readCsv(document.contents);
    const [header, ...rows] = records;
    const rowByType = new Map(rows.map((row) => [row[0], asRecord(header, row)]));
    const shotRows = rows
      .map((row) => asRecord(header, row))
      .filter((row) => row.record_type === 'shot');

    expect(header).toEqual(SESSION_CSV_COLUMNS);
    expect(document.rowCount).toBe(7);
    expect(rowByType.get('session')).toMatchObject({
      session_title: 'Load A / September',
      session_total_targets: '2',
      session_total_shots: '2',
      session_total_groups: '1',
    });
    expect(shotRows.map((row) => row.shot_number)).toEqual(['1', '2']);
    expect(shotRows[0]).toMatchObject({
      target_name: 'Primary bull',
      is_cold_bore: 'true',
      shot_group_labels: 'Load A',
      shot_excluded_group_labels: '',
    });
    expect(shotRows[1]).toMatchObject({
      is_flyer: 'true',
      shot_excluded_group_labels: 'Load A',
    });
    expect(rowByType.get('group')).toMatchObject({
      group_member_count: '2',
      group_included_member_count: '1',
      group_member_shot_numbers: '1 | 2',
      group_excluded_shot_numbers: '2',
    });
    expect(document.contents).not.toContain('rtsp://should-not-appear.example');
  });

  it('neutralizes formula-looking user text and preserves embedded CSV punctuation', () => {
    const input = makeInput();
    const dangerousInput: SessionCsvExportInput = {
      ...input,
      session: {
        ...input.session,
        title: '=HYPERLINK("https://example.test", "click")',
        notes: '\t@SUM(1,1)',
      },
      targets: [{ ...input.targets[0], name: 'A, "quoted" target\nwith a second line' }],
      shots: input.shots.slice(0, 1),
      groups: [{
        ...input.groups[0],
        members: [{ shotId: 'shot-2', excludeFromStatistics: false }],
      }],
    };

    const records = readCsv(buildSessionCsvDocument(dangerousInput).contents);
    const [header, ...rows] = records;
    const session = asRecord(header, rows.find((row) => row[0] === 'session')!);
    const target = asRecord(header, rows.find((row) => row[0] === 'target')!);

    expect(session.session_title).toBe("'=HYPERLINK(\"https://example.test\", \"click\")");
    expect(session.session_notes).toBe("'\t@SUM(1,1)");
    expect(target.target_name).toBe('A, "quoted" target\nwith a second line');
    expect(escapeCsvText('plain, "quoted"')).toBe('"plain, ""quoted"""');
  });

  it('rejects cross-session data instead of silently exporting it', () => {
    const input = makeInput();
    expect(() => buildSessionCsvDocument({
      ...input,
      shots: [{ ...input.shots[0], sessionId: 'different-session' }],
      groups: [],
    })).toThrow('outside the supplied session');
  });

  it('generates a path-safe, timestamped filename', () => {
    expect(createSessionCsvFilename('Load A / 100 yd!', '2026-09-01T12:34:56.000Z', 'A8F-90 z')).toBe(
      'shotsight-load-a-100-yd-20260901123456000-a8f-90-z.csv',
    );
  });
});

function asRecord(header: readonly string[], row: readonly string[]): Record<string, string> {
  return Object.fromEntries(header.map((column, index) => [column, row[index] ?? '']));
}

/** Small RFC 4180 parser used only to assert the generated document. */
function readCsv(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\r' && contents[index + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
    } else {
      cell += character;
    }
  }
  return rows;
}
