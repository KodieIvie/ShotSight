import type { SQLiteDatabase } from 'expo-sqlite';

import {
  reviewAnalysisCandidate,
  validateAnalysisCandidate,
  validateAnalysisJob,
  type AnalysisCandidate,
  type AnalysisCandidateProvenance,
  type AnalysisCandidateState,
  type AnalysisJob,
  type AnalysisJobStatus,
  type AnalysisSensitivity,
  type ReviewAnalysisCandidateInput,
  type ShotCandidateClassification,
  type ShotCandidateScoreBreakdown,
} from '../../../domain';
import { deserializeJson, serializeJson } from '../serialization';

interface AnalysisJobRow {
  readonly id: string;
  readonly session_id: string;
  readonly target_id: string;
  readonly capture_id: string;
  readonly reference_capture_id: string | null;
  readonly baseline_revision: number;
  readonly reference_mode: AnalysisJob['referenceMode'];
  readonly sensitivity_json: string;
  readonly analyzer_id: string;
  readonly analyzer_version: string | null;
  readonly status: AnalysisJobStatus;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly failure_message: string | null;
}

interface AnalysisCandidateRow {
  readonly id: string;
  readonly job_id: string;
  readonly session_id: string;
  readonly target_id: string;
  readonly capture_id: string;
  readonly baseline_revision: number;
  readonly position_x: number;
  readonly position_y: number;
  readonly bounds_x: number;
  readonly bounds_y: number;
  readonly bounds_width: number;
  readonly bounds_height: number;
  readonly area_pixels: number;
  readonly mean_difference: number;
  readonly confidence: number;
  readonly classification: ShotCandidateClassification;
  readonly scores_json: string;
  readonly state: AnalysisCandidateState;
  readonly provenance_json: string;
  readonly reviewed_at: string | null;
  readonly confirmed_shot_id: string | null;
  readonly rejection_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CaptureIdentityRow {
  readonly session_id: string;
  readonly target_id: string | null;
}

interface JobIdentityRow {
  readonly session_id: string;
  readonly target_id: string;
  readonly capture_id: string;
  readonly baseline_revision: number;
}

interface CandidateIdentityRow extends JobIdentityRow {
  readonly job_id: string;
  readonly state: AnalysisCandidateState;
}

interface ShotIdentityRow {
  readonly session_id: string;
  readonly target_id: string;
}

const ANALYSIS_JOB_COLUMNS = `
  id, session_id, target_id, capture_id, reference_capture_id,
  baseline_revision, reference_mode, sensitivity_json, analyzer_id,
  analyzer_version, status, requested_at, started_at, completed_at,
  failure_message
`;

const ANALYSIS_CANDIDATE_COLUMNS = `
  id, job_id, session_id, target_id, capture_id, baseline_revision,
  position_x, position_y, bounds_x, bounds_y, bounds_width, bounds_height,
  area_pixels, mean_difference, confidence, classification, scores_json,
  state, provenance_json, reviewed_at, confirmed_shot_id, rejection_reason,
  created_at, updated_at
`;

const MAX_ANALYSIS_JSON_CHARACTERS = 32_768;

/** Durable local queue and review audit for image-analysis work. */
export class AnalysisRepository {
  constructor(private readonly getDatabase: () => Promise<SQLiteDatabase>) {}

  async upsertJob(job: AnalysisJob): Promise<void> {
    validateAnalysisJob(job);
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      await assertJobCaptureRelationship(database, job);
      await assertJobIdentityIsStable(database, job);
      await upsertJobWithDatabase(database, job);
    });
  }

  async findJobById(id: string): Promise<AnalysisJob | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<AnalysisJobRow>(
      `SELECT ${ANALYSIS_JOB_COLUMNS} FROM analysis_jobs WHERE id = ?`,
      id,
    );
    return row ? mapAnalysisJob(row) : null;
  }

  async listJobsForCapture(captureId: string): Promise<readonly AnalysisJob[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<AnalysisJobRow>(
      `SELECT ${ANALYSIS_JOB_COLUMNS} FROM analysis_jobs
       WHERE capture_id = ? ORDER BY requested_at ASC`,
      captureId,
    );
    return rows.map(mapAnalysisJob);
  }

  async listJobsForTarget(targetId: string): Promise<readonly AnalysisJob[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<AnalysisJobRow>(
      `SELECT ${ANALYSIS_JOB_COLUMNS} FROM analysis_jobs
       WHERE target_id = ? ORDER BY requested_at ASC`,
      targetId,
    );
    return rows.map(mapAnalysisJob);
  }

  async upsertCandidate(candidate: AnalysisCandidate): Promise<void> {
    validateAnalysisCandidate(candidate);
    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      await assertCandidateRelationship(database, candidate);
      await assertCandidateIdentityIsStable(database, candidate);
      await assertConfirmedShotRelationship(database, candidate);
      await upsertCandidateWithDatabase(database, candidate);
    });
  }

  /** Stores a detector result batch atomically after verifying each job/capture link. */
  async upsertCandidates(candidates: readonly AnalysisCandidate[]): Promise<void> {
    if (candidates.length === 0) {
      return;
    }
    const candidateIds = new Set<string>();
    for (const candidate of candidates) {
      if (candidateIds.has(candidate.id)) {
        throw new RangeError(`Duplicate analysis candidate id: ${candidate.id}`);
      }
      candidateIds.add(candidate.id);
      validateAnalysisCandidate(candidate);
    }

    const database = await this.getDatabase();
    await database.withTransactionAsync(async () => {
      for (const candidate of candidates) {
        await assertCandidateRelationship(database, candidate);
        await assertCandidateIdentityIsStable(database, candidate);
        await assertConfirmedShotRelationship(database, candidate);
        await upsertCandidateWithDatabase(database, candidate);
      }
    });
  }

  async findCandidateById(id: string): Promise<AnalysisCandidate | null> {
    const database = await this.getDatabase();
    const row = await database.getFirstAsync<AnalysisCandidateRow>(
      `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates WHERE id = ?`,
      id,
    );
    return row ? mapAnalysisCandidate(row) : null;
  }

  async listCandidatesForJob(jobId: string): Promise<readonly AnalysisCandidate[]> {
    const database = await this.getDatabase();
    const rows = await database.getAllAsync<AnalysisCandidateRow>(
      `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates
       WHERE job_id = ? ORDER BY created_at ASC`,
      jobId,
    );
    return rows.map(mapAnalysisCandidate);
  }

  async listCandidatesForCapture(
    captureId: string,
    state?: AnalysisCandidateState,
  ): Promise<readonly AnalysisCandidate[]> {
    const database = await this.getDatabase();
    const rows = state
      ? await database.getAllAsync<AnalysisCandidateRow>(
          `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates
           WHERE capture_id = ? AND state = ? ORDER BY created_at ASC`,
          captureId,
          state,
        )
      : await database.getAllAsync<AnalysisCandidateRow>(
          `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates
           WHERE capture_id = ? ORDER BY created_at ASC`,
          captureId,
        );
    return rows.map(mapAnalysisCandidate);
  }

  async listCandidatesForTarget(
    targetId: string,
    state?: AnalysisCandidateState,
  ): Promise<readonly AnalysisCandidate[]> {
    const database = await this.getDatabase();
    const rows = state
      ? await database.getAllAsync<AnalysisCandidateRow>(
          `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates
           WHERE target_id = ? AND state = ? ORDER BY created_at ASC`,
          targetId,
          state,
        )
      : await database.getAllAsync<AnalysisCandidateRow>(
          `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates
           WHERE target_id = ? ORDER BY created_at ASC`,
          targetId,
        );
    return rows.map(mapAnalysisCandidate);
  }

  /** Performs a one-way pending -> confirmed/rejected review under a transaction. */
  async reviewCandidate(
    id: string,
    review: ReviewAnalysisCandidateInput,
  ): Promise<AnalysisCandidate> {
    const database = await this.getDatabase();
    let reviewed: AnalysisCandidate | undefined;
    await database.withTransactionAsync(async () => {
      const row = await database.getFirstAsync<AnalysisCandidateRow>(
        `SELECT ${ANALYSIS_CANDIDATE_COLUMNS} FROM analysis_candidates WHERE id = ?`,
        id,
      );
      if (!row) {
        throw new Error(`Analysis candidate ${id} does not exist.`);
      }
      reviewed = reviewAnalysisCandidate(mapAnalysisCandidate(row), review);
      await assertConfirmedShotRelationship(database, reviewed);
      const result = await database.runAsync(
        `UPDATE analysis_candidates SET
          state = ?, reviewed_at = ?, confirmed_shot_id = ?, rejection_reason = ?, updated_at = ?
         WHERE id = ? AND state = 'pending'`,
        reviewed.state,
        reviewed.reviewedAt ?? null,
        reviewed.confirmedShotId ?? null,
        reviewed.rejectionReason ?? null,
        reviewed.updatedAt,
        id,
      );
      if (result.changes !== 1) {
        throw new Error(`Analysis candidate ${id} was reviewed by another operation.`);
      }
    });
    if (!reviewed) {
      throw new Error(`Analysis candidate ${id} could not be reviewed.`);
    }
    return reviewed;
  }

  async removeJob(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM analysis_jobs WHERE id = ?', id);
    return result.changes > 0;
  }

  async removeCandidate(id: string): Promise<boolean> {
    const database = await this.getDatabase();
    const result = await database.runAsync('DELETE FROM analysis_candidates WHERE id = ?', id);
    return result.changes > 0;
  }
}

async function upsertJobWithDatabase(
  database: SQLiteDatabase,
  job: AnalysisJob,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO analysis_jobs (
      id, session_id, target_id, capture_id, reference_capture_id,
      baseline_revision, reference_mode, sensitivity_json, analyzer_id,
      analyzer_version, status, requested_at, started_at, completed_at,
      failure_message
    ) VALUES (
      $id, $sessionId, $targetId, $captureId, $referenceCaptureId,
      $baselineRevision, $referenceMode, $sensitivityJson, $analyzerId,
      $analyzerVersion, $status, $requestedAt, $startedAt, $completedAt,
      $failureMessage
    ) ON CONFLICT(id) DO UPDATE SET
      reference_capture_id = excluded.reference_capture_id,
      baseline_revision = excluded.baseline_revision,
      reference_mode = excluded.reference_mode,
      sensitivity_json = excluded.sensitivity_json,
      analyzer_id = excluded.analyzer_id,
      analyzer_version = excluded.analyzer_version,
      status = excluded.status,
      requested_at = excluded.requested_at,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      failure_message = excluded.failure_message`,
    {
      $id: job.id,
      $sessionId: job.sessionId,
      $targetId: job.targetId,
      $captureId: job.captureId,
      $referenceCaptureId: job.referenceCaptureId ?? null,
      $baselineRevision: job.baselineRevision,
      $referenceMode: job.referenceMode,
      $sensitivityJson: serializeRequiredJson(job.sensitivity, 'analysis job sensitivity'),
      $analyzerId: job.analyzerId,
      $analyzerVersion: job.analyzerVersion ?? null,
      $status: job.status,
      $requestedAt: job.requestedAt,
      $startedAt: job.startedAt ?? null,
      $completedAt: job.completedAt ?? null,
      $failureMessage: job.failureMessage ?? null,
    },
  );
}

async function upsertCandidateWithDatabase(
  database: SQLiteDatabase,
  candidate: AnalysisCandidate,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO analysis_candidates (
      id, job_id, session_id, target_id, capture_id, baseline_revision,
      position_x, position_y, bounds_x, bounds_y, bounds_width, bounds_height,
      area_pixels, mean_difference, confidence, classification, scores_json,
      state, provenance_json, reviewed_at, confirmed_shot_id, rejection_reason,
      created_at, updated_at
    ) VALUES (
      $id, $jobId, $sessionId, $targetId, $captureId, $baselineRevision,
      $positionX, $positionY, $boundsX, $boundsY, $boundsWidth, $boundsHeight,
      $areaPixels, $meanDifference, $confidence, $classification, $scoresJson,
      $state, $provenanceJson, $reviewedAt, $confirmedShotId, $rejectionReason,
      $createdAt, $updatedAt
    ) ON CONFLICT(id) DO UPDATE SET
      position_x = excluded.position_x,
      position_y = excluded.position_y,
      bounds_x = excluded.bounds_x,
      bounds_y = excluded.bounds_y,
      bounds_width = excluded.bounds_width,
      bounds_height = excluded.bounds_height,
      area_pixels = excluded.area_pixels,
      mean_difference = excluded.mean_difference,
      confidence = excluded.confidence,
      classification = excluded.classification,
      scores_json = excluded.scores_json,
      state = excluded.state,
      provenance_json = excluded.provenance_json,
      reviewed_at = excluded.reviewed_at,
      confirmed_shot_id = excluded.confirmed_shot_id,
      rejection_reason = excluded.rejection_reason,
      updated_at = excluded.updated_at`,
    {
      $id: candidate.id,
      $jobId: candidate.jobId,
      $sessionId: candidate.sessionId,
      $targetId: candidate.targetId,
      $captureId: candidate.captureId,
      $baselineRevision: candidate.baselineRevision,
      $positionX: candidate.position.x,
      $positionY: candidate.position.y,
      $boundsX: candidate.bounds.x,
      $boundsY: candidate.bounds.y,
      $boundsWidth: candidate.bounds.width,
      $boundsHeight: candidate.bounds.height,
      $areaPixels: candidate.areaPixels,
      $meanDifference: candidate.meanDifference,
      $confidence: candidate.confidence,
      $classification: candidate.classification,
      $scoresJson: serializeRequiredJson(candidate.scores, 'analysis candidate scores'),
      $state: candidate.state,
      $provenanceJson: serializeRequiredJson(
        candidate.provenance,
        'analysis candidate provenance',
      ),
      $reviewedAt: candidate.reviewedAt ?? null,
      $confirmedShotId: candidate.confirmedShotId ?? null,
      $rejectionReason: candidate.rejectionReason ?? null,
      $createdAt: candidate.createdAt,
      $updatedAt: candidate.updatedAt,
    },
  );
}

async function assertJobCaptureRelationship(
  database: SQLiteDatabase,
  job: AnalysisJob,
): Promise<void> {
  await assertCaptureBelongsToTarget(
    database,
    job.captureId,
    job.sessionId,
    job.targetId,
    'Analysis job capture',
  );
  if (job.referenceCaptureId) {
    await assertCaptureBelongsToTarget(
      database,
      job.referenceCaptureId,
      job.sessionId,
      job.targetId,
      'Analysis job reference capture',
    );
  }
}

async function assertCaptureBelongsToTarget(
  database: SQLiteDatabase,
  captureId: string,
  sessionId: string,
  targetId: string,
  label: string,
): Promise<void> {
  const capture = await database.getFirstAsync<CaptureIdentityRow>(
    'SELECT session_id, target_id FROM captures WHERE id = ?',
    captureId,
  );
  if (!capture || capture.session_id !== sessionId || capture.target_id !== targetId) {
    throw new Error(`${label} must belong to the same session and target.`);
  }
}

async function assertJobIdentityIsStable(
  database: SQLiteDatabase,
  job: AnalysisJob,
): Promise<void> {
  const existing = await database.getFirstAsync<JobIdentityRow>(
    'SELECT session_id, target_id, capture_id, baseline_revision FROM analysis_jobs WHERE id = ?',
    job.id,
  );
  if (
    existing &&
    (existing.session_id !== job.sessionId ||
      existing.target_id !== job.targetId ||
      existing.capture_id !== job.captureId ||
      existing.baseline_revision !== job.baselineRevision)
  ) {
    throw new Error(
      `Analysis job ${job.id} cannot be moved to another capture, target, or baseline revision.`,
    );
  }
}

async function assertCandidateRelationship(
  database: SQLiteDatabase,
  candidate: AnalysisCandidate,
): Promise<void> {
  const job = await database.getFirstAsync<JobIdentityRow>(
    'SELECT session_id, target_id, capture_id, baseline_revision FROM analysis_jobs WHERE id = ?',
    candidate.jobId,
  );
  if (!job) {
    throw new Error(`Analysis candidate ${candidate.id} references an unknown analysis job.`);
  }
  if (
    job.session_id !== candidate.sessionId ||
    job.target_id !== candidate.targetId ||
    job.capture_id !== candidate.captureId ||
    job.baseline_revision !== candidate.baselineRevision
  ) {
    throw new Error(
      `Analysis candidate ${candidate.id} must match its job's session, target, and capture.`,
    );
  }
}

async function assertCandidateIdentityIsStable(
  database: SQLiteDatabase,
  candidate: AnalysisCandidate,
): Promise<void> {
  const existing = await database.getFirstAsync<CandidateIdentityRow>(
    `SELECT job_id, session_id, target_id, capture_id, baseline_revision, state
     FROM analysis_candidates WHERE id = ?`,
    candidate.id,
  );
  if (
    existing &&
    (existing.job_id !== candidate.jobId ||
      existing.session_id !== candidate.sessionId ||
      existing.target_id !== candidate.targetId ||
      existing.capture_id !== candidate.captureId ||
      existing.baseline_revision !== candidate.baselineRevision)
  ) {
    throw new Error(`Analysis candidate ${candidate.id} cannot be moved to another analysis job.`);
  }
  if (existing && existing.state !== 'pending') {
    throw new Error(
      `Analysis candidate ${candidate.id} has been reviewed and can no longer be upserted.`,
    );
  }
  if (existing && candidate.state !== 'pending') {
    throw new Error(
      `Analysis candidate ${candidate.id} must be reviewed with reviewCandidate().`,
    );
  }
  if (!existing && candidate.state === 'confirmed' && !candidate.confirmedShotId) {
    throw new Error(
      `A new confirmed analysis candidate ${candidate.id} requires confirmedShotId.`,
    );
  }
}

async function assertConfirmedShotRelationship(
  database: SQLiteDatabase,
  candidate: AnalysisCandidate,
): Promise<void> {
  if (!candidate.confirmedShotId) {
    return;
  }
  const shot = await database.getFirstAsync<ShotIdentityRow>(
    'SELECT session_id, target_id FROM shots WHERE id = ?',
    candidate.confirmedShotId,
  );
  if (!shot || shot.session_id !== candidate.sessionId || shot.target_id !== candidate.targetId) {
    throw new Error(
      `Confirmed shot ${candidate.confirmedShotId} must belong to the candidate's session and target.`,
    );
  }
}

function mapAnalysisJob(row: AnalysisJobRow): AnalysisJob {
  const sensitivity = deserializeRequiredJson<AnalysisSensitivity>(
    row.sensitivity_json,
    `Analysis job ${row.id} sensitivity`,
  );
  const job: AnalysisJob = {
    id: row.id,
    sessionId: row.session_id,
    targetId: row.target_id,
    captureId: row.capture_id,
    referenceCaptureId: row.reference_capture_id ?? undefined,
    baselineRevision: row.baseline_revision,
    referenceMode: row.reference_mode,
    sensitivity,
    analyzerId: row.analyzer_id,
    analyzerVersion: row.analyzer_version ?? undefined,
    status: row.status,
    requestedAt: row.requested_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    failureMessage: row.failure_message ?? undefined,
  };
  validateAnalysisJob(job);
  return Object.freeze({ ...job, sensitivity: Object.freeze({ ...job.sensitivity }) });
}

function mapAnalysisCandidate(row: AnalysisCandidateRow): AnalysisCandidate {
  const candidate: AnalysisCandidate = {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    targetId: row.target_id,
    captureId: row.capture_id,
    baselineRevision: row.baseline_revision,
    position: { x: row.position_x, y: row.position_y },
    bounds: {
      x: row.bounds_x,
      y: row.bounds_y,
      width: row.bounds_width,
      height: row.bounds_height,
    },
    areaPixels: row.area_pixels,
    meanDifference: row.mean_difference,
    confidence: row.confidence,
    classification: row.classification,
    scores: deserializeRequiredJson<ShotCandidateScoreBreakdown>(
      row.scores_json,
      `Analysis candidate ${row.id} scores`,
    ),
    state: row.state,
    provenance: deserializeRequiredJson<AnalysisCandidateProvenance>(
      row.provenance_json,
      `Analysis candidate ${row.id} provenance`,
    ),
    reviewedAt: row.reviewed_at ?? undefined,
    confirmedShotId: row.confirmed_shot_id ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  validateAnalysisCandidate(candidate);
  return Object.freeze({
    ...candidate,
    position: Object.freeze({ ...candidate.position }),
    bounds: Object.freeze({ ...candidate.bounds }),
    scores: Object.freeze({ ...candidate.scores }),
    provenance: Object.freeze({
      ...candidate.provenance,
      debugArtifactUris: candidate.provenance.debugArtifactUris
        ? Object.freeze([...candidate.provenance.debugArtifactUris])
        : undefined,
    }),
  });
}

function serializeRequiredJson(value: unknown, field: string): string {
  const serialized = serializeJson(value);
  if (!serialized) {
    throw new RangeError(`${field} is required`);
  }
  if (serialized.length > MAX_ANALYSIS_JSON_CHARACTERS) {
    throw new RangeError(`${field} exceeds the ${MAX_ANALYSIS_JSON_CHARACTERS}-character limit`);
  }
  return serialized;
}

function deserializeRequiredJson<T>(value: string, field: string): T {
  const parsed = deserializeJson<T>(value);
  if (parsed === undefined) {
    throw new Error(`${field} is missing.`);
  }
  return parsed;
}
