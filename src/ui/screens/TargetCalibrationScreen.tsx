import * as Crypto from 'expo-crypto';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import {
  createKnownLineCalibration,
  createManualCalibration,
  type TargetCalibration,
} from '../../domain';
import {
  Button,
  Card,
  Field,
  Screen,
  TargetImageCanvas,
  normalizedToPoint,
  type NormalizedPoint,
} from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';
import { formatCalibration, selectTargetToolCapture } from './targetToolUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'TargetCalibration'>;
type CalibrationMode = 'known-line' | 'manual';

export function TargetCalibrationScreen({ navigation, route }: Props) {
  const { activeTarget, captures, busyOperation, saveCalibration } = useShotSight();
  const capture = useMemo(
    () => selectTargetToolCapture(captures, activeTarget, route.params?.captureId),
    [activeTarget, captures, route.params?.captureId],
  );
  const [mode, setMode] = useState<CalibrationMode>('known-line');
  const [linePoints, setLinePoints] = useState<readonly NormalizedPoint[]>([]);
  const [knownLength, setKnownLength] = useState('1');
  const [pixelsPerInchX, setPixelsPerInchX] = useState('');
  const [pixelsPerInchY, setPixelsPerInchY] = useState('');

  if (!activeTarget || !capture) {
    return (
      <Screen>
        <Text style={styles.missing}>Capture a target image before setting its measurement scale.</Text>
      </Screen>
    );
  }

  const addLinePoint = (point: NormalizedPoint): void => {
    setLinePoints((current) => current.length >= 2 ? [point] : [...current, point]);
  };

  const save = async (): Promise<void> => {
    try {
      const identity = {
        id: Crypto.randomUUID(),
        targetId: activeTarget.id,
        calibratedAt: new Date().toISOString(),
      };
      let calibration: TargetCalibration;
      if (mode === 'manual') {
        const x = Number(pixelsPerInchX);
        const y = pixelsPerInchY.trim() ? Number(pixelsPerInchY) : x;
        calibration = createManualCalibration(identity, x, y);
      } else {
        const inches = Number(knownLength);
        if (linePoints.length !== 2) {
          throw new Error('Tap both ends of a known-length reference line.');
        }
        calibration = createKnownLineCalibration(
          identity,
          normalizedToPoint(linePoints[0], capture.widthPixels, capture.heightPixels),
          normalizedToPoint(linePoints[1], capture.widthPixels, capture.heightPixels),
          inches,
        );
      }
      await saveCalibration(calibration);
      Alert.alert('Target calibrated', `${calibration.pixelsPerInchX.toFixed(1)} px/in saved for measurements.`);
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not calibrate target', safeError(error));
    }
  };

  const lineReady = linePoints.length === 2 && Number(knownLength) > 0;
  const manualReady = Number(pixelsPerInchX) > 0 && (!pixelsPerInchY.trim() || Number(pixelsPerInchY) > 0);
  const canSave = mode === 'known-line' ? lineReady : manualReady;

  return (
    <Screen footer={<Button disabled={!canSave} icon="ruler-square" label="Save calibration" loading={busyOperation === 'updating'} onPress={() => void save()} />}>
      <Text style={styles.title}>Calibrate target</Text>
      <Text style={styles.subtitle}>Use a printed ruler, grid spacing, or another feature with a known physical length. Measurements use the original camera pixels.</Text>
      <View style={styles.modeRow}>
        <Button compact icon="ruler" label="Known line" onPress={() => setMode('known-line')} style={styles.modeButton} variant={mode === 'known-line' ? 'primary' : 'secondary'} />
        <Button compact icon="tune-vertical" label="Manual scale" onPress={() => setMode('manual')} style={styles.modeButton} variant={mode === 'manual' ? 'primary' : 'secondary'} />
      </View>

      {mode === 'known-line' ? (
        <>
          <Text style={styles.instruction}>{linePoints.length === 0 ? 'Tap the first end of the reference line.' : linePoints.length === 1 ? 'Tap the other end of the reference line.' : 'Reference line selected. Tap again to start over.'}</Text>
          <TargetImageCanvas
            aspectRatio={capture.widthPixels / capture.heightPixels}
            imageUri={capture.previewImageUri ?? capture.originalImageUri}
            interactionMode="tap"
            markers={linePoints.map((point, index) => ({ point, label: String(index + 1), color: palette.info }))}
            onPointPress={addLinePoint}
            style={styles.canvas}
          />
          <Field
            keyboardType="decimal-pad"
            label="Known line length (inches)"
            onChangeText={setKnownLength}
            placeholder="e.g. 1"
            value={knownLength}
          />
          {linePoints.length ? <Button compact icon="restore" label="Clear line" onPress={() => setLinePoints([])} variant="ghost" /> : null}
        </>
      ) : (
        <Card style={styles.manualCard} title="Enter a trusted scale">
          <Text style={styles.manualText}>Use this only when a reliable pixels-per-inch value is already known for this target and capture setup.</Text>
          <Field keyboardType="decimal-pad" label="Pixels per inch — horizontal" onChangeText={setPixelsPerInchX} placeholder="e.g. 220" value={pixelsPerInchX} />
          <Field keyboardType="decimal-pad" hint="Leave blank to use the horizontal value." label="Pixels per inch — vertical" onChangeText={setPixelsPerInchY} placeholder="Optional" value={pixelsPerInchY} />
        </Card>
      )}

      <Card style={styles.current} title="Current scale">
        <Text style={styles.currentText}>{formatCalibration(activeTarget.calibration)}</Text>
        <Text style={styles.currentMeta}>Reference: capture #{capture.sequenceNumber} · {capture.widthPixels} × {capture.heightPixels} px</Text>
      </Card>
    </Screen>
  );
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
  manualCard: { gap: spacing.md },
  manualText: { ...typography.body, color: palette.textMuted },
  current: { gap: spacing.xs, marginTop: spacing.lg },
  currentText: { ...typography.body, color: palette.text },
  currentMeta: { ...typography.caption, color: palette.textDim },
  missing: { ...typography.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
