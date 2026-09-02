import type {
  AnalysisCancellation,
  AnalysisImage,
  ChangeCandidate,
  ImageAnalysisRequest,
  ImageAnalysisResult,
  ImageAnalysisService,
  RegistrationResult,
  ShotCandidate,
  TargetRoi,
} from '../../domain';
import type { PixelPoint, PixelRect } from '../../domain';
import type { TargetType } from '../../domain';
import type { Matrix3x3 } from '../../domain';
import { JpegSnapshotDecoder, type LocalImageDecoder } from './LocalJpegSnapshotDecoder';
import {
  analyzeLocalFrames,
  resizeGrayFrame,
  type GrayFrame,
  type LocalCandidate,
  type LocalRect,
} from './localPipeline';
import {
  DEFAULT_LOCAL_TARGET_ANALYSIS_STRATEGIES,
  selectLocalTargetAnalysisStrategy,
  strategyScores,
  type LocalTargetAnalysisStrategy,
} from './targetStrategies';

export interface LocalImageAnalysisServiceOptions {
  readonly decoder?: LocalImageDecoder;
  /** Longest edge used by the bounded JS processing pipeline. */
  readonly maxProcessingDimension?: number;
  readonly maxShiftPixels?: number;
  /** Reject differently framed captures before their pixels are stretched. */
  readonly maximumAspectRatioDrift?: number;
  /** Target-specific candidate interpretation remains local and review-first. */
  readonly targetStrategies?: readonly LocalTargetAnalysisStrategy[];
}

export class LocalImageAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalImageAnalysisError';
  }
}

/**
 * First on-device ImageAnalysisService implementation.
 *
 * It deliberately operates on saved JPEG snapshots only: image bytes remain
 * on the device, candidates are calculated in memory, and its fixed processing
 * bound avoids the full-resolution work from monopolizing the JS runtime. The
 * first version is translation-only; perspective correction and durable debug
 * artifact encoding remain separate native stages rather than silently
 * pretending to be supported.
 */
export class LocalImageAnalysisService implements ImageAnalysisService {
  private readonly decoder: LocalImageDecoder;
  private readonly maxProcessingDimension: number;
  private readonly maxShiftPixels: number;
  private readonly maximumAspectRatioDrift: number;
  private readonly targetStrategies: readonly LocalTargetAnalysisStrategy[];

  constructor(options: LocalImageAnalysisServiceOptions = {}) {
    this.decoder = options.decoder ?? new JpegSnapshotDecoder();
    this.maxProcessingDimension = positiveInteger(options.maxProcessingDimension ?? 1280, 'maxProcessingDimension');
    this.maxShiftPixels = nonNegativeInteger(options.maxShiftPixels ?? 20, 'maxShiftPixels');
    this.maximumAspectRatioDrift = nonNegativeFinite(options.maximumAspectRatioDrift ?? 0.03, 'maximumAspectRatioDrift');
    this.targetStrategies = validateTargetStrategies(options.targetStrategies ?? DEFAULT_LOCAL_TARGET_ANALYSIS_STRATEGIES);
  }

  async analyze(
    request: ImageAnalysisRequest,
    cancellation?: AnalysisCancellation,
  ): Promise<ImageAnalysisResult> {
    const startedAt = Date.now();
    throwIfCancelled(cancellation);
    const reference = selectReference(request);
    const [decodedReference, decodedCurrent] = await Promise.all([
      this.decoder.decode(reference),
      this.decoder.decode(request.current),
    ]);
    throwIfCancelled(cancellation);
    assertComparableAspectRatio(reference, request.current, this.maximumAspectRatioDrift);

    const processingReference = constrainFrame(decodedReference.frame, this.maxProcessingDimension);
    const processingCurrent = resizeGrayFrame(
      decodedCurrent.frame,
      processingReference.width,
      processingReference.height,
    );
    const referenceScale = {
      x: processingReference.width / reference.widthPixels,
      y: processingReference.height / reference.heightPixels,
    };
    const currentScale = {
      x: processingCurrent.width / request.current.widthPixels,
      y: processingCurrent.height / request.current.heightPixels,
    };
    const selectedRoi = request.lockedRoi ?? fullImageRoi(reference);
    const processingRoi = roiToProcessingRect(selectedRoi, referenceScale.x, referenceScale.y);
    const processingAreaScale = referenceScale.x * referenceScale.y;
    const areaToProcessing = (area: number): number => Math.max(1, Math.round(area * processingAreaScale));

    const artifacts = analyzeLocalFrames(processingReference, processingCurrent, {
      sensitivity: request.sensitivity.preset === 'custom' ? 'medium' : request.sensitivity.preset,
      maxShift: this.maxShiftPixels,
      roi: processingRoi,
      minimumThreshold: request.sensitivity.minimumDifference,
      minimumArea: areaToProcessing(request.sensitivity.minimumAreaPixels),
      maximumArea: areaToProcessing(request.sensitivity.maximumAreaPixels),
      dedupeRadius: Math.max(1, request.sensitivity.deduplicationRadiusPixels * Math.sqrt(processingAreaScale)),
    });
    throwIfCancelled(cancellation);

    const candidates = mapAndDedupeCandidates(
      artifacts.candidates,
      request,
      referenceScale.x,
      referenceScale.y,
      selectLocalTargetAnalysisStrategy(request.targetType, this.targetStrategies),
    );
    const registration = registrationFor(
      reference,
      request.current,
      artifacts.registration,
      referenceScale,
      currentScale,
    );

    // This adapter intentionally keeps all transient debug pixels in memory.
    // A later artifact-writer stage can persist them without changing the
    // analysis result or sending a snapshot to a remote service.
    return Object.freeze({
      targetId: request.targetId,
      baselineRevision: request.baselineRevision,
      referenceMode: request.referenceMode,
      registration,
      roi: Object.freeze({
        roi: selectedRoi,
        confidence: request.lockedRoi ? 1 : 0.2,
      }),
      candidates,
      debugArtifacts: Object.freeze([]),
      elapsedMs: Date.now() - startedAt,
    });
  }
}

function selectReference(request: ImageAnalysisRequest): AnalysisImage {
  if (request.referenceMode === 'clean-baseline') return request.cleanBaseline;
  if (request.referenceMode === 'previous') {
    if (!request.previous) throw new LocalImageAnalysisError('Previous-frame analysis requires a previous saved capture.');
    return request.previous;
  }
  // Hybrid mode uses the immediate predecessor when it exists, then falls
  // back to the clean baseline. Persistence-level known-shot deduplication
  // determines whether an otherwise valid candidate is actually new.
  return request.previous ?? request.cleanBaseline;
}

function fullImageRoi(image: AnalysisImage): TargetRoi {
  return Object.freeze({
    kind: 'rectangle',
    rect: Object.freeze({ x: 0, y: 0, width: image.widthPixels, height: image.heightPixels }),
  });
}

function roiToProcessingRect(roi: TargetRoi, scaleX: number, scaleY: number): LocalRect {
  const bounds = roi.kind === 'rectangle'
    ? roi.rect
    : boundsForPoints(roi.points);
  return Object.freeze({
    x: bounds.x * scaleX,
    y: bounds.y * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY,
  });
}

function boundsForPoints(points: readonly PixelPoint[]): PixelRect {
  if (points.length < 3) throw new LocalImageAnalysisError('A polygon target ROI needs at least three points.');
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new LocalImageAnalysisError('Target ROI points must be finite.');
    }
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  if (right <= left || bottom <= top) throw new LocalImageAnalysisError('Target ROI has no drawable area.');
  // The local translation stage accepts a rectangle. Polygon masking can be
  // introduced independently once a native compute path is available.
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function constrainFrame(frame: GrayFrame, maximumDimension: number): GrayFrame {
  const longest = Math.max(frame.width, frame.height);
  if (longest <= maximumDimension) return frame;
  const scale = maximumDimension / longest;
  return resizeGrayFrame(frame, Math.max(1, Math.round(frame.width * scale)), Math.max(1, Math.round(frame.height * scale)));
}

function assertComparableAspectRatio(reference: AnalysisImage, current: AnalysisImage, maximumDrift: number): void {
  const referenceAspect = reference.widthPixels / reference.heightPixels;
  const currentAspect = current.widthPixels / current.heightPixels;
  if (!Number.isFinite(referenceAspect) || !Number.isFinite(currentAspect) || referenceAspect <= 0 || currentAspect <= 0) {
    throw new LocalImageAnalysisError('Capture dimensions must be positive before analysis can begin.');
  }
  if (Math.abs(referenceAspect - currentAspect) / referenceAspect > maximumDrift) {
    throw new LocalImageAnalysisError(
      `Capture aspect ratios differ too much (${reference.widthPixels}x${reference.heightPixels} vs ${current.widthPixels}x${current.heightPixels}).`,
    );
  }
}

function registrationFor(
  reference: AnalysisImage,
  current: AnalysisImage,
  registration: { readonly offsetX: number; readonly offsetY: number; readonly confidence: number },
  referenceScale: { readonly x: number; readonly y: number },
  currentScale: { readonly x: number; readonly y: number },
): RegistrationResult {
  // The local pipeline produces a registered *virtual* frame in memory. The
  // source URI remains the current immutable capture; callers apply this
  // transform when overlaying it in reference coordinates.
  const matrix: Matrix3x3 = Object.freeze([
    currentScale.x / referenceScale.x, 0, -registration.offsetX / referenceScale.x,
    0, currentScale.y / referenceScale.y, -registration.offsetY / referenceScale.y,
    0, 0, 1,
  ]);
  return Object.freeze({
    registeredImage: current,
    currentToReference: Object.freeze({
      matrix,
      sourceSpace: `capture:${current.captureId ?? current.uri}`,
      destinationSpace: `capture:${reference.captureId ?? reference.uri}`,
      confidence: registration.confidence,
    }),
    confidence: registration.confidence,
    // Translation search has no discrete feature/inlier matches to report.
    matchedFeatureCount: 0,
    inlierCount: 0,
  });
}

function mapAndDedupeCandidates(
  localCandidates: readonly LocalCandidate[],
  request: ImageAnalysisRequest,
  scaleX: number,
  scaleY: number,
  strategy: LocalTargetAnalysisStrategy,
): readonly ShotCandidate[] {
  const mapped = localCandidates.map((candidate) => mapCandidate(candidate, request, scaleX, scaleY, strategy));
  const accepted: ShotCandidate[] = [];
  for (const candidate of mapped) {
    if (!accepted.some((known) => Math.hypot(candidate.position.x - known.position.x, candidate.position.y - known.position.y) <= request.sensitivity.deduplicationRadiusPixels)) {
      accepted.push(candidate);
    }
  }
  return Object.freeze(accepted);
}

function mapCandidate(
  candidate: LocalCandidate,
  request: ImageAnalysisRequest,
  scaleX: number,
  scaleY: number,
  strategy: LocalTargetAnalysisStrategy,
): ShotCandidate {
  const position = Object.freeze({ x: candidate.x / scaleX, y: candidate.y / scaleY });
  const bounds = Object.freeze({
    x: candidate.bounds.x / scaleX,
    y: candidate.bounds.y / scaleY,
    width: candidate.bounds.width / scaleX,
    height: candidate.bounds.height / scaleY,
  });
  const temporalNovelty = request.referenceMode === 'clean-baseline' ? 0.8 : 1;
  const interpretation = strategy.interpret(candidate, request.sensitivity);
  const scores = strategyScores(candidate, interpretation, temporalNovelty);
  const candidateBase: ChangeCandidate = Object.freeze({
    id: `${request.current.captureId ?? 'current'}:${candidate.id}`,
    position,
    bounds,
    areaPixels: candidate.area / (scaleX * scaleY),
    meanDifference: candidate.meanDifference,
  });
  return Object.freeze({
    ...candidateBase,
    confidence: clamp01(candidate.confidence * interpretation.confidenceMultiplier),
    classification: interpretation.classification,
    scores,
  });
}

function throwIfCancelled(cancellation: AnalysisCancellation | undefined): void {
  if (cancellation?.aborted) {
    throw new LocalImageAnalysisError(cancellation.reason ?? 'Image analysis was cancelled.');
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function validateTargetStrategies(
  strategies: readonly LocalTargetAnalysisStrategy[],
): readonly LocalTargetAnalysisStrategy[] {
  const seen = new Set<TargetType>();
  for (const strategy of strategies) {
    if (!strategy.id.trim()) throw new RangeError('Target analysis strategies need an id.');
    if (seen.has(strategy.targetType)) {
      throw new RangeError(`Duplicate target analysis strategy for ${strategy.targetType}.`);
    }
    seen.add(strategy.targetType);
  }
  return Object.freeze([...strategies]);
}
