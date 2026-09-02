import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { Button, Card, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';
import { getManualShotEligibility } from './manualShotEligibility';

type Props = NativeStackScreenProps<RootStackParamList, 'CaptureDetail'>;

export function CaptureDetailScreen({ navigation, route }: Props) {
  const {
    captures,
    activeTarget,
    analysisCandidates,
    busyOperation,
    analyzeCapture,
    establishBaseline,
  } = useShotSight();
  const capture = captures.find((item) => item.id === route.params.captureId);

  if (!capture) {
    return <Screen><Text style={styles.missing}>This capture is not available in the active session.</Text></Screen>;
  }

  const setBaseline = (): void => {
    Alert.alert('Use this as the comparison baseline?', 'It replaces the current clean baseline without creating a new range session. Existing shot numbers and history are preserved, while target area, calibration, POA, and desired-zero references are cleared for the new coordinate space.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set baseline',
        onPress: () => void establishBaseline(capture.id, Boolean(activeTarget?.baseline)).then(() => Alert.alert('Baseline updated', 'Future captures will compare to this target reference. Reopen Target tools before measuring or calculating a zero.')).catch((error) => Alert.alert('Could not set baseline', safeError(error))),
      },
    ]);
  };

  const runAnalysis = async (aggressive = false): Promise<void> => {
    try {
      const result = await analyzeCapture(capture.id, aggressive ? 'aggressive' : 'standard');
      if (result.candidates.length) {
        navigation.navigate('CandidateReview', {
          captureId: capture.id,
          jobId: result.jobId,
          newestCandidateId: result.candidates[0]?.id,
        });
        return;
      }
      Alert.alert(
        aggressive ? 'No new impact found' : 'No new impacts found',
        aggressive
          ? 'The expanded search did not find a reviewable change. This capture remains saved locally.'
          : 'This capture did not produce any reviewable new impacts. It remains saved locally.',
      );
    } catch (error) {
      Alert.alert(
        'Impact search unavailable',
        `${safeError(error)}\n\nThe original capture is still saved locally. You can retry the search or mark a shot manually.`,
      );
    }
  };

  const pendingCandidates = analysisCandidates.filter(
    (candidate) => candidate.captureId === capture.id && candidate.state === 'pending',
  );
  const canAnalyze = Boolean(activeTarget?.baseline)
    && capture.id !== activeTarget?.baseline?.captureId;
  const manualEligibility = getManualShotEligibility(capture, activeTarget, captures);
  const isBusy = busyOperation !== undefined;

  return (
    <Screen>
      <Text style={styles.title}>Capture #{capture.sequenceNumber}</Text>
      <Text style={styles.subtitle}>{formatDateTime(capture.capturedAt)} · {capture.widthPixels} × {capture.heightPixels}</Text>
      <View style={styles.imageFrame}>
        <Image resizeMode="contain" source={{ uri: capture.originalImageUri }} style={styles.image} />
      </View>
      <Card style={styles.section} title="Capture record">
        <Info icon="image-outline" label="Source" value={capture.cameraMetadata.source === 'http-snapshot' ? 'Native camera still' : capture.cameraMetadata.source} />
        <Info icon="timer-outline" label="Snapshot request" value={capture.cameraMetadata.latencyMs ? `${capture.cameraMetadata.latencyMs} ms` : 'Not measured'} />
        <Info icon="image-size-select-large" label="Original" value={capture.originalImageUri ? 'Retained locally' : 'Missing'} />
        <Info icon="image-outline" label="Preview" value={capture.previewImageUri ? 'Separate responsive preview' : 'Not available'} />
        <View style={styles.analysisRow}><Text style={styles.infoLabel}>Analysis</Text><StatusPill label={capture.analysisStatus.replace('-', ' ')} tone="neutral" /></View>
      </Card>
      <View style={styles.actions}>
        <Button disabled={isBusy || !manualEligibility.eligible} icon="map-marker-plus-outline" label={manualEligibility.eligible ? 'Mark manual shot' : 'Register to mark'} onPress={() => navigation.navigate('ManualShot', { captureId: capture.id })} style={styles.action} />
        <Button disabled={isBusy} icon="backup-restore" label="Set as baseline" loading={busyOperation === 'updating'} onPress={setBaseline} style={styles.action} variant="secondary" />
      </View>
      <View style={styles.actions}>
        <Button
          disabled={!canAnalyze || isBusy}
          icon="image-search-outline"
          label="Detect impacts"
          loading={busyOperation === 'analyzing'}
          onPress={() => void runAnalysis()}
          style={styles.action}
          variant="secondary"
        />
        <Button
          disabled={!canAnalyze || isBusy}
          icon="crosshairs-gps"
          label="Search hard"
          loading={busyOperation === 'analyzing'}
          onPress={() => void runAnalysis(true)}
          style={styles.action}
          variant="ghost"
        />
      </View>
      <View style={styles.actions}>
        <Button
          disabled={!pendingCandidates.length || isBusy}
          icon="check-decagram-outline"
          label={pendingCandidates.length ? `Review ${pendingCandidates.length} impact${pendingCandidates.length === 1 ? '' : 's'}` : 'No impacts to review'}
          onPress={() => navigation.navigate('CandidateReview', {
            captureId: capture.id,
            newestCandidateId: pendingCandidates[0]?.id,
          })}
          style={styles.reviewAction}
          variant="ghost"
        />
      </View>
      {!manualEligibility.eligible ? <Text style={styles.manualNotice}>{manualEligibility.reason}</Text> : null}
      <View style={styles.note}><MaterialCommunityIcons color={palette.textDim} name="information-outline" size={18} /><Text style={styles.noteText}>The original stays untouched. Detection proposes candidates for review; it never adds a numbered shot without confirmation.</Text></View>
    </Screen>
  );
}

function Info({ icon, label, value }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; value: string }) {
  return <View style={styles.info}><MaterialCommunityIcons color={palette.textMuted} name={icon} size={19} /><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  imageFrame: { aspectRatio: 4 / 3, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.black },
  image: { width: '100%', height: '100%' },
  section: { marginTop: spacing.md, gap: spacing.sm },
  info: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoLabel: { ...typography.label, color: palette.textMuted, width: 105 },
  infoValue: { ...typography.caption, color: palette.text, flex: 1, textAlign: 'right' },
  analysisRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  reviewAction: { flex: 1 },
  manualNotice: { ...typography.caption, color: palette.warning, marginTop: spacing.sm },
  note: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start', marginTop: spacing.lg },
  noteText: { ...typography.caption, color: palette.textDim, flex: 1 },
  missing: { ...typography.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
