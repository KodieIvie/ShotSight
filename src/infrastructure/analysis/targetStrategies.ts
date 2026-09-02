import type {
  AnalysisSensitivity,
  ShotCandidateClassification,
  ShotCandidateScoreBreakdown,
  TargetType,
} from '../../domain';
import type { LocalCandidate } from './localPipeline';

/**
 * A target-specific interpretation layer applied after local registration and
 * change extraction. It intentionally does not duplicate the pixel pipeline:
 * paper holes and steel paint chips share registration, exposure matching,
 * morphology, and connected-component extraction, but use different evidence
 * when a change is presented for human review.
 */
export interface LocalTargetAnalysisStrategy {
  readonly targetType: TargetType;
  readonly id: string;
  interpret(
    candidate: LocalCandidate,
    sensitivity: AnalysisSensitivity,
  ): LocalStrategyInterpretation;
}

export interface LocalStrategyInterpretation {
  readonly classification: ShotCandidateClassification;
  /** Multiplied by the detector confidence and clamped to 0..1. */
  readonly confidenceMultiplier: number;
  /** Target-specific replacement for the generic shape score. */
  readonly shapeScore: number;
}

/** Paper holes tend to be dark, compact changes; bright-only changes remain reviewable but conservative. */
export const paperTargetAnalysisStrategy: LocalTargetAnalysisStrategy = Object.freeze({
  targetType: 'paper',
  id: 'paper-hole-v1',
  interpret(candidate: LocalCandidate) {
    const polarityEvidence = candidate.polarity === 'darkening'
      ? 1
      : candidate.polarity === 'mixed'
        ? 0.78
        : 0.38;
    const compactness = compactShapeScore(candidate);
    return Object.freeze({
      classification: candidate.polarity === 'lightening'
        ? 'unknown-change'
        : 'probable-paper-impact',
      confidenceMultiplier: clamp01(0.62 + 0.38 * polarityEvidence),
      shapeScore: compactness,
    });
  },
});

/**
 * Fresh steel impacts frequently remove paint and can be irregular rather
 * than circular. Both bright paint loss and dark/mixed changes stay visible
 * for confirmation; paint-removal polarity earns more confidence, not an
 * automatic shot.
 */
export const steelTargetAnalysisStrategy: LocalTargetAnalysisStrategy = Object.freeze({
  targetType: 'steel',
  id: 'steel-paint-chip-v1',
  interpret(candidate: LocalCandidate) {
    const paintRemovalEvidence = candidate.polarity === 'lightening'
      ? 1
      : candidate.polarity === 'mixed'
        ? 0.82
        : 0.62;
    const chipShape = irregularChipShapeScore(candidate);
    return Object.freeze({
      classification: 'probable-steel-impact',
      confidenceMultiplier: clamp01(0.66 + 0.34 * paintRemovalEvidence),
      shapeScore: chipShape,
    });
  },
});

/** Other target surfaces keep detector output conservative and review-only. */
export const genericTargetAnalysisStrategy: LocalTargetAnalysisStrategy = Object.freeze({
  targetType: 'other',
  id: 'generic-change-v1',
  interpret(candidate: LocalCandidate) {
    return Object.freeze({
      classification: 'unknown-change',
      confidenceMultiplier: 0.82,
      shapeScore: candidate.scores.shape,
    });
  },
});

export const DEFAULT_LOCAL_TARGET_ANALYSIS_STRATEGIES: readonly LocalTargetAnalysisStrategy[] = Object.freeze([
  paperTargetAnalysisStrategy,
  steelTargetAnalysisStrategy,
  genericTargetAnalysisStrategy,
]);

export function selectLocalTargetAnalysisStrategy(
  targetType: TargetType,
  strategies: readonly LocalTargetAnalysisStrategy[] = DEFAULT_LOCAL_TARGET_ANALYSIS_STRATEGIES,
): LocalTargetAnalysisStrategy {
  return strategies.find((strategy) => strategy.targetType === targetType)
    ?? genericTargetAnalysisStrategy;
}

export function strategyScores(
  candidate: LocalCandidate,
  interpretation: LocalStrategyInterpretation,
  temporalNovelty: number,
): ShotCandidateScoreBreakdown {
  return Object.freeze({
    locality: candidate.scores.locality,
    shape: interpretation.shapeScore,
    size: candidate.scores.size,
    contrast: candidate.scores.contrast,
    temporalNovelty,
  });
}

function compactShapeScore(candidate: LocalCandidate): number {
  return clamp01(
    0.5 * candidate.scores.shape
      + 0.3 * candidate.circularity
      + 0.2 * candidate.fillRatio,
  );
}

function irregularChipShapeScore(candidate: LocalCandidate): number {
  // A chip may be non-circular, but random skinny noise should not score high.
  const usefulIrregularity = 1 - Math.abs(candidate.circularity - 0.58);
  return clamp01(
    0.42 * candidate.fillRatio
      + 0.33 * usefulIrregularity
      + 0.25 * candidate.scores.shape,
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
