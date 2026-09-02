import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { Button, Card, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';
import { formatCalibration, selectTargetToolCapture } from './targetToolUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'TargetTools'>;

export function TargetToolsScreen({ navigation }: Props) {
  const { activeSession, activeTarget, captures } = useShotSight();
  const capture = useMemo(
    () => selectTargetToolCapture(captures, activeTarget),
    [activeTarget, captures],
  );

  if (!activeSession || !activeTarget || !capture) {
    return (
      <Screen>
        <Text style={styles.missing}>Capture a clean target baseline, then return here to set up target tools.</Text>
      </Screen>
    );
  }

  const captureParams = { captureId: capture.id };
  return (
    <Screen>
      <Text style={styles.title}>Target tools</Text>
      <Text style={styles.subtitle}>Set persistent target references before reviewing groups or tuning image analysis. These tools use the current baseline capture.</Text>

      <Card
        accessory={<StatusPill label={activeTarget.roi ? 'Locked' : 'Full image'} tone={activeTarget.roi ? 'success' : 'neutral'} />}
        style={styles.card}
        title="Target area"
      >
        <Text style={styles.cardText}>{activeTarget.roi ? 'Analysis is bounded to your saved target region.' : 'No region of interest is set; analysis will consider the full registered image.'}</Text>
        <Button compact icon="selection-drag" label={activeTarget.roi ? 'Adjust target area' : 'Lock target area'} onPress={() => navigation.navigate('TargetRoi', captureParams)} variant="secondary" />
      </Card>

      <Card
        accessory={<StatusPill label={activeTarget.calibration ? 'Ready' : 'Needed'} tone={activeTarget.calibration ? 'success' : 'warning'} />}
        style={styles.card}
        title="Measurement scale"
      >
        <Text style={styles.cardText}>{formatCalibration(activeTarget.calibration)}</Text>
        <Button compact icon="ruler-square" label={activeTarget.calibration ? 'Update calibration' : 'Calibrate target'} onPress={() => navigation.navigate('TargetCalibration', captureParams)} variant="secondary" />
      </Card>

      <Card
        accessory={<StatusPill label={activeTarget.pointOfAim ? 'POA set' : 'Optional'} tone={activeTarget.pointOfAim ? 'success' : 'neutral'} />}
        style={styles.card}
        title="POA / desired zero"
      >
        <Text style={styles.cardText}>{activeTarget.pointOfAim ? `Point of aim saved${activeTarget.desiredZeroPoint ? ' · desired zero saved' : ''}.` : 'Place an aim reference to calculate average POI offset after calibration.'}</Text>
        <Button compact icon="crosshairs-gps" label="Set POA / POI" onPress={() => navigation.navigate('PointOfAim', captureParams)} variant="secondary" />
      </Card>

      <Card
        accessory={<StatusPill label={activeTarget.calibration && (activeTarget.pointOfAim || activeTarget.desiredZeroPoint) ? 'Ready' : 'Needs setup'} tone={activeTarget.calibration && (activeTarget.pointOfAim || activeTarget.desiredZeroPoint) ? 'success' : 'warning'} />}
        style={styles.card}
        title="Zeroing assistant"
      >
        <Text style={styles.cardText}>Turn the average POI offset into rounded windage and elevation clicks for 1/4 MOA, 1/8 MOA, 0.1 MIL, or a custom turret value.</Text>
        <Button compact icon="tune-vertical" label="Open zeroing assistant" onPress={() => navigation.navigate('ZeroingAssistant')} variant="secondary" />
      </Card>

      <Card
        accessory={<StatusPill label="Local" tone="success" />}
        style={styles.card}
        title="Shot playback & overlays"
      >
        <Text style={styles.cardText}>Replay confirmed impacts one-by-one on the clean baseline, filter by group, and switch on a density heatmap without changing stored statistics.</Text>
        <Button compact icon="play-circle-outline" label="Open shot playback" onPress={() => navigation.navigate('TargetPlayback')} variant="secondary" />
      </Card>

      <Text style={styles.reference}>Reference capture #{capture.sequenceNumber} · {capture.widthPixels} × {capture.heightPixels} px · baseline v{activeTarget.baseline?.revision ?? 1}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  card: { gap: spacing.md, marginTop: spacing.md },
  cardText: { ...typography.body, color: palette.textMuted },
  reference: { ...typography.caption, color: palette.textDim, marginTop: spacing.lg, textAlign: 'center' },
  missing: { ...typography.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
