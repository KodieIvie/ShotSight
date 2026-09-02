import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import {
  invertTransform,
  mapPointThroughTransform,
  type AnalysisCandidate,
  type PixelPoint,
  type PixelRect,
} from '../../domain';
import { Screen } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';
import { CandidateReviewScreen } from './CandidateReviewScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'CandidateReview'>;

/**
 * Navigation and persistence bridge for the presentation-only candidate
 * review surface. Candidate decisions remain durable, while the screen owns
 * its short-lived selection and focus state.
 */
export function CandidateReviewRouteScreen({ navigation, route }: Props) {
  const {
    analysisCandidates,
    captures,
    confirmAnalysisCandidate,
    rejectAnalysisCandidate,
    shots,
  } = useShotSight();
  const capture = captures.find((item) => item.id === route.params.captureId);
  const candidates = useMemo(
    () => capture
      ? analysisCandidates.filter(
        (candidate) => candidate.captureId === capture.id
          && (!route.params.jobId || candidate.jobId === route.params.jobId),
      )
      : [],
    [analysisCandidates, capture, route.params.jobId],
  );
  const knownShotCount = useMemo(
    () => capture
      ? shots.filter(
        (shot) => shot.targetId === capture.targetId
          && shot.baselineRevision === capture.baselineRevision,
      ).length
      : 0,
    [capture, shots],
  );
  const displayCandidates = useMemo(
    () => capture
      ? candidates.map((candidate) => candidateForCaptureDisplay(candidate, capture.id))
      : candidates,
    [candidates, capture],
  );

  if (!capture) {
    return (
      <Screen>
        <Text style={styles.missing}>This capture is not available in the active session.</Text>
      </Screen>
    );
  }

  return (
    <CandidateReviewScreen
      candidates={displayCandidates}
      capture={capture}
      initialDecisions={candidates.map((candidate) => ({
        candidateId: candidate.id,
        decision: candidate.state,
      }))}
      knownShotCount={knownShotCount}
      newestCandidateId={route.params.newestCandidateId}
      onClose={() => navigation.goBack()}
      onConfirmCandidate={async (candidate) => {
        await confirmAnalysisCandidate(candidate.id);
      }}
      onRejectCandidate={(candidate) => rejectAnalysisCandidate(candidate.id)}
    />
  );
}

/**
 * Candidate positions are persisted in registered clean-baseline coordinates
 * for stable deduplication and measurement. The review image is the current
 * source capture, so invert its saved registration transform only for display.
 */
function candidateForCaptureDisplay(
  candidate: AnalysisCandidate,
  captureId: string,
): AnalysisCandidate {
  const currentToBaseline = candidate.provenance.registrationTransform;
  if (!currentToBaseline || currentToBaseline.sourceSpace !== `capture:${captureId}`) {
    return candidate;
  }
  try {
    const baselineToCurrent = invertTransform(currentToBaseline);
    return Object.freeze({
      ...candidate,
      position: mapPointThroughTransform(candidate.position, baselineToCurrent),
      bounds: mapRect(candidate.bounds, baselineToCurrent),
    });
  } catch {
    // A historical malformed transform must not prevent a shooter from
    // reviewing or rejecting a candidate. Its stored position remains usable.
    return candidate;
  }
}

function mapRect(rect: PixelRect, transform: ReturnType<typeof invertTransform>): PixelRect {
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => mapPointThroughTransform(point, transform));
  return boundsForPoints(points);
}

function boundsForPoints(points: readonly PixelPoint[]): PixelRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Object.freeze({
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  });
}

const styles = StyleSheet.create({
  missing: {
    ...typography.body,
    color: palette.textMuted,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
