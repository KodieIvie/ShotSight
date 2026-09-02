import type { ShotCandidate } from '../../domain';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radius, spacing, typography } from '../theme';

export type CandidateReviewDecision = 'pending' | 'confirmed' | 'rejected';

export interface CandidateReviewCanvasDecision {
  readonly candidateId: string;
  readonly decision: CandidateReviewDecision;
}

interface CandidateReviewCanvasProps {
  readonly imageUri: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly candidates: readonly ShotCandidate[];
  readonly decisions?: readonly CandidateReviewCanvasDecision[];
  readonly activeCandidateId?: string;
  readonly onCandidatePress?: (candidate: ShotCandidate) => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * A presentation-only target view for reviewable analysis candidates. Its
 * coordinates are full-resolution image coordinates, so it does not need to
 * know how candidates were detected or persisted.
 */
export function CandidateReviewCanvas({
  imageUri,
  widthPixels,
  heightPixels,
  candidates,
  decisions = [],
  activeCandidateId,
  onCandidatePress,
  style,
  testID,
}: CandidateReviewCanvasProps) {
  const decisionById = new Map(
    decisions.map((decision) => [decision.candidateId, decision.decision]),
  );
  const activeCandidate = candidates.find((candidate) => candidate.id === activeCandidateId);
  const aspectRatio = validDimension(widthPixels) && validDimension(heightPixels)
    ? widthPixels / heightPixels
    : 1;

  return (
    <View
      accessibilityLabel="Target image with detected shot candidates"
      accessible
      style={[styles.canvas, { aspectRatio }, style]}
      testID={testID}
    >
      <Image resizeMode="stretch" source={{ uri: imageUri }} style={styles.image} />
      {activeCandidate ? (
        <CandidateBounds candidate={activeCandidate} heightPixels={heightPixels} widthPixels={widthPixels} />
      ) : null}
      {candidates.map((candidate, index) => (
        <CandidateMarker
          active={candidate.id === activeCandidateId}
          candidate={candidate}
          decision={decisionById.get(candidate.id) ?? 'pending'}
          heightPixels={heightPixels}
          key={candidate.id}
          label={String(index + 1)}
          onPress={onCandidatePress}
          widthPixels={widthPixels}
        />
      ))}
    </View>
  );
}

function CandidateMarker({
  active,
  candidate,
  decision,
  heightPixels,
  label,
  onPress,
  widthPixels,
}: {
  readonly active: boolean;
  readonly candidate: ShotCandidate;
  readonly decision: CandidateReviewDecision;
  readonly heightPixels: number;
  readonly label: string;
  readonly onPress?: (candidate: ShotCandidate) => void;
  readonly widthPixels: number;
}) {
  const color = decisionColor(decision);
  const left = asPercent(candidate.position.x, widthPixels);
  const top = asPercent(candidate.position.y, heightPixels);
  const outcomeLabel = decision === 'pending' ? 'candidate' : decision;

  return (
    <Pressable
      accessibilityHint="Select to inspect or review this candidate"
      accessibilityLabel={`Candidate ${label}, ${outcomeLabel}, ${Math.round(candidate.confidence * 100)} percent confidence`}
      accessibilityRole="button"
      onPress={() => onPress?.(candidate)}
      style={[
        styles.marker,
        { borderColor: color, left, top },
        active && styles.markerActive,
        decision === 'rejected' && styles.markerRejected,
      ]}
    >
      <Text style={[styles.markerText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function CandidateBounds({
  candidate,
  heightPixels,
  widthPixels,
}: {
  readonly candidate: ShotCandidate;
  readonly heightPixels: number;
  readonly widthPixels: number;
}) {
  const { bounds } = candidate;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.bounds,
        {
          left: asPercent(bounds.x, widthPixels),
          top: asPercent(bounds.y, heightPixels),
          width: asPercent(bounds.width, widthPixels),
          height: asPercent(bounds.height, heightPixels),
        },
      ]}
    />
  );
}

function asPercent(value: number, dimension: number): `${number}%` {
  if (!validDimension(dimension) || !Number.isFinite(value)) return '0%';
  return `${clamp(value / dimension) * 100}%`;
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function decisionColor(decision: CandidateReviewDecision): string {
  switch (decision) {
    case 'confirmed':
      return palette.success;
    case 'rejected':
      return palette.textDim;
    default:
      return palette.accent;
  }
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.black,
  },
  image: { width: '100%', height: '100%' },
  marker: {
    position: 'absolute',
    width: 36,
    height: 36,
    marginLeft: -18,
    marginTop: -18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 2,
    backgroundColor: 'rgba(9, 13, 11, 0.82)',
  },
  markerActive: {
    borderWidth: 3,
    transform: [{ scale: 1.16 }],
    backgroundColor: 'rgba(48, 37, 17, 0.94)',
  },
  markerRejected: { opacity: 0.6 },
  markerText: { ...typography.label, fontSize: 14 },
  bounds: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: palette.accent,
    backgroundColor: 'rgba(232, 184, 75, 0.09)',
  },
  legend: {
    position: 'absolute',
    left: spacing.xs,
  },
});
