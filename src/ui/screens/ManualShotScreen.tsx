import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { Button, Screen } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';
import { getManualShotEligibility } from './manualShotEligibility';

type Props = NativeStackScreenProps<RootStackParamList, 'ManualShot'>;

interface CandidatePoint { readonly x: number; readonly y: number }

export function ManualShotScreen({ navigation, route }: Props) {
  const { captures, activeTarget, nextShotNumber, busyOperation, addManualShot } = useShotSight();
  const capture = captures.find((item) => item.id === route.params.captureId);
  const [candidate, setCandidate] = useState<CandidatePoint>();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const manualEligibility = getManualShotEligibility(capture, activeTarget, captures);

  if (!capture) {
    return <Screen><Text style={styles.missing}>This capture is not available in the active session.</Text></Screen>;
  }

  if (!manualEligibility.eligible) {
    return <Screen><Text style={styles.missing}>{manualEligibility.reason}</Text></Screen>;
  }

  const confirm = async (): Promise<void> => {
    if (!candidate) return;
    try {
      const shot = await addManualShot(capture.id, candidate);
      Alert.alert(`Shot #${shot.number} confirmed`, shot.isColdBore ? 'Marked as the cold-bore shot.' : 'Saved locally with this capture.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not add shot', safeError(error));
    }
  };

  return (
    <Screen footer={<Button disabled={!candidate} icon="check-circle-outline" label={candidate ? `Confirm new shot #${nextShotNumber}` : 'Tap the impact location'} loading={busyOperation === 'updating'} onPress={() => void confirm()} />}>
      <Text style={styles.title}>Mark a shot</Text>
      <Text style={styles.subtitle}>Tap the center of the impact. The marker is stored in original-image coordinates, not the preview’s screen pixels.</Text>
      <View style={[styles.targetFrame, { aspectRatio: capture.widthPixels / capture.heightPixels }]}>
        <Pressable
          onLayout={(event) => setLayout(event.nativeEvent.layout)}
          onPress={(event) => setCandidate({ x: event.nativeEvent.locationX / layout.width, y: event.nativeEvent.locationY / layout.height })}
          style={styles.targetPressable}
        >
          <Image resizeMode="stretch" source={{ uri: capture.previewImageUri ?? capture.originalImageUri }} style={styles.image} />
          {candidate ? <View pointerEvents="none" style={[styles.marker, { left: `${candidate.x * 100}%`, top: `${candidate.y * 100}%` }]}><Text style={styles.markerText}>{nextShotNumber}</Text></View> : null}
        </Pressable>
      </View>
      <Text style={styles.hint}>{candidate ? 'Review the marker, then confirm it. You can later flag a flyer without deleting the shot.' : 'Use the full image rather than a screen capture for the most reliable marker position.'}</Text>
    </Screen>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  targetFrame: { width: '100%', overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.black },
  targetPressable: { flex: 1 },
  image: { width: '100%', height: '100%' },
  marker: { position: 'absolute', width: 36, height: 36, marginLeft: -18, marginTop: -18, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 3, borderColor: palette.accent, backgroundColor: 'rgba(16,12,4,0.72)' },
  markerText: { ...typography.label, color: palette.accent },
  hint: { ...typography.caption, color: palette.textMuted, marginTop: spacing.md, textAlign: 'center' },
  missing: { ...typography.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
