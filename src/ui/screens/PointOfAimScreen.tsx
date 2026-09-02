import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { calculatePoaPoiOffset, type PoaPoiOffset } from '../../domain';
import {
  Button,
  Card,
  Screen,
  TargetImageCanvas,
  pointToNormalized,
  type TargetImageMarker,
  type NormalizedPoint,
} from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';
import { shotsForTargetBaseline } from './rangeReviewUtils';
import { selectTargetToolCapture } from './targetToolUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'PointOfAim'>;
type ReferenceKind = 'point-of-aim' | 'desired-zero';

export function PointOfAimScreen({ route }: Props) {
  const {
    activeSession,
    activeTarget,
    captures,
    shots,
    busyOperation,
    setTargetReferencePoint,
  } = useShotSight();
  const capture = useMemo(
    () => selectTargetToolCapture(captures, activeTarget, route.params?.captureId),
    [activeTarget, captures, route.params?.captureId],
  );
  const [editing, setEditing] = useState<ReferenceKind>('point-of-aim');

  if (!activeSession || !activeTarget || !capture) {
    return (
      <Screen>
        <Text style={styles.missing}>Capture a target image before placing POA or desired-zero references.</Text>
      </Screen>
    );
  }

  const markers: TargetImageMarker[] = [];
  if (activeTarget.pointOfAim) {
    markers.push({
      point: pointToNormalized(activeTarget.pointOfAim, capture.widthPixels, capture.heightPixels),
      label: 'POA',
      color: palette.accent,
    });
  }
  if (activeTarget.desiredZeroPoint) {
    markers.push({
      point: pointToNormalized(activeTarget.desiredZeroPoint, capture.widthPixels, capture.heightPixels),
      label: 'ZERO',
      color: palette.info,
    });
  }

  const hitPoint = (point: NormalizedPoint): void => {
    void setTargetReferencePoint(editing, point).catch((error) => {
      Alert.alert('Could not save reference point', safeError(error));
    });
  };

  const clearReference = (): void => {
    void setTargetReferencePoint(editing).catch((error) => {
      Alert.alert('Could not clear reference point', safeError(error));
    });
  };

  const targetShots = shotsForTargetBaseline(
    shots,
    activeTarget.id,
    activeTarget.baseline?.revision,
  );
  const poaOffset = calculateOffset(
    targetShots,
    activeTarget.pointOfAim,
    activeTarget.calibration,
    activeSession.targetDistanceYards,
  );
  const desiredZeroOffset = calculateOffset(
    targetShots,
    activeTarget.desiredZeroPoint,
    activeTarget.calibration,
    activeSession.targetDistanceYards,
  );

  return (
    <Screen>
      <Text style={styles.title}>POA / POI</Text>
      <Text style={styles.subtitle}>Set the intended aim point and, if useful, a separate desired-zero point. Tap the image to place the selected reference.</Text>
      <View style={styles.modeRow}>
        <Button compact icon="crosshairs" label="Point of aim" onPress={() => setEditing('point-of-aim')} style={styles.modeButton} variant={editing === 'point-of-aim' ? 'primary' : 'secondary'} />
        <Button compact icon="target" label="Desired zero" onPress={() => setEditing('desired-zero')} style={styles.modeButton} variant={editing === 'desired-zero' ? 'primary' : 'secondary'} />
      </View>
      <Text style={styles.instruction}>{editing === 'point-of-aim' ? 'Tap where this group was aimed.' : 'Tap where the group should be centered for this zero.'}</Text>
      <TargetImageCanvas
        aspectRatio={capture.widthPixels / capture.heightPixels}
        imageUri={capture.previewImageUri ?? capture.originalImageUri}
        interactionMode="tap"
        markers={markers}
        onPointPress={hitPoint}
        style={styles.canvas}
      />
      {(editing === 'point-of-aim' ? activeTarget.pointOfAim : activeTarget.desiredZeroPoint) ? (
        <Button compact icon="close-circle-outline" label={`Clear ${editing === 'point-of-aim' ? 'point of aim' : 'desired zero'}`} loading={busyOperation === 'updating'} onPress={clearReference} variant="ghost" />
      ) : null}

      {activeTarget.calibration ? (
        <>
          <OffsetCard heading="POI relative to POA" offset={poaOffset} />
          {activeTarget.desiredZeroPoint ? <OffsetCard heading="POI relative to desired zero" offset={desiredZeroOffset} /> : null}
        </>
      ) : (
        <Card style={styles.measurement} title="Measurement unavailable">
          <Text style={styles.measurementText}>Set a target calibration before ShotSight can convert this group’s average POI into inches, MOA, and MIL.</Text>
        </Card>
      )}
      <Text style={styles.referenceMeta}>Reference: capture #{capture.sequenceNumber} · baseline v{activeTarget.baseline?.revision} · {activeSession.targetDistanceYards} yd · flyer-marked and historical-baseline shots are excluded.</Text>
    </Screen>
  );
}

function OffsetCard({ heading, offset }: { readonly heading: string; readonly offset?: PoaPoiOffset }) {
  if (!offset) {
    return (
      <Card style={styles.measurement} title={heading}>
        <Text style={styles.measurementText}>Set this reference and confirm at least one non-flyer shot to calculate the group center.</Text>
      </Card>
    );
  }
  const poi = offset.poiRelativeToPoa;
  const correction = offset.correctionToPoa;
  return (
    <Card style={styles.measurement} title={heading}>
      <Text style={styles.measurementLead}>{formatLinear(poi.horizontalInches, 'right', 'left')} · {formatLinear(poi.verticalInches, 'high', 'low')}</Text>
      <Text style={styles.measurementText}>Average of {offset.shotCount} included {offset.shotCount === 1 ? 'shot' : 'shots'} · {Math.abs(poi.horizontalMoa).toFixed(2)} MOA / {Math.abs(poi.horizontalMil).toFixed(2)} MIL horizontal · {Math.abs(poi.verticalMoa).toFixed(2)} MOA / {Math.abs(poi.verticalMil).toFixed(2)} MIL vertical</Text>
      <Text style={styles.correction}>Correction: {formatAngular(correction.horizontalMoa, 'R', 'L')} · {formatAngular(correction.verticalMoa, 'UP', 'DN')} · {formatMil(correction.horizontalMil, 'R', 'L')} · {formatMil(correction.verticalMil, 'UP', 'DN')}</Text>
    </Card>
  );
}

function calculateOffset(
  shots: Parameters<typeof calculatePoaPoiOffset>[0],
  reference: Parameters<typeof calculatePoaPoiOffset>[1] | undefined,
  calibration: Parameters<typeof calculatePoaPoiOffset>[2] | undefined,
  distanceYards: number,
): PoaPoiOffset | undefined {
  if (!reference || !calibration || shots.filter((shot) => !shot.isFlyer).length === 0) return undefined;
  try {
    return calculatePoaPoiOffset(shots, reference, calibration, distanceYards);
  } catch {
    return undefined;
  }
}

function formatLinear(value: number, positiveDirection: string, negativeDirection: string): string {
  return `${Math.abs(value).toFixed(2)} in ${value < 0 ? negativeDirection : value > 0 ? positiveDirection : 'centered'}`;
}

function formatAngular(value: number, positiveDirection: string, negativeDirection: string): string {
  return `${Math.abs(value).toFixed(2)} MOA ${value < 0 ? negativeDirection : value > 0 ? positiveDirection : '—'}`;
}

function formatMil(value: number, positiveDirection: string, negativeDirection: string): string {
  return `${Math.abs(value).toFixed(2)} MIL ${value < 0 ? negativeDirection : value > 0 ? positiveDirection : '—'}`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  modeButton: { flex: 1 },
  instruction: { ...typography.label, color: palette.accent, marginBottom: spacing.sm },
  canvas: { marginBottom: spacing.md },
  measurement: { gap: spacing.xs, marginTop: spacing.md },
  measurementLead: { ...typography.heading, color: palette.text },
  measurementText: { ...typography.body, color: palette.textMuted },
  correction: { ...typography.label, color: palette.accent, marginTop: spacing.xs },
  referenceMeta: { ...typography.caption, color: palette.textDim, marginTop: spacing.lg, textAlign: 'center' },
  missing: { ...typography.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
