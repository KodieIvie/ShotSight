import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { BrandHeader, Button, Card, OfflineBanner, RtspTargetView, Screen, StatusPill } from '../components';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';
import { getManualShotEligibility } from './manualShotEligibility';
import { capturesForTargetBaseline } from './rangeReviewUtils';

type Props = BottomTabScreenProps<MainTabParamList, 'Target'>;

export function TargetScreen(_props: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    activeCamera,
    activeSession,
    activeTarget,
    targets,
    captures,
    analysisCandidates,
    autoFocusNewestShot,
    busyOperation,
    analyzeCapture,
    captureCurrentTarget,
    establishBaseline,
    liveStreamUri,
    reportConnection,
  } = useShotSight();

  const runAnalysis = async (
    captureId: string,
    aggressive = false,
    automatic = false,
  ): Promise<void> => {
    try {
      const result = await analyzeCapture(captureId, aggressive ? 'aggressive' : 'standard');
      if (result.candidates.length) {
        if (automatic && !autoFocusNewestShot) {
          Alert.alert(
            `${result.candidates.length} impact${result.candidates.length === 1 ? '' : 's'} ready to review`,
            'Automatic focus is off. Use Review on the Target screen whenever you are ready to inspect and confirm candidates.',
          );
          return;
        }
        navigation.navigate('CandidateReview', {
          captureId,
          jobId: result.jobId,
          newestCandidateId: result.candidates[0]?.id,
        });
        return;
      }
      Alert.alert(
        aggressive ? 'No new impact found' : 'No new impacts found',
        aggressive
          ? 'The expanded search did not find a reviewable change. The capture remains saved locally; you can still mark a shot manually.'
          : 'This capture did not produce any reviewable new impacts. The capture remains saved locally; you can still mark a shot manually.',
      );
    } catch (error) {
      Alert.alert(
        'Impact search unavailable',
        `${safeError(error)}\n\nThe original capture is still saved locally. You can retry the search or mark a shot manually.`,
      );
    }
  };

  const capture = async (resetTarget = false): Promise<void> => {
    try {
      const replacingExistingBaseline = Boolean(activeTarget?.baseline);
      const saved = await captureCurrentTarget();
      if (resetTarget) {
        // A target without a baseline is promoted to its initial baseline by
        // captureCurrentTarget. Do not try to reuse that same capture as a
        // reset revision: target_baselines intentionally forbids it.
        if (replacingExistingBaseline) {
          await establishBaseline(saved.id, true);
        }
        Alert.alert(
          replacingExistingBaseline ? 'New clean baseline set' : 'Baseline captured',
          replacingExistingBaseline
            ? 'The original target image is saved locally and will be used for future comparisons. Target area, calibration, POA, and desired-zero references were cleared so they cannot carry over to the replacement target.'
            : 'The original target image is saved locally and is now this target\'s initial comparison baseline.',
        );
        return;
      }
      if (saved.kind !== 'baseline') {
        await runAnalysis(saved.id, false, true);
        return;
      }
      Alert.alert(
        resetTarget ? 'New clean baseline set' : saved.kind === 'baseline' ? 'Baseline captured' : `Capture #${saved.sequenceNumber} saved`,
        `${saved.widthPixels} × ${saved.heightPixels} original saved locally${saved.previewImageUri ? ' with a separate preview.' : '.'}`,
      );
    } catch (error) {
      Alert.alert('Capture failed', safeError(error));
    }
  };

  const requestReset = (): void => {
    if (!activeTarget?.baseline) {
      void capture();
      return;
    }
    Alert.alert(
      'Replace the target baseline?',
      'This takes a new high-resolution still and starts a clean comparison baseline without ending the range session. Historical captures and shot numbers stay intact; target area, calibration, POA, and desired-zero references are cleared for the new target surface.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Capture new baseline', onPress: () => void capture(true) },
      ],
    );
  };

  if (!activeCamera) {
    return (
      <Screen>
        <BrandHeader eyebrow="Target" subtitle="Your live target view appears here." />
        <OfflineBanner />
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="camera-plus-outline" size={48} />
          <Text style={styles.emptyTitle}>Connect your target camera</Text>
          <Text style={styles.emptyCopy}>Add the camera’s local IP, then stay on the isolated target-camera Wi-Fi network.</Text>
          <Button icon="camera-plus-outline" label="Add camera" onPress={() => navigation.navigate('CameraSetup')} />
        </Card>
      </Screen>
    );
  }

  if (!activeSession || !activeTarget) {
    return (
      <Screen>
        <BrandHeader eyebrow="Target" subtitle={`Camera ready: ${activeCamera.profile.name}`} />
        <OfflineBanner />
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="target-variant" size={48} />
          <Text style={styles.emptyTitle}>Start a range session</Text>
          <Text style={styles.emptyCopy}>Sessions retain captures, target baselines, shot numbers, and measurements locally.</Text>
          <Button icon="plus" label="New session" onPress={() => navigation.navigate('NewSession')} />
        </Card>
      </Screen>
    );
  }

  const latest = captures[captures.length - 1];
  const currentBaselineCaptures = capturesForTargetBaseline(
    captures,
    activeTarget.id,
    activeTarget.baseline?.revision,
  );
  const latestManualEligibility = getManualShotEligibility(latest, activeTarget, captures);
  const latestPendingCandidates = latest
    ? analysisCandidates.filter((candidate) => candidate.captureId === latest.id && candidate.state === 'pending')
    : [];
  const capturing = busyOperation === 'capturing' || busyOperation === 'analyzing';
  const targetBusy = busyOperation !== undefined;
  return (
    <Screen
      footer={
        <View style={styles.captureFooter}>
          <Button
            icon="camera-iris"
            label={busyOperation === 'analyzing' ? 'ANALYZING…' : activeTarget.baseline ? 'CAPTURE' : 'CAPTURE BASELINE'}
            loading={capturing}
            onPress={() => void capture()}
            style={styles.captureButton}
          />
        </View>
      }
      scroll={false}
    >
      <View style={styles.headerRow}>
        <BrandHeader eyebrow="Target" subtitle={`${activeSession.title} · ${activeSession.targetDistanceYards} yd`} />
        <StatusPill label={activeTarget.baseline ? `Baseline v${activeTarget.baseline.revision}` : 'No baseline'} tone={activeTarget.baseline ? 'success' : 'warning'} />
      </View>
      <View style={styles.targetContext}>
        <View style={styles.targetContextCopy}>
          <Text numberOfLines={1} style={styles.targetContextLabel}>ACTIVE TARGET</Text>
          <Text numberOfLines={1} style={styles.targetContextName}>{activeTarget.name}</Text>
        </View>
        <Button
          compact
          disabled={targetBusy}
          icon="target-variant"
          label={`Targets (${targets.length})`}
          onPress={() => navigation.navigate('TargetManager')}
          variant="secondary"
        />
      </View>
      {liveStreamUri ? (
        <RtspTargetView
          cameraName={activeCamera.profile.name}
          onConnectionChange={reportConnection}
          onFullscreen={() => navigation.navigate('LiveTarget')}
          streamUri={liveStreamUri}
        />
      ) : (
        <Card style={styles.streamError}>
          <MaterialCommunityIcons color={palette.warning} name="video-off-outline" size={30} />
          <Text style={styles.streamErrorTitle}>No playable RTSP endpoint</Text>
          <Text style={styles.streamErrorCopy}>Edit the selected profile with a main stream URL, then return here to view the target.</Text>
        </Card>
      )}

      <View style={styles.targetActions}>
        <Button compact disabled={targetBusy} icon="backup-restore" label={activeTarget.baseline ? 'New baseline' : 'Capture baseline'} onPress={requestReset} variant="secondary" />
        <Button
          compact
          disabled={!latest || targetBusy}
          icon="ruler-square"
          label="Tools"
          onPress={() => navigation.navigate('TargetTools')}
          variant="ghost"
        />
        <Button
          compact
          disabled={!activeTarget.baseline || currentBaselineCaptures.length < 2 || targetBusy}
          icon="compare"
          label="Compare"
          onPress={() => navigation.navigate('CaptureCompare')}
          variant="ghost"
        />
        <Button
          compact
          disabled={!latest || !activeTarget.baseline || latest.id === activeTarget.baseline.captureId || targetBusy}
          icon="image-search-outline"
          label="Detect"
          onPress={() => latest && void runAnalysis(latest.id)}
          variant="ghost"
        />
        <Button
          compact
          disabled={!latest || !activeTarget.baseline || latest.id === activeTarget.baseline.captureId || targetBusy}
          icon="crosshairs-gps"
          label="Search hard"
          onPress={() => latest && void runAnalysis(latest.id, true)}
          variant="ghost"
        />
        <Button
          compact
          disabled={!latestPendingCandidates.length || targetBusy}
          icon="check-decagram-outline"
          label={latestPendingCandidates.length ? `Review (${latestPendingCandidates.length})` : 'Review'}
          onPress={() => latest && navigation.navigate('CandidateReview', {
            captureId: latest.id,
            newestCandidateId: latestPendingCandidates[0]?.id,
          })}
          variant="ghost"
        />
        <Button
          compact
          disabled={!latest || targetBusy}
          icon="image-outline"
          label="Details"
          onPress={() => latest && navigation.navigate('CaptureDetail', { captureId: latest.id })}
          variant="ghost"
        />
        <Button
          compact
          disabled={!latest || !latestManualEligibility.eligible || targetBusy}
          icon="map-marker-plus-outline"
          label={latestManualEligibility.eligible ? 'Add shot' : 'Register to add shot'}
          onPress={() => latest && navigation.navigate('ManualShot', { captureId: latest.id })}
          variant="ghost"
        />
      </View>

      <View style={styles.timelineHeader}>
        <Text style={styles.timelineTitle}>Recent captures</Text>
        <Text style={styles.timelineMeta}>{captures.length} total</Text>
      </View>
      {captures.length ? (
        <ScrollView contentContainerStyle={styles.timeline} horizontal showsHorizontalScrollIndicator={false}>
          {[...captures].reverse().slice(0, 8).map((captureItem) => (
            <Pressable
              key={captureItem.id}
              onPress={() => navigation.navigate('CaptureDetail', { captureId: captureItem.id })}
              style={styles.thumbnail}
            >
              {captureItem.previewImageUri || captureItem.originalImageUri ? (
                <Image source={{ uri: captureItem.previewImageUri ?? captureItem.originalImageUri }} style={styles.thumbnailImage} />
              ) : null}
              <View style={styles.thumbnailLabel}>
                <Text style={styles.thumbnailText}>#{captureItem.sequenceNumber}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.emptyTimeline}>Capture a clean baseline before your first string.</Text>
      )}
    </Screen>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  targetContext: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.sm },
  targetContextCopy: { flex: 1, minWidth: 0 },
  targetContextLabel: { ...typography.caption, color: palette.textDim, letterSpacing: 0.8 },
  targetContextName: { ...typography.label, color: palette.text, marginTop: spacing.xxs },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
  streamError: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  streamErrorTitle: { ...typography.heading, color: palette.text },
  streamErrorCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
  targetActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  timelineHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xs },
  timelineTitle: { ...typography.label, color: palette.text },
  timelineMeta: { ...typography.caption, color: palette.textDim, marginLeft: 'auto' },
  timeline: { gap: spacing.sm, paddingRight: spacing.md },
  thumbnail: {
    width: 88,
    height: 68,
    overflow: 'hidden',
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceRaised,
    borderWidth: 1,
    borderColor: palette.border,
  },
  thumbnailImage: { width: '100%', height: '100%' },
  thumbnailLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.62)' },
  thumbnailText: { ...typography.caption, color: palette.white, textAlign: 'center' },
  emptyTimeline: { ...typography.caption, color: palette.textDim },
  captureFooter: { flexDirection: 'row' },
  captureButton: { flex: 1, minHeight: 60 },
});
