import type {
  IsoTimestamp,
  PixelPoint,
  ResourceUri,
  TargetRoi,
} from "./common";
import type { TargetCalibration } from "./calibration";
import type { CoordinateTransform } from "./transforms";

export type TargetType = "paper" | "steel" | "other";
export type SessionStatus = "active" | "completed" | "archived";

export interface Caliber {
  readonly name: string;
  readonly bulletDiameterInches: number;
}

export interface Session {
  readonly id: string;
  readonly title: string;
  readonly startedAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
  readonly rangeName?: string;
  readonly targetDistanceYards: number;
  readonly cameraProfileId: string;
  readonly targetType: TargetType;
  readonly caliber?: Caliber;
  readonly firearmName?: string;
  readonly ammunitionName?: string;
  readonly notes?: string;
  readonly status: SessionStatus;
}

export type TargetBaselineReason = "initial" | "target-reset";

export interface TargetBaseline {
  readonly captureId: string;
  /** Starts at one and advances on replacement/repaint without ending a session. */
  readonly revision: number;
  readonly establishedAt: IsoTimestamp;
  readonly reason: TargetBaselineReason;
}

export interface Target {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly type: TargetType;
  readonly roi?: TargetRoi;
  readonly baseline?: TargetBaseline;
  readonly calibration?: TargetCalibration;
  readonly pointOfAim?: PixelPoint;
  readonly desiredZeroPoint?: PixelPoint;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * The minimum immutable identity required to add another physical target to
 * an existing range session. Target geometry is intentionally absent: each
 * physical target earns its own baseline, ROI, calibration, and aim points.
 */
export interface NewTarget {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly type: TargetType;
  readonly createdAt: IsoTimestamp;
}

/** Creates a clean, independently-calibrated target record for a session. */
export function createTarget(input: NewTarget): Target {
  const name = input.name.trim();
  if (!input.id.trim()) throw new RangeError("Target id is required");
  if (!input.sessionId.trim()) throw new RangeError("Target sessionId is required");
  if (!name) throw new RangeError("Target name is required");
  if (!(["paper", "steel", "other"] as const).includes(input.type)) {
    throw new RangeError("Target type is invalid");
  }
  if (!input.createdAt.trim()) throw new RangeError("Target createdAt is required");
  return Object.freeze({
    id: input.id,
    sessionId: input.sessionId,
    name,
    type: input.type,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export interface EstablishBaselineInput {
  readonly captureId: string;
  readonly establishedAt: IsoTimestamp;
  readonly reason?: TargetBaselineReason;
  /** Useful when a physically different target invalidates the old scale. */
  readonly clearCalibration?: boolean;
}

/**
 * Establishes a new baseline while preserving the range session. Shots can keep
 * their historical baseline revision, preventing old holes from being deduped
 * against a freshly replaced target.
 */
export function establishTargetBaseline(
  target: Target,
  input: EstablishBaselineInput,
): Target {
  if (!input.captureId.trim()) {
    throw new RangeError("captureId is required");
  }
  const revision = (target.baseline?.revision ?? 0) + 1;
  const expectedReason: TargetBaselineReason = revision === 1 ? "initial" : "target-reset";
  if (input.reason && input.reason !== expectedReason) {
    throw new RangeError(`Baseline revision ${revision} must use reason ${expectedReason}`);
  }
  const reason = expectedReason;
  // These values are all anchored to baseline-image pixels. A reset means a
  // new target surface, so stale geometry must not be carried into the next
  // measurement or zeroing workflow.
  const clearCoordinateAnchors = reason === "target-reset";
  const next: Target = {
    ...target,
    baseline: Object.freeze({
      captureId: input.captureId,
      revision,
      establishedAt: input.establishedAt,
      reason,
    }),
    roi: clearCoordinateAnchors ? undefined : target.roi,
    calibration: input.clearCalibration || clearCoordinateAnchors ? undefined : target.calibration,
    pointOfAim: clearCoordinateAnchors ? undefined : target.pointOfAim,
    desiredZeroPoint: clearCoordinateAnchors ? undefined : target.desiredZeroPoint,
    updatedAt: input.establishedAt,
  };
  return Object.freeze(next);
}

export type CaptureKind = "baseline" | "observation" | "reset-baseline";
export type CaptureAnalysisStatus =
  | "not-requested"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type CaptureSource =
  | "http-snapshot"
  | "main-stream-frame"
  | "preview-frame"
  | "remote-phone-photo"
  | "remote-phone-preview"
  | "imported-image";

export interface CameraCaptureMetadata {
  readonly source: CaptureSource;
  readonly sourceType?: "ip-camera" | "remote-phone" | "imported-image" | "shotsight-hardware";
  readonly sourceDeviceId?: string;
  readonly transferStatus?: "local" | "queued" | "uploading" | "transferred" | "failed";
  readonly latencyMs?: number;
  readonly cameraTimestamp?: IsoTimestamp;
  readonly mimeType?: string;
  readonly codec?: string;
}

export interface TargetCaptureMetadata {
  readonly registrationTransform?: CoordinateTransform;
  readonly registrationConfidence?: number;
  readonly roi?: TargetRoi;
}

export interface Capture {
  readonly id: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly cameraProfileId: string;
  readonly sequenceNumber: number;
  readonly baselineRevision: number;
  readonly capturedAt: IsoTimestamp;
  readonly originalImageUri: ResourceUri;
  readonly previewImageUri?: ResourceUri;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly kind: CaptureKind;
  readonly analysisStatus: CaptureAnalysisStatus;
  readonly newlyDetectedShotCount?: number;
  readonly cumulativeShotCount?: number;
  readonly cameraMetadata: CameraCaptureMetadata;
  readonly targetMetadata?: TargetCaptureMetadata;
}

export const CALIBER_PRESETS = Object.freeze({
  ".22": Object.freeze({ name: ".22", bulletDiameterInches: 0.22 }),
  ".223 / 5.56": Object.freeze({
    name: ".223 / 5.56",
    bulletDiameterInches: 0.224,
  }),
  ".243": Object.freeze({ name: ".243", bulletDiameterInches: 0.243 }),
  ".264 / 6.5mm": Object.freeze({
    name: ".264 / 6.5mm",
    bulletDiameterInches: 0.264,
  }),
  ".270": Object.freeze({ name: ".270", bulletDiameterInches: 0.277 }),
  ".284 / 7mm": Object.freeze({
    name: ".284 / 7mm",
    bulletDiameterInches: 0.284,
  }),
  ".308": Object.freeze({ name: ".308", bulletDiameterInches: 0.308 }),
  ".338": Object.freeze({ name: ".338", bulletDiameterInches: 0.338 }),
} satisfies Readonly<Record<string, Caliber>>);
