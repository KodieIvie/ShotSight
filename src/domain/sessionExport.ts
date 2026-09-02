import type { Session, Target } from './session';
import type { Shot, ShotGroup } from './shot';

/**
 * A deliberately flat, spreadsheet-friendly description of one range session.
 * It contains results and user-entered metadata, but never camera endpoints,
 * credentials, original image URIs, or image bytes.
 */
export interface SessionCsvExportInput {
  readonly session: Session;
  readonly targets: readonly Target[];
  readonly shots: readonly Shot[];
  readonly groups: readonly ShotGroup[];
  /** ISO timestamp chosen by the caller so exports are deterministic in tests. */
  readonly exportedAt: string;
}

export interface SessionCsvDocument {
  readonly mimeType: 'text/csv';
  readonly contents: string;
  /** Includes the header row. */
  readonly rowCount: number;
}

/**
 * Explicit columns make an export stable for users who import it into a
 * spreadsheet or a downstream ballistic notebook. Row types share a single
 * file so sessions with no shots or empty groups still retain their context.
 */
export const SESSION_CSV_COLUMNS = Object.freeze([
  'record_type',
  'exported_at',
  'session_id',
  'session_title',
  'session_started_at',
  'session_updated_at',
  'session_ended_at',
  'session_status',
  'range_name',
  'target_distance_yards',
  'session_target_type',
  'caliber_name',
  'session_bullet_diameter_inches',
  'firearm_name',
  'ammunition_name',
  'session_notes',
  'session_total_targets',
  'session_total_shots',
  'session_total_groups',
  'target_id',
  'target_name',
  'target_type',
  'target_created_at',
  'target_updated_at',
  'baseline_capture_id',
  'baseline_revision',
  'baseline_established_at',
  'baseline_reason',
  'calibration_kind',
  'calibration_pixels_per_inch_x',
  'calibration_pixels_per_inch_y',
  'calibration_established_at',
  'point_of_aim_x_pixels',
  'point_of_aim_y_pixels',
  'desired_zero_x_pixels',
  'desired_zero_y_pixels',
  'shot_number',
  'shot_id',
  'shot_capture_id',
  'shot_confirmed_at',
  'shot_baseline_revision',
  'shot_source',
  'shot_confidence',
  'shot_position_x_pixels',
  'shot_position_y_pixels',
  'shot_caliber_diameter_inches',
  'is_cold_bore',
  'is_flyer',
  'shot_note',
  'shot_group_labels',
  'shot_excluded_group_labels',
  'group_id',
  'group_label',
  'group_color',
  'group_created_at',
  'group_updated_at',
  'group_member_count',
  'group_included_member_count',
  'group_member_shot_numbers',
  'group_excluded_shot_numbers',
] as const);

export type SessionCsvColumn = (typeof SESSION_CSV_COLUMNS)[number];

type CsvCellValue = string | number | boolean | undefined;
type SessionCsvRow = Partial<Record<SessionCsvColumn, CsvCellValue>>;

interface ExportLookup {
  readonly targetsById: ReadonlyMap<string, Target>;
  readonly shotsById: ReadonlyMap<string, Shot>;
}

interface ShotGroupLabels {
  readonly labels: readonly string[];
  readonly excludedLabels: readonly string[];
}

/**
 * Builds a UTF-8 RFC 4180-compatible CSV document. User-entered text is
 * neutralized when it would otherwise be interpreted as a spreadsheet formula.
 */
export function buildSessionCsvDocument(input: SessionCsvExportInput): SessionCsvDocument {
  const lookup = validateExportInput(input);
  const rows: SessionCsvRow[] = [];
  const sessionFields = buildSessionFields(input);
  const labelsByShot = buildShotGroupLabels(input.groups, lookup.shotsById);

  rows.push({
    record_type: 'session',
    ...sessionFields,
  });

  const targets = [...input.targets].sort(compareByCreatedAtThenId);
  for (const target of targets) {
    rows.push({
      record_type: 'target',
      ...sessionFields,
      ...buildTargetFields(target),
    });
  }

  const shots = [...input.shots].sort(
    (left, right) => left.number - right.number || left.id.localeCompare(right.id),
  );
  for (const shot of shots) {
    const target = lookup.targetsById.get(shot.targetId);
    // validateExportInput guarantees target exists, but retaining this guard
    // makes an accidental cross-session caller failure unmistakable.
    if (!target) throw new RangeError(`Shot ${shot.id} references an unknown target.`);
    const labels = labelsByShot.get(shot.id) ?? EMPTY_SHOT_GROUP_LABELS;
    rows.push({
      record_type: 'shot',
      ...sessionFields,
      ...buildTargetFields(target),
      ...buildShotFields(shot, labels),
    });
  }

  const groups = [...input.groups].sort(compareByCreatedAtThenId);
  for (const group of groups) {
    const target = lookup.targetsById.get(group.targetId);
    if (!target) throw new RangeError(`Group ${group.id} references an unknown target.`);
    rows.push({
      record_type: 'group',
      ...sessionFields,
      ...buildTargetFields(target),
      ...buildGroupFields(group, lookup.shotsById),
    });
  }

  const renderedRows = [
    SESSION_CSV_COLUMNS.join(','),
    ...rows.map(renderCsvRow),
  ];
  return Object.freeze({
    mimeType: 'text/csv',
    contents: `${renderedRows.join('\r\n')}\r\n`,
    rowCount: renderedRows.length,
  });
}

/**
 * Produces a path-safe filename fragment. The caller still supplies a random
 * suffix and the local writer refuses to overwrite an existing file.
 */
export function createSessionCsvFilename(
  sessionTitle: string,
  exportedAt: string,
  uniqueSuffix: string,
): string {
  const title = truncateFilenameSlug(toFilenameSlug(sessionTitle), 48) || 'session';
  const timestamp = toFilenameTimestamp(exportedAt);
  const suffix = truncateFilenameSlug(toFilenameSlug(uniqueSuffix), 24) || 'export';
  return `shotsight-${title}-${timestamp}-${suffix}.csv`;
}

/** Escapes a text cell and blocks spreadsheet formula interpretation. */
export function escapeCsvText(value: string): string {
  const protectedValue = protectSpreadsheetText(value);
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function validateExportInput(input: SessionCsvExportInput): ExportLookup {
  if (!input.session.id.trim()) throw new RangeError('A session id is required for CSV export.');
  if (!input.session.title.trim()) throw new RangeError('A session title is required for CSV export.');
  if (!input.exportedAt.trim()) throw new RangeError('An export timestamp is required for CSV export.');

  const targetsById = new Map<string, Target>();
  for (const target of input.targets) {
    if (target.sessionId !== input.session.id) {
      throw new RangeError(`Target ${target.id} is outside the supplied session.`);
    }
    if (targetsById.has(target.id)) throw new RangeError(`Duplicate target id: ${target.id}`);
    targetsById.set(target.id, target);
  }

  const shotsById = new Map<string, Shot>();
  for (const shot of input.shots) {
    if (shot.sessionId !== input.session.id) {
      throw new RangeError(`Shot ${shot.id} is outside the supplied session.`);
    }
    if (!targetsById.has(shot.targetId)) {
      throw new RangeError(`Shot ${shot.id} references a target outside the supplied session.`);
    }
    if (shotsById.has(shot.id)) throw new RangeError(`Duplicate shot id: ${shot.id}`);
    shotsById.set(shot.id, shot);
  }

  const groupIds = new Set<string>();
  for (const group of input.groups) {
    if (group.sessionId !== input.session.id) {
      throw new RangeError(`Group ${group.id} is outside the supplied session.`);
    }
    if (!targetsById.has(group.targetId)) {
      throw new RangeError(`Group ${group.id} references a target outside the supplied session.`);
    }
    if (groupIds.has(group.id)) throw new RangeError(`Duplicate group id: ${group.id}`);
    groupIds.add(group.id);
    const memberIds = new Set<string>();
    for (const member of group.members) {
      if (memberIds.has(member.shotId)) {
        throw new RangeError(`Group ${group.id} has duplicate member ${member.shotId}.`);
      }
      memberIds.add(member.shotId);
      const shot = shotsById.get(member.shotId);
      if (!shot || shot.targetId !== group.targetId) {
        throw new RangeError(`Group ${group.id} has a member outside its target.`);
      }
    }
  }

  return Object.freeze({ targetsById, shotsById });
}

function buildSessionFields(input: SessionCsvExportInput): SessionCsvRow {
  const { session } = input;
  return {
    exported_at: input.exportedAt,
    session_id: session.id,
    session_title: session.title,
    session_started_at: session.startedAt,
    session_updated_at: session.updatedAt,
    session_ended_at: session.endedAt,
    session_status: session.status,
    range_name: session.rangeName,
    target_distance_yards: session.targetDistanceYards,
    session_target_type: session.targetType,
    caliber_name: session.caliber?.name,
    session_bullet_diameter_inches: session.caliber?.bulletDiameterInches,
    firearm_name: session.firearmName,
    ammunition_name: session.ammunitionName,
    session_notes: session.notes,
    session_total_targets: input.targets.length,
    session_total_shots: input.shots.length,
    session_total_groups: input.groups.length,
  };
}

function buildTargetFields(target: Target): SessionCsvRow {
  return {
    target_id: target.id,
    target_name: target.name,
    target_type: target.type,
    target_created_at: target.createdAt,
    target_updated_at: target.updatedAt,
    baseline_capture_id: target.baseline?.captureId,
    baseline_revision: target.baseline?.revision,
    baseline_established_at: target.baseline?.establishedAt,
    baseline_reason: target.baseline?.reason,
    calibration_kind: target.calibration?.kind,
    calibration_pixels_per_inch_x: target.calibration?.pixelsPerInchX,
    calibration_pixels_per_inch_y: target.calibration?.pixelsPerInchY,
    calibration_established_at: target.calibration?.calibratedAt,
    point_of_aim_x_pixels: target.pointOfAim?.x,
    point_of_aim_y_pixels: target.pointOfAim?.y,
    desired_zero_x_pixels: target.desiredZeroPoint?.x,
    desired_zero_y_pixels: target.desiredZeroPoint?.y,
  };
}

function buildShotFields(shot: Shot, labels: ShotGroupLabels): SessionCsvRow {
  return {
    shot_number: shot.number,
    shot_id: shot.id,
    shot_capture_id: shot.captureId,
    shot_confirmed_at: shot.confirmedAt,
    shot_baseline_revision: shot.baselineRevision,
    shot_source: shot.source,
    shot_confidence: shot.confidence,
    shot_position_x_pixels: shot.position.x,
    shot_position_y_pixels: shot.position.y,
    shot_caliber_diameter_inches: shot.caliberDiameterInches,
    is_cold_bore: shot.isColdBore,
    is_flyer: shot.isFlyer,
    shot_note: shot.note,
    shot_group_labels: labels.labels.join(' | '),
    shot_excluded_group_labels: labels.excludedLabels.join(' | '),
  };
}

function buildGroupFields(
  group: ShotGroup,
  shotsById: ReadonlyMap<string, Shot>,
): SessionCsvRow {
  const members = group.members
    .map((member) => Object.freeze({ member, shot: shotsById.get(member.shotId)! }))
    .sort((left, right) => left.shot.number - right.shot.number || left.shot.id.localeCompare(right.shot.id));
  const included = members.filter(({ member, shot }) => !member.excludeFromStatistics && !shot.isFlyer);
  return {
    group_id: group.id,
    group_label: group.label,
    group_color: group.color,
    group_created_at: group.createdAt,
    group_updated_at: group.updatedAt,
    group_member_count: members.length,
    group_included_member_count: included.length,
    group_member_shot_numbers: members.map(({ shot }) => String(shot.number)).join(' | '),
    group_excluded_shot_numbers: members
      .filter(({ member }) => member.excludeFromStatistics)
      .map(({ shot }) => String(shot.number))
      .join(' | '),
  };
}

function buildShotGroupLabels(
  groups: readonly ShotGroup[],
  shotsById: ReadonlyMap<string, Shot>,
): ReadonlyMap<string, ShotGroupLabels> {
  const mutable = new Map<string, { labels: string[]; excludedLabels: string[] }>();
  for (const group of [...groups].sort(compareByCreatedAtThenId)) {
    for (const member of group.members) {
      // Membership integrity is checked before this function is called.
      if (!shotsById.has(member.shotId)) continue;
      const current = mutable.get(member.shotId) ?? { labels: [], excludedLabels: [] };
      current.labels.push(group.label);
      if (member.excludeFromStatistics) current.excludedLabels.push(group.label);
      mutable.set(member.shotId, current);
    }
  }
  return new Map(
    [...mutable].map(([shotId, labels]) => [
      shotId,
      Object.freeze({
        labels: Object.freeze([...labels.labels]),
        excludedLabels: Object.freeze([...labels.excludedLabels]),
      }),
    ]),
  );
}

function renderCsvRow(row: SessionCsvRow): string {
  return SESSION_CSV_COLUMNS.map((column) => renderCsvCell(row[column])).join(',');
}

function renderCsvCell(value: CsvCellValue): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return escapeCsvText(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (!Number.isFinite(value)) throw new RangeError('CSV exports cannot contain non-finite numeric values.');
  return String(value);
}

function protectSpreadsheetText(value: string): string {
  // Spreadsheet apps can ignore leading whitespace before treating a cell as a
  // formula. A leading apostrophe forces literal display without losing data.
  return /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function compareByCreatedAtThenId<T extends { readonly createdAt: string; readonly id: string }>(
  left: T,
  right: T,
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function toFilenameSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function truncateFilenameSlug(value: string, maximumLength: number): string {
  return value.slice(0, maximumLength).replace(/-+$/g, '');
}

function toFilenameTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'undated';
  return date.toISOString().replace(/[-:.TZ]/g, '');
}

const EMPTY_SHOT_GROUP_LABELS: ShotGroupLabels = Object.freeze({
  labels: Object.freeze([]),
  excludedLabels: Object.freeze([]),
});
