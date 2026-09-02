import path from 'node:path';

import { writeDebugImages, type DebugImageSet } from './debug-images';
import { generateDifference, type DifferenceOptions } from './difference';
import {
  assertSameDimensions,
  loadGrayImage,
  matchExposure,
  normalizeExposure,
} from './grayscale';
import { registerSmallTranslation } from './registration';
import { scoreShotCandidates } from './scoring';
import {
  applyMorphology,
  connectedComponents,
  robustThreshold,
  type MorphologyOptions,
} from './segmentation';
import type {
  BinaryImage,
  ConnectedComponent,
  DifferenceResult,
  GrayImage,
  LoadedGrayImage,
  Rect,
  RegistrationResult,
  Sensitivity,
  ShotCandidate,
  ThresholdResult,
} from './types';

export interface DetectionPipelineOptions {
  readonly sensitivity?: Sensitivity;
  readonly maxShift?: number;
  readonly maxDimension?: number;
  readonly roi?: Rect;
  readonly minimumArea?: number;
  readonly maximumArea?: number;
  readonly thresholdZScore?: number;
  readonly minimumThreshold?: number;
  readonly difference?: DifferenceOptions;
  readonly morphology?: MorphologyOptions;
}

export interface FileAnalysisOptions extends DetectionPipelineOptions {
  readonly debugDirectory?: string;
}

export interface PipelineArtifacts {
  readonly normalizedReference: GrayImage;
  readonly normalizedCurrent: GrayImage;
  readonly registeredCurrent: GrayImage;
  readonly registration: RegistrationResult;
  readonly difference: DifferenceResult;
  readonly threshold: ThresholdResult;
  readonly cleanedMask: BinaryImage;
  readonly components: ConnectedComponent[];
  readonly candidates: ShotCandidate[];
}

interface SensitivityPreset {
  readonly zScore: number;
  readonly minimumThreshold: number;
  readonly minimumArea: number;
  readonly minimumNeighbors: number;
}

const sensitivityPresets: Record<Sensitivity, SensitivityPreset> = {
  low: { zScore: 8, minimumThreshold: 20, minimumArea: 7, minimumNeighbors: 3 },
  medium: { zScore: 6, minimumThreshold: 12, minimumArea: 5, minimumNeighbors: 2 },
  high: { zScore: 4, minimumThreshold: 8, minimumArea: 3, minimumNeighbors: 1 },
};

function fillInvalidPixels(
  image: GrayImage,
  reference: GrayImage,
  validMask: BinaryImage,
): GrayImage {
  const output = new Float32Array(image.data);
  for (let index = 0; index < output.length; index += 1) {
    if (validMask.data[index] === 0) {
      output[index] = reference.data[index];
    }
  }
  return { width: image.width, height: image.height, data: output };
}

function asLoadedImage(image: GrayImage): LoadedGrayImage {
  return {
    ...image,
    path: '<memory>',
    sourceWidth: image.width,
    sourceHeight: image.height,
    scaleX: 1,
    scaleY: 1,
  };
}

/** Runs every pure processing stage against decoded, equally-sized frames. */
export function analyzeFrames(
  referenceInput: GrayImage,
  currentInput: GrayImage,
  options: DetectionPipelineOptions = {},
  currentMetadata?: Pick<LoadedGrayImage, 'scaleX' | 'scaleY'>,
): PipelineArtifacts {
  assertSameDimensions(referenceInput, currentInput);
  const sensitivity = options.sensitivity ?? 'medium';
  const preset = sensitivityPresets[sensitivity];
  const normalizedReference = normalizeExposure(referenceInput);
  const normalizedCurrent = normalizeExposure(currentInput);
  const registration = registerSmallTranslation(normalizedReference, normalizedCurrent, {
    maxShift: options.maxShift ?? 20,
    roi: options.roi,
  });
  const exposureMatched = matchExposure(
    normalizedReference,
    registration.registered,
    registration.validMask,
  );
  const registeredCurrent = fillInvalidPixels(
    exposureMatched,
    normalizedReference,
    registration.validMask,
  );
  const difference = generateDifference(
    normalizedReference,
    registeredCurrent,
    registration.validMask,
    options.difference,
  );
  const threshold = robustThreshold(difference.difference, registration.validMask, {
    roi: options.roi,
    zScore: options.thresholdZScore ?? preset.zScore,
    minimumThreshold: options.minimumThreshold ?? preset.minimumThreshold,
  });
  const cleanedMask = applyMorphology(threshold.mask, {
    closeRadius: options.morphology?.closeRadius ?? 1,
    openRadius: options.morphology?.openRadius ?? 0,
    minimumNeighbors: options.morphology?.minimumNeighbors ?? preset.minimumNeighbors,
  });
  const components = connectedComponents(cleanedMask, difference.difference, difference.signed);
  const candidates = scoreShotCandidates(components, {
    threshold: threshold.threshold,
    imageWidth: referenceInput.width,
    imageHeight: referenceInput.height,
    registrationConfidence: registration.confidence,
    registrationOffsetX: registration.offsetX,
    registrationOffsetY: registration.offsetY,
    currentImage: currentMetadata ?? asLoadedImage(currentInput),
    minimumArea: options.minimumArea ?? preset.minimumArea,
    maximumArea: options.maximumArea,
  });

  return {
    normalizedReference,
    normalizedCurrent,
    registeredCurrent,
    registration,
    difference,
    threshold,
    cleanedMask,
    components,
    candidates,
  };
}

export interface ImageDescription {
  readonly path: string;
  readonly source: { readonly width: number; readonly height: number };
  readonly processing: {
    readonly width: number;
    readonly height: number;
    readonly scaleX: number;
    readonly scaleY: number;
  };
}

export interface ImagePairAnalysisResult {
  readonly schemaVersion: 1;
  readonly baseline: ImageDescription;
  readonly current: ImageDescription;
  readonly sensitivity: Sensitivity;
  readonly roi?: Rect;
  readonly registration: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly meanAbsoluteError: number;
    readonly confidence: number;
    readonly overlapRatio: number;
  };
  readonly threshold: {
    readonly value: number;
    readonly median: number;
    readonly mad: number;
    readonly estimatedNoiseSigma: number;
  };
  readonly componentCount: number;
  readonly candidateCount: number;
  readonly candidates: ShotCandidate[];
  readonly debugImages?: DebugImageSet;
}

function describeImage(image: LoadedGrayImage): ImageDescription {
  return {
    path: path.resolve(image.path),
    source: { width: image.sourceWidth, height: image.sourceHeight },
    processing: {
      width: image.width,
      height: image.height,
      scaleX: image.scaleX,
      scaleY: image.scaleY,
    },
  };
}

function rounded(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Decodes two files, runs the pipeline, and optionally writes developer artifacts. */
export async function analyzeImageFiles(
  baselinePath: string,
  currentPath: string,
  options: FileAnalysisOptions = {},
): Promise<ImagePairAnalysisResult> {
  const baseline = await loadGrayImage(baselinePath, {
    maxDimension: options.maxDimension ?? 1600,
  });
  const current = await loadGrayImage(currentPath, {
    width: baseline.width,
    height: baseline.height,
  });
  const baselineAspect = baseline.sourceWidth / baseline.sourceHeight;
  const currentAspect = current.sourceWidth / current.sourceHeight;
  if (Math.abs(baselineAspect - currentAspect) / baselineAspect > 0.03) {
    throw new Error(
      `Capture aspect ratios differ too much (${baseline.sourceWidth}x${baseline.sourceHeight} vs ${current.sourceWidth}x${current.sourceHeight})`,
    );
  }

  const artifacts = analyzeFrames(baseline, current, options, current);
  const debugImages = options.debugDirectory
    ? await writeDebugImages(
        options.debugDirectory,
        artifacts.registeredCurrent,
        artifacts.difference.difference,
        artifacts.cleanedMask,
      )
    : undefined;

  return {
    schemaVersion: 1,
    baseline: describeImage(baseline),
    current: describeImage(current),
    sensitivity: options.sensitivity ?? 'medium',
    ...(options.roi ? { roi: options.roi } : {}),
    registration: {
      offsetX: artifacts.registration.offsetX,
      offsetY: artifacts.registration.offsetY,
      meanAbsoluteError: rounded(artifacts.registration.meanAbsoluteError),
      confidence: rounded(artifacts.registration.confidence),
      overlapRatio: rounded(artifacts.registration.overlapRatio),
    },
    threshold: {
      value: rounded(artifacts.threshold.threshold),
      median: rounded(artifacts.threshold.median),
      mad: rounded(artifacts.threshold.mad),
      estimatedNoiseSigma: rounded(artifacts.threshold.estimatedNoiseSigma),
    },
    componentCount: artifacts.components.length,
    candidateCount: artifacts.candidates.length,
    candidates: artifacts.candidates,
    ...(debugImages ? { debugImages } : {}),
  };
}
