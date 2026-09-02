import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import {
  calculatePoaPoiOffset,
  calculateScopeClickAdjustment,
  createCustomScopeClickValue,
  SCOPE_CLICK_PRESETS,
  type ScopeClickAdjustment,
  type ScopeClickPresetId,
  type ScopeClickUnit,
  type ScopeClickValue,
} from '../../domain';
import { Button, Card, Field, Screen, StatusPill } from '../components';
import { palette, spacing, typography } from '../theme';

type ReferenceKind = 'point-of-aim' | 'desired-zero';

const presetClicks = [
  SCOPE_CLICK_PRESETS['quarter-moa'],
  SCOPE_CLICK_PRESETS['eighth-moa'],
  SCOPE_CLICK_PRESETS['tenth-mil'],
] as const;

/**
 * A presentation-only zeroing assistant. It deliberately uses the current
 * target baseline and does not write a scope profile, adjustment, or shot.
 */
export function ZeroingAssistantScreen() {
  const { activeSession, activeTarget, shots } = useShotSight();
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>(() => (
    activeTarget?.desiredZeroPoint ? 'desired-zero' : 'point-of-aim'
  ));
  const [presetId, setPresetId] = useState<ScopeClickPresetId>('quarter-moa');
  const [customAmount, setCustomAmount] = useState('0.25');
  const [customUnit, setCustomUnit] = useState<ScopeClickUnit>('moa');

  useEffect(() => {
    if (referenceKind === 'desired-zero' && !activeTarget?.desiredZeroPoint) {
      setReferenceKind('point-of-aim');
    }
    if (referenceKind === 'point-of-aim' && !activeTarget?.pointOfAim && activeTarget?.desiredZeroPoint) {
      setReferenceKind('desired-zero');
    }
  }, [activeTarget?.desiredZeroPoint, activeTarget?.pointOfAim, referenceKind]);

  const baselineRevision = activeTarget?.baseline?.revision;
  const includedShots = useMemo(() => shots.filter((shot) => (
    shot.targetId === activeTarget?.id
    && !shot.isFlyer
    && (baselineRevision === undefined || shot.baselineRevision === baselineRevision)
  )), [activeTarget?.id, baselineRevision, shots]);
  const reference = referenceKind === 'desired-zero'
    ? activeTarget?.desiredZeroPoint
    : activeTarget?.pointOfAim;
  const referenceLabel = referenceKind === 'desired-zero' ? 'desired zero' : 'point of aim';

  const offset = useMemo(() => {
    if (!activeSession || !activeTarget?.calibration || !reference || !includedShots.length) {
      return undefined;
    }
    try {
      return calculatePoaPoiOffset(
        includedShots,
        reference,
        activeTarget.calibration,
        activeSession.targetDistanceYards,
      );
    } catch {
      return undefined;
    }
  }, [activeSession, activeTarget?.calibration, includedShots, reference]);

  const customClick = useMemo(() => {
    if (presetId !== 'custom') return undefined;
    try {
      return createCustomScopeClickValue(Number(customAmount), customUnit);
    } catch {
      return undefined;
    }
  }, [customAmount, customUnit, presetId]);
  const selectedClick: ScopeClickValue | undefined = presetId === 'custom'
    ? customClick
    : SCOPE_CLICK_PRESETS[presetId];
  const adjustment = useMemo<ScopeClickAdjustment | undefined>(() => {
    if (!offset || !selectedClick) return undefined;
    return calculateScopeClickAdjustment(offset.correctionToPoa, selectedClick);
  }, [offset, selectedClick]);

  if (!activeSession || !activeTarget) {
    return <MissingState message="Open a range session and target before calculating a zero." />;
  }

  if (!activeTarget.calibration) {
    return <MissingState message="Set a target calibration first so ShotSight can turn the group offset into angular scope clicks." />;
  }

  if (!activeTarget.pointOfAim && !activeTarget.desiredZeroPoint) {
    return <MissingState message="Set a point of aim or desired-zero reference before calculating scope clicks." />;
  }

  if (!includedShots.length) {
    return <MissingState message="Confirm at least one non-flyer impact on the current target baseline before calculating scope clicks." />;
  }

  return (
    <Screen>
      <Text style={styles.title}>Zeroing assistant</Text>
      <Text style={styles.subtitle}>Convert the current average POI offset into a nearest-whole-click adjustment. Turret directions assume the markings describe the direction the point of impact moves.</Text>

      {activeTarget.pointOfAim && activeTarget.desiredZeroPoint ? (
        <View style={styles.referenceRow}>
          <Button compact icon="crosshairs" label="Point of aim" onPress={() => setReferenceKind('point-of-aim')} style={styles.referenceButton} variant={referenceKind === 'point-of-aim' ? 'primary' : 'secondary'} />
          <Button compact icon="target" label="Desired zero" onPress={() => setReferenceKind('desired-zero')} style={styles.referenceButton} variant={referenceKind === 'desired-zero' ? 'primary' : 'secondary'} />
        </View>
      ) : null}

      <Card
        accessory={<StatusPill label={`${includedShots.length} impact${includedShots.length === 1 ? '' : 's'}`} tone="info" />}
        style={styles.card}
        title={`Current POI vs ${referenceLabel}`}
      >
        {offset ? (
          <>
            <Text style={styles.offsetLead}>{formatOffset(offset.poiRelativeToPoa.horizontalInches, 'right', 'left')} / {formatOffset(offset.poiRelativeToPoa.verticalInches, 'high', 'low')}</Text>
            <Text style={styles.offsetMeta}>{Math.abs(offset.correctionToPoa.horizontalMoa).toFixed(2)} MOA horizontal / {Math.abs(offset.correctionToPoa.verticalMoa).toFixed(2)} MOA vertical correction at {activeSession.targetDistanceYards} yd.</Text>
          </>
        ) : null}
      </Card>

      <Text style={styles.sectionTitle}>Turret click value</Text>
      <View style={styles.presetRow}>
        {presetClicks.map((click) => (
          <Button
            compact
            icon={click.unit === 'moa' ? 'circle-small' : 'circle-medium'}
            key={click.id}
            label={click.label}
            onPress={() => setPresetId(click.id)}
            style={styles.presetButton}
            variant={presetId === click.id ? 'primary' : 'secondary'}
          />
        ))}
      </View>
      <Button compact icon="tune-vertical" label="Custom" onPress={() => setPresetId('custom')} style={styles.customButton} variant={presetId === 'custom' ? 'primary' : 'secondary'} />

      {presetId === 'custom' ? (
        <Card style={styles.customCard} title="Custom click value">
          <Field
            error={customAmount.trim() && !customClick ? 'Enter a positive click value.' : undefined}
            keyboardType="decimal-pad"
            label="Amount per click"
            onChangeText={setCustomAmount}
            placeholder="e.g. 0.25"
            value={customAmount}
          />
          <View style={styles.unitRow}>
            <Button compact label="MOA" onPress={() => setCustomUnit('moa')} style={styles.unitButton} variant={customUnit === 'moa' ? 'primary' : 'secondary'} />
            <Button compact label="MIL" onPress={() => setCustomUnit('mil')} style={styles.unitButton} variant={customUnit === 'mil' ? 'primary' : 'secondary'} />
          </View>
        </Card>
      ) : null}

      {adjustment ? (
        <Card style={styles.recommendation} title="Recommended adjustment">
          <AxisInstruction adjustment={adjustment} axis="horizontal" />
          <AxisInstruction adjustment={adjustment} axis="vertical" />
          <Text style={styles.disclaimer}>Round to the nearest whole click, then fire a confirmation group. This is an aid, not a substitute for your optic's manual or verified turret tracking.</Text>
        </Card>
      ) : (
        <Card style={styles.recommendation} title="Recommended adjustment">
          <Text style={styles.unavailable}>Choose a valid custom click value to calculate the adjustment.</Text>
        </Card>
      )}

      <Text style={styles.referenceMeta}>Using current baseline v{baselineRevision ?? 1}; flyer-marked and historical-baseline shots are excluded.</Text>
    </Screen>
  );
}

function AxisInstruction({
  adjustment,
  axis,
}: {
  readonly adjustment: ScopeClickAdjustment;
  readonly axis: 'horizontal' | 'vertical';
}) {
  const value = adjustment[axis];
  const direction = axis === 'horizontal'
    ? directionFor(value.correction, 'RIGHT', 'LEFT')
    : directionFor(value.correction, 'UP', 'DN');
  const title = axis === 'horizontal' ? 'Windage' : 'Elevation';
  const magnitude = Math.abs(value.recommendedClicks);
  const recommendation = magnitude === 0
    ? 'HOLD'
    : `${magnitude} ${magnitude === 1 ? 'click' : 'clicks'} ${direction}`;
  const residual = Math.abs(value.residual);

  return (
    <View style={styles.axisRow}>
      <Text style={styles.axisTitle}>{title}</Text>
      <Text style={styles.axisRecommendation}>{recommendation}</Text>
      <Text style={styles.axisMeta}>{Math.abs(value.exactClicks).toFixed(2)} exact clicks{residual > 0.000001 ? ` / ${residual.toFixed(3)} ${adjustment.click.unit.toUpperCase()} remains after rounding` : ''}</Text>
    </View>
  );
}

function MissingState({ message }: { readonly message: string }) {
  return (
    <Screen>
      <Text style={styles.title}>Zeroing assistant</Text>
      <Card style={styles.missingCard} title="Not ready yet">
        <Text style={styles.missing}>{message}</Text>
      </Card>
    </Screen>
  );
}

function formatOffset(value: number, positiveDirection: string, negativeDirection: string): string {
  return `${Math.abs(value).toFixed(2)} in ${directionFor(value, positiveDirection, negativeDirection)}`;
}

function directionFor(value: number, positiveDirection: string, negativeDirection: string): string {
  if (value > 0) return positiveDirection;
  if (value < 0) return negativeDirection;
  return 'CENTERED';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  card: { gap: spacing.xs, marginTop: spacing.md },
  referenceRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  referenceButton: { flex: 1 },
  offsetLead: { ...typography.heading, color: palette.text },
  offsetMeta: { ...typography.body, color: palette.textMuted },
  sectionTitle: { ...typography.heading, color: palette.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  presetButton: { flexGrow: 1, flexBasis: 100 },
  customButton: { marginTop: spacing.sm },
  customCard: { gap: spacing.md, marginTop: spacing.md },
  unitRow: { flexDirection: 'row', gap: spacing.sm },
  unitButton: { flex: 1 },
  recommendation: { gap: spacing.md, marginTop: spacing.lg },
  axisRow: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.xxs, paddingBottom: spacing.md },
  axisTitle: { ...typography.label, color: palette.textMuted },
  axisRecommendation: { ...typography.heading, color: palette.accent, fontSize: 25 },
  axisMeta: { ...typography.caption, color: palette.textDim },
  disclaimer: { ...typography.caption, color: palette.textMuted },
  unavailable: { ...typography.body, color: palette.textMuted },
  referenceMeta: { ...typography.caption, color: palette.textDim, marginTop: spacing.lg, textAlign: 'center' },
  missingCard: { gap: spacing.xs, marginTop: spacing.lg },
  missing: { ...typography.body, color: palette.textMuted },
});
