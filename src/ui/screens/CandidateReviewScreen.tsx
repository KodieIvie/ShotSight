import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { ShotCandidate } from '../../domain';
import {
  CandidateReviewCanvas,
  type CandidateReviewCanvasDecision,
  type CandidateReviewDecision,
} from '../components/CandidateReviewCanvas';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { StatusPill } from '../components/StatusPill';
import { palette, radius, spacing, typography } from '../theme';

/** The minimum capture information needed to render a candidate review. */
export interface CandidateReviewCapture {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly originalImageUri: string;
  readonly previewImageUri?: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

/**
 * A presentation-only candidate review contract. Integrators decide whether a
 * confirmation is written to a repository, queued offline, or merely retained
 * in an analysis result.
 */
export interface CandidateReviewScreenProps {
  readonly capture: CandidateReviewCapture;
  readonly candidates: readonly ShotCandidate[];
  readonly newestCandidateId?: string;
  readonly knownShotCount?: number;
  readonly initialDecisions?: readonly CandidateReviewCanvasDecision[];
  readonly onConfirmCandidate: (candidate: ShotCandidate) => void | Promise<void>;
  readonly onRejectCandidate: (candidate: ShotCandidate) => void | Promise<void>;
  /** Lets a route owner center/zoom another target surface around this candidate. */
  readonly onFocusNewestShot?: (candidate: ShotCandidate) => void;
  readonly onClose?: () => void;
}

/**
 * Review candidates before they become numbered shots. It intentionally owns
 * only ephemeral review state; the callbacks are the persistence boundary.
 */
export function CandidateReviewScreen({
  capture,
  candidates,
  newestCandidateId,
  knownShotCount = 0,
  initialDecisions = [],
  onConfirmCandidate,
  onRejectCandidate,
  onFocusNewestShot,
  onClose,
}: CandidateReviewScreenProps) {
  const newestCandidate = useMemo(
    () => findNewestCandidate(candidates, newestCandidateId),
    [candidates, newestCandidateId],
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | undefined>(
    newestCandidate?.id,
  );
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | undefined>(
    newestCandidate?.id,
  );
  const [decisions, setDecisions] = useState<readonly CandidateReviewCanvasDecision[]>(
    initialDecisions,
  );
  const [pendingCandidateId, setPendingCandidateId] = useState<string>();
  const [error, setError] = useState<string>();

  const decisionById = useMemo(
    () => new Map(decisions.map((decision) => [decision.candidateId, decision.decision])),
    [decisions],
  );
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId)
    ?? newestCandidate;
  const focusedCandidate = candidates.find((candidate) => candidate.id === focusedCandidateId)
    ?? newestCandidate;
  const pendingCount = candidates.filter(
    (candidate) => (decisionById.get(candidate.id) ?? 'pending') === 'pending',
  ).length;

  useEffect(() => {
    if (!selectedCandidateId || !candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(newestCandidate?.id);
    }
  }, [candidates, newestCandidate?.id, selectedCandidateId]);

  useEffect(() => {
    if (!focusedCandidateId || !candidates.some((candidate) => candidate.id === focusedCandidateId)) {
      setFocusedCandidateId(newestCandidate?.id);
    }
  }, [candidates, focusedCandidateId, newestCandidate?.id]);

  const focusNewest = (): void => {
    if (!newestCandidate) return;
    setSelectedCandidateId(newestCandidate.id);
    setFocusedCandidateId(newestCandidate.id);
    onFocusNewestShot?.(newestCandidate);
  };

  const decide = async (
    candidate: ShotCandidate,
    decision: Exclude<CandidateReviewDecision, 'pending'>,
  ): Promise<void> => {
    if (pendingCandidateId || (decisionById.get(candidate.id) ?? 'pending') !== 'pending') return;
    setError(undefined);
    setPendingCandidateId(candidate.id);
    try {
      if (decision === 'confirmed') {
        await onConfirmCandidate(candidate);
      } else {
        await onRejectCandidate(candidate);
      }
      setDecisions((previous) => setDecision(previous, candidate.id, decision));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The candidate could not be updated.');
    } finally {
      setPendingCandidateId(undefined);
    }
  };

  if (!candidates.length) {
    return (
      <Screen footer={onClose ? <Button icon="close" label="Close review" onPress={onClose} variant="secondary" /> : undefined}>
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.success} name="check-decagram-outline" size={50} />
          <Text style={styles.emptyTitle}>No new impacts proposed</Text>
          <Text style={styles.emptyCopy}>Capture #{capture.sequenceNumber} did not produce any reviewable changes. Existing shots remain unchanged.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen footer={onClose ? <Button icon="check" label="Finish review" onPress={onClose} variant="secondary" /> : undefined}>
      <Text style={styles.title}>Review proposed impacts</Text>
      <Text style={styles.subtitle}>Confirm only the changes that are actual impacts. A confirmed candidate receives the next shot number; rejection never removes a previously saved shot.</Text>

      <CandidateReviewCanvas
        activeCandidateId={selectedCandidate?.id}
        candidates={candidates}
        decisions={decisions}
        heightPixels={capture.heightPixels}
        imageUri={capture.previewImageUri ?? capture.originalImageUri}
        onCandidatePress={(candidate) => {
          setSelectedCandidateId(candidate.id);
          setFocusedCandidateId(candidate.id);
        }}
        widthPixels={capture.widthPixels}
      />

      {focusedCandidate ? (
        <CandidateFocusPreview candidate={focusedCandidate} capture={capture} />
      ) : null}

      <View style={styles.summaryRow}>
        <Summary label="To review" value={String(pendingCount)} />
        <Summary label="Known shots" value={String(knownShotCount)} />
        <Summary label="Capture" value={`#${capture.sequenceNumber}`} />
      </View>

      {newestCandidate ? (
        <Button
          compact
          icon="crosshairs-gps"
          label={`Focus newest candidate (${formatConfidence(newestCandidate.confidence)})`}
          onPress={focusNewest}
          variant="ghost"
        />
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={styles.error}>
          <MaterialCommunityIcons color={palette.danger} name="alert-circle-outline" size={20} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {candidates.map((candidate, index) => {
          const decision = decisionById.get(candidate.id) ?? 'pending';
          const isPending = decision === 'pending';
          const isWorking = pendingCandidateId === candidate.id;
          return (
            <Card
              key={candidate.id}
              style={[
                styles.candidateCard,
                candidate.id === selectedCandidate?.id && styles.candidateCardSelected,
                decision === 'rejected' && styles.candidateCardRejected,
              ]}
              title={`Candidate ${index + 1}`}
              accessory={<DecisionPill decision={decision} confidence={candidate.confidence} />}
            >
              <Text style={styles.classification}>{formatClassification(candidate.classification)}</Text>
              <Text style={styles.candidateMeta}>{Math.round(candidate.position.x)}, {Math.round(candidate.position.y)} px · {Math.round(candidate.areaPixels)} px² · difference {Math.round(candidate.meanDifference)}</Text>
              <ConfidenceBreakdown candidate={candidate} />
              {isPending ? (
                <View style={styles.actions}>
                  <Button
                    compact
                    icon="close-circle-outline"
                    label="Reject"
                    loading={isWorking && pendingCandidateId === candidate.id}
                    onPress={() => void decide(candidate, 'rejected')}
                    style={styles.action}
                    variant="ghost"
                  />
                  <Button
                    compact
                    icon="check-circle-outline"
                    label="Confirm impact"
                    loading={isWorking && pendingCandidateId === candidate.id}
                    onPress={() => void decide(candidate, 'confirmed')}
                    style={styles.action}
                  />
                </View>
              ) : (
                <Text style={styles.outcome}>{decision === 'confirmed' ? 'Confirmed through the integration callback.' : 'Rejected through the integration callback.'}</Text>
              )}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

/** A locally rendered 3× crop, centered on the selected/newest candidate. */
function CandidateFocusPreview({
  candidate,
  capture,
}: {
  readonly candidate: ShotCandidate;
  readonly capture: CandidateReviewCapture;
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const zoom = 3;
  const left = layout.width / 2 - (candidate.position.x / capture.widthPixels) * layout.width * zoom;
  const top = layout.height / 2 - (candidate.position.y / capture.heightPixels) * layout.height * zoom;
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setLayout({ width, height });
  };

  return (
    <View style={styles.focusSection}>
      <View style={styles.focusHeading}>
        <MaterialCommunityIcons color={palette.accent} name="crosshairs-gps" size={18} />
        <Text style={styles.focusTitle}>Impact focus</Text>
        <Text style={styles.focusMeta}>3× centered view</Text>
      </View>
      <View
        onLayout={onLayout}
        style={[styles.focusFrame, { aspectRatio: capture.widthPixels / capture.heightPixels }]}
      >
        {layout.width > 0 && layout.height > 0 ? (
          <Image
            resizeMode="stretch"
            source={{ uri: capture.previewImageUri ?? capture.originalImageUri }}
            style={[styles.focusImage, {
              width: layout.width * zoom,
              height: layout.height * zoom,
              left,
              top,
            }]}
          />
        ) : null}
        <View pointerEvents="none" style={styles.focusReticle}>
          <View style={styles.focusDot} />
        </View>
      </View>
    </View>
  );
}

/** Prefers an explicit analysis-provided newest id, then temporal novelty. */
export function findNewestCandidate(
  candidates: readonly ShotCandidate[],
  newestCandidateId?: string,
): ShotCandidate | undefined {
  const explicit = newestCandidateId
    ? candidates.find((candidate) => candidate.id === newestCandidateId)
    : undefined;
  if (explicit) return explicit;

  return candidates.reduce<ShotCandidate | undefined>((newest, candidate) => {
    if (!newest) return candidate;
    if (candidate.scores.temporalNovelty > newest.scores.temporalNovelty) return candidate;
    if (
      candidate.scores.temporalNovelty === newest.scores.temporalNovelty
      && candidate.confidence > newest.confidence
    ) {
      return candidate;
    }
    return newest;
  }, undefined);
}

function setDecision(
  decisions: readonly CandidateReviewCanvasDecision[],
  candidateId: string,
  decision: CandidateReviewDecision,
): readonly CandidateReviewCanvasDecision[] {
  const withoutCandidate = decisions.filter((existing) => existing.candidateId !== candidateId);
  return Object.freeze([...withoutCandidate, Object.freeze({ candidateId, decision })]);
}

function DecisionPill({ decision, confidence }: { readonly decision: CandidateReviewDecision; readonly confidence: number }) {
  if (decision === 'confirmed') return <StatusPill label="Confirmed" tone="success" />;
  if (decision === 'rejected') return <StatusPill label="Rejected" tone="neutral" />;
  return <StatusPill label={formatConfidence(confidence)} tone={confidence >= 0.8 ? 'success' : confidence >= 0.55 ? 'warning' : 'neutral'} />;
}

function ConfidenceBreakdown({ candidate }: { readonly candidate: ShotCandidate }) {
  const rows = [
    ['Novelty', candidate.scores.temporalNovelty],
    ['Shape', candidate.scores.shape],
    ['Contrast', candidate.scores.contrast],
  ] as const;
  return (
    <View style={styles.breakdown}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>{label}</Text>
          <View style={styles.barTrack}><View style={[styles.barFill, { width: `${clampUnit(value) * 100}%` }]} /></View>
          <Text style={styles.breakdownValue}>{Math.round(clampUnit(value) * 100)}</Text>
        </View>
      ))}
    </View>
  );
}

function Summary({ label, value }: { readonly label: string; readonly value: string }) {
  return <View style={styles.summary}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function formatClassification(value: ShotCandidate['classification']): string {
  switch (value) {
    case 'probable-paper-impact':
      return 'Probable paper impact';
    case 'probable-steel-impact':
      return 'Probable steel impact';
    default:
      return 'Unclassified target change';
  }
}

function formatConfidence(value: number): string {
  return `${Math.round(clampUnit(value) * 100)}% confidence`;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  summaryRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  summary: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  summaryValue: { ...typography.heading, color: palette.accent },
  summaryLabel: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  focusSection: { marginTop: spacing.md },
  focusHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  focusTitle: { ...typography.label, color: palette.text },
  focusMeta: { ...typography.caption, color: palette.textDim, marginLeft: 'auto' },
  focusFrame: { overflow: 'hidden', borderWidth: 1, borderColor: palette.accent, borderRadius: radius.md, backgroundColor: palette.black },
  focusImage: { position: 'absolute' },
  focusReticle: { position: 'absolute', left: '50%', top: '50%', width: 44, height: 44, marginLeft: -22, marginTop: -22, borderWidth: 2, borderRadius: 22, borderColor: palette.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(9, 13, 11, 0.25)' },
  focusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.accent },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  candidateCard: { gap: spacing.sm },
  candidateCardSelected: { borderColor: palette.accent, backgroundColor: '#1E2118' },
  candidateCardRejected: { opacity: 0.72 },
  classification: { ...typography.label, color: palette.text },
  candidateMeta: { ...typography.caption, color: palette.textMuted },
  breakdown: { gap: spacing.xxs },
  breakdownRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  breakdownLabel: { ...typography.caption, color: palette.textDim, width: 56 },
  barTrack: { flex: 1, height: 6, overflow: 'hidden', borderRadius: 3, backgroundColor: palette.border },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: palette.accent },
  breakdownValue: { ...typography.caption, color: palette.textMuted, textAlign: 'right', width: 24 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
  outcome: { ...typography.caption, color: palette.textDim, marginTop: spacing.xs },
  error: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', borderWidth: 1, borderColor: palette.danger, borderRadius: radius.md, backgroundColor: '#2A1717', marginTop: spacing.md, padding: spacing.sm },
  errorText: { ...typography.caption, color: palette.danger, flex: 1 },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
});
