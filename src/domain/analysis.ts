import type {
  PixelPoint,
  PixelRect,
  ResourceUri,
  TargetRoi,
} from "./common";
import type { TargetType } from "./session";
import type { CoordinateTransform } from "./transforms";

export type AnalysisReferenceMode = "previous" | "clean-baseline" | "hybrid";
export type AnalysisSensitivityPreset = "low" | "medium" | "high" | "custom";

export interface AnalysisCancellation {
  readonly aborted: boolean;
  readonly reason?: string;
}

/** A serializable image reference; decoding belongs to an image adapter. */
export interface AnalysisImage {
  readonly uri: ResourceUri;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly captureId?: string;
}

export interface AnalysisSensitivity {
  readonly preset: AnalysisSensitivityPreset;
  readonly minimumDifference: number;
  readonly minimumAreaPixels: number;
  readonly maximumAreaPixels: number;
  readonly deduplicationRadiusPixels: number;
}

export interface ImageRegistrationOptions {
  readonly roi?: TargetRoi;
  readonly maximumFeatures?: number;
  readonly minimumInliers?: number;
}

export interface RegistrationResult {
  readonly registeredImage: AnalysisImage;
  /** Maps current-image coordinates into the reference image space. */
  readonly currentToReference: CoordinateTransform;
  readonly confidence: number;
  readonly matchedFeatureCount: number;
  readonly inlierCount: number;
}

export interface ImageRegistrationStage {
  register(
    reference: AnalysisImage,
    current: AnalysisImage,
    options?: ImageRegistrationOptions,
    cancellation?: AnalysisCancellation,
  ): Promise<RegistrationResult>;
}

export interface PerspectiveCorrectionResult {
  readonly correctedImage: AnalysisImage;
  readonly sourceToCorrected: CoordinateTransform;
  readonly confidence: number;
}

export interface PerspectiveCorrectionStage {
  correct(
    image: AnalysisImage,
    targetCorners: readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint],
    cancellation?: AnalysisCancellation,
  ): Promise<PerspectiveCorrectionResult>;
}

export interface TargetRoiExtractionResult {
  readonly roi: TargetRoi;
  readonly confidence: number;
}

export interface TargetRoiExtractionStage {
  extract(
    image: AnalysisImage,
    targetType: TargetType,
    cancellation?: AnalysisCancellation,
  ): Promise<TargetRoiExtractionResult>;
}

export interface ExposureNormalizationResult {
  readonly normalizedReference: AnalysisImage;
  readonly normalizedCurrent: AnalysisImage;
}

export interface ExposureNormalizationStage {
  normalize(
    reference: AnalysisImage,
    current: AnalysisImage,
    roi: TargetRoi,
    cancellation?: AnalysisCancellation,
  ): Promise<ExposureNormalizationResult>;
}

export interface DifferenceResult {
  readonly differenceImage: AnalysisImage;
  readonly binaryMask?: AnalysisImage;
}

export interface DifferenceGenerationStage {
  generate(
    normalizedReference: AnalysisImage,
    normalizedCurrent: AnalysisImage,
    roi: TargetRoi,
    cancellation?: AnalysisCancellation,
  ): Promise<DifferenceResult>;
}

export interface ChangeCandidate {
  readonly id: string;
  /** Registered, full-resolution target coordinates. */
  readonly position: PixelPoint;
  readonly bounds: PixelRect;
  readonly areaPixels: number;
  readonly meanDifference: number;
}

export interface ChangeCandidateDetectionStage {
  detect(
    difference: DifferenceResult,
    roi: TargetRoi,
    sensitivity: AnalysisSensitivity,
    cancellation?: AnalysisCancellation,
  ): Promise<readonly ChangeCandidate[]>;
}

export type ShotCandidateClassification =
  | "probable-paper-impact"
  | "probable-steel-impact"
  | "unknown-change";

export interface ShotCandidateScoreBreakdown {
  readonly locality: number;
  readonly shape: number;
  readonly size: number;
  readonly contrast: number;
  readonly temporalNovelty: number;
}

export interface ShotCandidate extends ChangeCandidate {
  readonly confidence: number;
  readonly classification: ShotCandidateClassification;
  readonly scores: ShotCandidateScoreBreakdown;
}

export interface ShotCandidateScoringStage {
  score(
    candidates: readonly ChangeCandidate[],
    targetType: TargetType,
    cancellation?: AnalysisCancellation,
  ): Promise<readonly ShotCandidate[]>;
}

export interface ShotCandidateClusteringStage {
  cluster(
    candidates: readonly ShotCandidate[],
    radiusPixels: number,
    cancellation?: AnalysisCancellation,
  ): Promise<readonly ShotCandidate[]>;
}

export type AnalysisDebugArtifactName =
  | "registered"
  | "normalized-reference"
  | "normalized-current"
  | "difference"
  | "binary-mask"
  | "contours";

export interface AnalysisDebugArtifact {
  readonly name: AnalysisDebugArtifactName;
  readonly image: AnalysisImage;
}

export interface ImageAnalysisRequest {
  readonly sessionId: string;
  readonly targetId: string;
  readonly baselineRevision: number;
  readonly targetType: TargetType;
  readonly referenceMode: AnalysisReferenceMode;
  readonly cleanBaseline: AnalysisImage;
  readonly previous?: AnalysisImage;
  readonly current: AnalysisImage;
  readonly lockedRoi?: TargetRoi;
  readonly sensitivity: AnalysisSensitivity;
  readonly includeDebugArtifacts?: boolean;
}

export interface ImageAnalysisResult {
  readonly targetId: string;
  readonly baselineRevision: number;
  readonly referenceMode: AnalysisReferenceMode;
  readonly registration: RegistrationResult;
  readonly roi: TargetRoiExtractionResult;
  readonly candidates: readonly ShotCandidate[];
  readonly debugArtifacts: readonly AnalysisDebugArtifact[];
  readonly elapsedMs: number;
}

export interface ImageAnalysisService {
  analyze(
    request: ImageAnalysisRequest,
    cancellation?: AnalysisCancellation,
  ): Promise<ImageAnalysisResult>;
}

/** Pluggable paper/steel strategy boundary; implementations stay outside domain. */
export interface TargetAnalysisStrategy {
  readonly targetType: TargetType;
  scoreCandidates(
    candidates: readonly ChangeCandidate[],
    cancellation?: AnalysisCancellation,
  ): Promise<readonly ShotCandidate[]>;
}

