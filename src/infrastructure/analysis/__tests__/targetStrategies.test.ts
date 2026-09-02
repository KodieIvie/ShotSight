import { describe, expect, it } from 'vitest';

import type { LocalCandidate } from '../localPipeline';
import {
  genericTargetAnalysisStrategy,
  paperTargetAnalysisStrategy,
  selectLocalTargetAnalysisStrategy,
  steelTargetAnalysisStrategy,
  strategyScores,
} from '../targetStrategies';

function candidate(polarity: LocalCandidate['polarity']): LocalCandidate {
  return Object.freeze({
    id: 1,
    x: 50,
    y: 60,
    bounds: { x: 45, y: 55, width: 10, height: 10, right: 55, bottom: 65 },
    area: 64,
    meanDifference: 34,
    maxDifference: 80,
    circularity: 0.48,
    fillRatio: 0.62,
    polarity,
    confidence: 0.8,
    scores: { locality: 0.88, shape: 0.68, size: 0.74, contrast: 0.82 },
  });
}

const sensitivity = Object.freeze({
  preset: 'medium' as const,
  minimumDifference: 12,
  minimumAreaPixels: 5,
  maximumAreaPixels: 1_000,
  deduplicationRadiusPixels: 8,
});

describe('local target analysis strategies', () => {
  it('treats lightening paint removal as strong review evidence for steel', () => {
    const brightChip = steelTargetAnalysisStrategy.interpret(candidate('lightening'), sensitivity);
    const darkChange = steelTargetAnalysisStrategy.interpret(candidate('darkening'), sensitivity);

    expect(brightChip.classification).toBe('probable-steel-impact');
    expect(brightChip.confidenceMultiplier).toBeGreaterThan(darkChange.confidenceMultiplier);
    expect(brightChip.shapeScore).toBeGreaterThan(0);
    expect(brightChip.shapeScore).toBeLessThanOrEqual(1);
  });

  it('keeps bright-only paper changes reviewable but conservative', () => {
    const darkHole = paperTargetAnalysisStrategy.interpret(candidate('darkening'), sensitivity);
    const brightChange = paperTargetAnalysisStrategy.interpret(candidate('lightening'), sensitivity);

    expect(darkHole.classification).toBe('probable-paper-impact');
    expect(brightChange.classification).toBe('unknown-change');
    expect(brightChange.confidenceMultiplier).toBeLessThan(darkHole.confidenceMultiplier);
  });

  it('selects a target strategy and retains complete score breakdowns', () => {
    const selected = selectLocalTargetAnalysisStrategy('steel');
    const interpretation = selected.interpret(candidate('mixed'), sensitivity);
    const scores = strategyScores(candidate('mixed'), interpretation, 0.8);

    expect(selected).toBe(steelTargetAnalysisStrategy);
    expect(selectLocalTargetAnalysisStrategy('other')).toBe(genericTargetAnalysisStrategy);
    expect(scores).toEqual({
      locality: 0.88,
      shape: interpretation.shapeScore,
      size: 0.74,
      contrast: 0.82,
      temporalNovelty: 0.8,
    });
  });
});
