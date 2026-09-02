import type {
  AnalysisReferenceMode,
  AnalysisSensitivity,
  ShotCandidate,
} from "./analysis";
import { isFinitePoint, type IsoTimestamp, type ResourceUri } from "./common";
import type { CoordinateTransform } from "./transforms";

/** Lifecycle of one durable request to analyze a captured target image. */
export type AnalysisJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/** Human review state; candidates never become confirmed shots implicitly. */
export type AnalysisCandidateState = "pending" | "confirmed" | "rejected";

/**
 * Enough provenance to reproduce why a candidate was proposed without storing
 * image pixels in SQLite. Image/debug files remain in app-owned storage.
 */
export interface AnalysisCandidateProvenance {
  readonly analyzerId: string;
  readonly analyzerVersion?: string;
  readonly referenceCaptureId?: string;
  readonly registrationConfidence?: number;
  readonly registrationTransform?: CoordinateTransform;
  readonly debugArtifactUris?: readonly ResourceUri[];
}

export interface AnalysisJob {
  readonly id: string;
  readonly sessionId: string;
  readonly targetId: string;
  /** The newly captured image being analyzed. */
  readonly captureId: string;
  /** Baseline or previous capture used as the visual reference, if any. */
  readonly referenceCaptureId?: string;
  readonly baselineRevision: number;
  readonly referenceMode: AnalysisReferenceMode;
  readonly sensitivity: AnalysisSensitivity;
  readonly analyzerId: string;
  readonly analyzerVersion?: string;
  readonly status: AnalysisJobStatus;
  readonly requestedAt: IsoTimestamp;
  readonly startedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly failureMessage?: string;
}

/**
 * A proposed impact remains separate from a Shot until a user or an explicit
 * confirmation workflow accepts it. This preserves an audit trail for false
 * positives and makes a later detector interchangeable.
 */
export interface AnalysisCandidate extends ShotCandidate {
  readonly jobId: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly captureId: string;
  readonly baselineRevision: number;
  readonly state: AnalysisCandidateState;
  readonly provenance: AnalysisCandidateProvenance;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly reviewedAt?: IsoTimestamp;
  /**
   * Present when a confirmation flow created a durable Shot from this candidate.
   * It can be cleared later if that Shot is intentionally deleted while the
   * candidate audit record is retained.
   */
  readonly confirmedShotId?: string;
  readonly rejectionReason?: string;
}

export interface ReviewAnalysisCandidateInput {
  readonly state: Exclude<AnalysisCandidateState, "pending">;
  readonly reviewedAt: IsoTimestamp;
  /** Required to confirm; deliberately absent for a rejected candidate. */
  readonly confirmedShotId?: string;
  readonly rejectionReason?: string;
}

const MAX_ANALYSIS_FAILURE_MESSAGE_LENGTH = 1_000;
const MAX_ANALYSIS_REJECTION_REASON_LENGTH = 1_000;
const MAX_ANALYZER_ID_LENGTH = 128;
const MAX_DEBUG_ARTIFACTS = 12;
const ANALYSIS_REFERENCE_MODES: readonly AnalysisReferenceMode[] = [
  "previous",
  "clean-baseline",
  "hybrid",
];
const ANALYSIS_JOB_STATUSES: readonly AnalysisJobStatus[] = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
];
const ANALYSIS_CANDIDATE_STATES: readonly AnalysisCandidateState[] = [
  "pending",
  "confirmed",
  "rejected",
];
const SHOT_CANDIDATE_CLASSIFICATIONS: readonly ShotCandidate["classification"][] = [
  "probable-paper-impact",
  "probable-steel-impact",
  "unknown-change",
];

function assertNonBlank(value: string, field: string): void {
  if (!value.trim()) {
    throw new RangeError(`${field} is required`);
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative finite number`);
  }
}

function assertConfidence(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be between zero and one`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

function assertMaximumLength(
  value: string | undefined,
  field: string,
  maximum: number,
): void {
  if (value !== undefined && value.length > maximum) {
    throw new RangeError(`${field} cannot exceed ${maximum} characters`);
  }
}

function assertScore(value: number, field: string): void {
  assertConfidence(value, field);
}

function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new RangeError(`${field} is invalid`);
  }
}

function validateAnalysisSensitivity(sensitivity: AnalysisSensitivity): void {
  assertOneOf(
    sensitivity.preset,
    ["low", "medium", "high", "custom"] as const,
    "Analysis sensitivity preset",
  );
  assertFiniteNonNegative(
    sensitivity.minimumDifference,
    "Analysis sensitivity minimumDifference",
  );
  assertPositiveInteger(
    sensitivity.minimumAreaPixels,
    "Analysis sensitivity minimumAreaPixels",
  );
  assertPositiveInteger(
    sensitivity.maximumAreaPixels,
    "Analysis sensitivity maximumAreaPixels",
  );
  if (sensitivity.maximumAreaPixels < sensitivity.minimumAreaPixels) {
    throw new RangeError(
      "Analysis sensitivity maximumAreaPixels cannot be less than minimumAreaPixels",
    );
  }
  assertFiniteNonNegative(
    sensitivity.deduplicationRadiusPixels,
    "Analysis sensitivity deduplicationRadiusPixels",
  );
}

export function validateAnalysisJob(job: AnalysisJob): void {
  assertNonBlank(job.id, "Analysis job id");
  assertNonBlank(job.sessionId, "Analysis job sessionId");
  assertNonBlank(job.targetId, "Analysis job targetId");
  assertNonBlank(job.captureId, "Analysis job captureId");
  if (job.referenceCaptureId !== undefined) {
    assertNonBlank(job.referenceCaptureId, "Analysis job referenceCaptureId");
  }
  assertPositiveInteger(job.baselineRevision, "Analysis job baselineRevision");
  assertOneOf(job.referenceMode, ANALYSIS_REFERENCE_MODES, "Analysis job referenceMode");
  assertOneOf(job.status, ANALYSIS_JOB_STATUSES, "Analysis job status");
  validateAnalysisSensitivity(job.sensitivity);
  assertNonBlank(job.analyzerId, "Analysis job analyzerId");
  assertMaximumLength(job.analyzerId, "Analysis job analyzerId", MAX_ANALYZER_ID_LENGTH);
  assertMaximumLength(job.analyzerVersion, "Analysis job analyzerVersion", MAX_ANALYZER_ID_LENGTH);
  assertMaximumLength(
    job.failureMessage,
    "Analysis job failureMessage",
    MAX_ANALYSIS_FAILURE_MESSAGE_LENGTH,
  );
  assertNonBlank(job.requestedAt, "Analysis job requestedAt");

  if (job.status === "processing" && !job.startedAt) {
    throw new RangeError("A processing analysis job requires startedAt");
  }
  if ((job.status === "completed" || job.status === "failed" || job.status === "cancelled") && !job.completedAt) {
    throw new RangeError(`A ${job.status} analysis job requires completedAt`);
  }
  if (job.status === "failed" && !job.failureMessage?.trim()) {
    throw new RangeError("A failed analysis job requires failureMessage");
  }
}

export function validateAnalysisCandidate(candidate: AnalysisCandidate): void {
  assertNonBlank(candidate.id, "Analysis candidate id");
  assertNonBlank(candidate.jobId, "Analysis candidate jobId");
  assertNonBlank(candidate.sessionId, "Analysis candidate sessionId");
  assertNonBlank(candidate.targetId, "Analysis candidate targetId");
  assertNonBlank(candidate.captureId, "Analysis candidate captureId");
  assertPositiveInteger(candidate.baselineRevision, "Analysis candidate baselineRevision");
  if (!isFinitePoint(candidate.position)) {
    throw new RangeError("Analysis candidate position must be finite");
  }
  const { bounds } = candidate;
  if (
    !isFinitePoint(bounds) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 0 ||
    bounds.height < 0
  ) {
    throw new RangeError("Analysis candidate bounds must be finite and non-negative");
  }
  assertFiniteNonNegative(candidate.areaPixels, "Analysis candidate areaPixels");
  assertFiniteNonNegative(candidate.meanDifference, "Analysis candidate meanDifference");
  assertConfidence(candidate.confidence, "Analysis candidate confidence");
  assertOneOf(
    candidate.classification,
    SHOT_CANDIDATE_CLASSIFICATIONS,
    "Analysis candidate classification",
  );
  assertOneOf(candidate.state, ANALYSIS_CANDIDATE_STATES, "Analysis candidate state");
  assertScore(candidate.scores.locality, "Analysis candidate locality score");
  assertScore(candidate.scores.shape, "Analysis candidate shape score");
  assertScore(candidate.scores.size, "Analysis candidate size score");
  assertScore(candidate.scores.contrast, "Analysis candidate contrast score");
  assertScore(candidate.scores.temporalNovelty, "Analysis candidate temporal novelty score");
  assertNonBlank(candidate.createdAt, "Analysis candidate createdAt");
  assertNonBlank(candidate.updatedAt, "Analysis candidate updatedAt");
  validateAnalysisCandidateProvenance(candidate.provenance);

  if (candidate.state === "pending") {
    if (
      candidate.reviewedAt !== undefined ||
      candidate.confirmedShotId !== undefined ||
      candidate.rejectionReason !== undefined
    ) {
      throw new RangeError("A pending analysis candidate cannot have review fields");
    }
    return;
  }

  if (!candidate.reviewedAt) {
    throw new RangeError("A reviewed analysis candidate requires reviewedAt");
  }
  if (candidate.state === "confirmed") {
    if (candidate.confirmedShotId !== undefined) {
      assertNonBlank(candidate.confirmedShotId, "Analysis candidate confirmedShotId");
    }
    if (candidate.rejectionReason !== undefined) {
      throw new RangeError("A confirmed analysis candidate cannot have rejectionReason");
    }
  } else if (candidate.confirmedShotId !== undefined) {
    throw new RangeError("A rejected analysis candidate cannot have confirmedShotId");
  }
  assertMaximumLength(
    candidate.rejectionReason,
    "Analysis candidate rejectionReason",
    MAX_ANALYSIS_REJECTION_REASON_LENGTH,
  );
}

export function validateAnalysisCandidateProvenance(
  provenance: AnalysisCandidateProvenance,
): void {
  assertNonBlank(provenance.analyzerId, "Analysis candidate analyzerId");
  assertMaximumLength(
    provenance.analyzerId,
    "Analysis candidate analyzerId",
    MAX_ANALYZER_ID_LENGTH,
  );
  assertMaximumLength(
    provenance.analyzerVersion,
    "Analysis candidate analyzerVersion",
    MAX_ANALYZER_ID_LENGTH,
  );
  if (provenance.referenceCaptureId !== undefined) {
    assertNonBlank(provenance.referenceCaptureId, "Analysis candidate referenceCaptureId");
  }
  if (provenance.registrationConfidence !== undefined) {
    assertConfidence(
      provenance.registrationConfidence,
      "Analysis candidate registrationConfidence",
    );
  }
  if ((provenance.debugArtifactUris?.length ?? 0) > MAX_DEBUG_ARTIFACTS) {
    throw new RangeError(`Analysis candidate can retain at most ${MAX_DEBUG_ARTIFACTS} debug artifacts`);
  }
  for (const uri of provenance.debugArtifactUris ?? []) {
    assertNonBlank(uri, "Analysis candidate debugArtifactUri");
  }
}

/**
 * Produces an immutable terminal review record. Re-reviewing is rejected so a
 * false-positive decision cannot silently overwrite the audit history.
 */
export function reviewAnalysisCandidate(
  candidate: AnalysisCandidate,
  review: ReviewAnalysisCandidateInput,
): AnalysisCandidate {
  validateAnalysisCandidate(candidate);
  if (candidate.state !== "pending") {
    throw new RangeError(`Analysis candidate ${candidate.id} has already been reviewed`);
  }
  assertNonBlank(review.reviewedAt, "Analysis candidate reviewedAt");
  if (review.state === "confirmed" && !review.confirmedShotId?.trim()) {
    throw new RangeError("Confirming an analysis candidate requires confirmedShotId");
  }
  if (review.state === "rejected" && review.confirmedShotId !== undefined) {
    throw new RangeError("Rejecting an analysis candidate cannot include confirmedShotId");
  }

  const next: AnalysisCandidate = {
    ...candidate,
    state: review.state,
    reviewedAt: review.reviewedAt,
    updatedAt: review.reviewedAt,
    confirmedShotId:
      review.state === "confirmed" ? review.confirmedShotId : undefined,
    rejectionReason:
      review.state === "rejected" ? review.rejectionReason : undefined,
  };
  validateAnalysisCandidate(next);
  return Object.freeze({
    ...next,
    position: Object.freeze({ ...next.position }),
    bounds: Object.freeze({ ...next.bounds }),
    scores: Object.freeze({ ...next.scores }),
    provenance: Object.freeze({
      ...next.provenance,
      debugArtifactUris: next.provenance.debugArtifactUris
        ? Object.freeze([...next.provenance.debugArtifactUris])
        : undefined,
    }),
  });
}
