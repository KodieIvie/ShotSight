import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { TargetRoi } from '../../domain';
import { Button, Card, Screen, TargetImageCanvas, type NormalizedRectangle } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';
import { normalizeRectangleRoi, selectTargetToolCapture } from './targetToolUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'TargetRoi'>;

const MINIMUM_NORMALIZED_SIZE = 0.01;

export function TargetRoiScreen({ navigation, route }: Props) {
  const {
    activeTarget,
    captures,
    busyOperation,
    saveTargetRoi,
  } = useShotSight();
  const capture = useMemo(
    () => selectTargetToolCapture(captures, activeTarget, route.params?.captureId),
    [activeTarget, captures, route.params?.captureId],
  );
  const [selection, setSelection] = useState<NormalizedRectangle>();

  useEffect(() => {
    if (!capture) {
      setSelection(undefined);
      return;
    }
    setSelection(normalizeRectangleRoi(activeTarget?.roi, capture));
  }, [activeTarget?.id, activeTarget?.roi, capture]);

  if (!activeTarget || !capture) {
    return (
      <Screen>
        <Text style={styles.missing}>Capture a clean target image before locking its target area.</Text>
      </Screen>
    );
  }

  const save = async (): Promise<void> => {
    if (!selection || selection.width < MINIMUM_NORMALIZED_SIZE || selection.height < MINIMUM_NORMALIZED_SIZE) {
      Alert.alert('Select more of the target', 'Drag a rectangle around the usable target face before saving the region of interest.');
      return;
    }
    const roi: TargetRoi = Object.freeze({
      kind: 'rectangle',
      rect: Object.freeze({
        x: selection.x * capture.widthPixels,
        y: selection.y * capture.heightPixels,
        width: selection.width * capture.widthPixels,
        height: selection.height * capture.heightPixels,
      }),
    });
    try {
      await saveTargetRoi(roi);
      Alert.alert('Target area locked', 'Future image analysis can ignore everything outside this region.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not save target area', safeError(error));
    }
  };

  const reset = (): void => {
    void saveTargetRoi(undefined)
      .then(() => {
        setSelection(undefined);
        Alert.alert('Target area cleared', 'Analysis will use the full registered image until you lock a new area.');
      })
      .catch((error) => Alert.alert('Could not clear target area', safeError(error)));
  };

  return (
    <Screen footer={<Button disabled={!selection} icon="check-circle-outline" label="Save target area" loading={busyOperation === 'updating'} onPress={() => void save()} />}>
      <Text style={styles.title}>Lock target area</Text>
      <Text style={styles.subtitle}>Drag tightly around the paper or steel face. The selection is saved in original-image pixels, so it remains useful for full-resolution analysis.</Text>
      <TargetImageCanvas
        aspectRatio={capture.widthPixels / capture.heightPixels}
        imageUri={capture.previewImageUri ?? capture.originalImageUri}
        interactionMode="rectangle"
        onRectangleChange={setSelection}
        rectangle={selection}
        style={styles.canvas}
      />
      <Card style={styles.info} title="How it is used">
        <Text style={styles.infoText}>The ROI is a processing boundary, not an image crop. Original captures remain intact and reviewable.</Text>
        <Text style={styles.infoMeta}>Reference: capture #{capture.sequenceNumber} · {capture.widthPixels} × {capture.heightPixels} px</Text>
      </Card>
      {activeTarget.roi ? (
        <Button compact icon="selection-remove" label="Use full image instead" loading={busyOperation === 'updating'} onPress={reset} variant="ghost" />
      ) : null}
    </Screen>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  canvas: { marginBottom: spacing.md },
  info: { gap: spacing.sm },
  infoText: { ...typography.body, color: palette.textMuted },
  infoMeta: { ...typography.caption, color: palette.textDim },
  missing: { ...typography.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
