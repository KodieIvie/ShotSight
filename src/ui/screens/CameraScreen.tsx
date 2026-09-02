import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { CameraProfile } from '../../domain';
import { BrandHeader, Button, Card, OfflineBanner, Screen, StatusPill } from '../components';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';

type Props = BottomTabScreenProps<MainTabParamList, 'Camera'>;

export function CameraScreen(_props: Props) {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeCamera, cameras, busyOperation, removeCamera, selectCamera } = useShotSight();

  const remove = (camera: CameraProfile): void => {
    Alert.alert(
      `Remove ${camera.name}?`,
      'This removes the saved local profile and its secured camera login. Sessions using it must be removed first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeCamera(camera.id).catch((error) => Alert.alert('Could not remove camera', safeError(error)));
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <BrandHeader eyebrow="Camera" subtitle="Direct camera profiles stored only on this phone." />
      <OfflineBanner />

      <View style={styles.actions}>
        <Button icon="plus" label="Add camera" onPress={() => rootNavigation.navigate('CameraSetup')} style={styles.addButton} />
        <Button icon="stethoscope" label="Diagnostics" onPress={() => rootNavigation.navigate('CameraDiagnostics')} variant="secondary" />
      </View>
      <Button
        compact
        icon="qrcode-scan"
        label="Target system setup"
        onPress={() => rootNavigation.navigate('TargetSystemSetup')}
        style={styles.systemSetup}
        variant="ghost"
      />

      {cameras.length === 0 ? (
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="camera-wireless-outline" size={44} />
          <Text style={styles.emptyTitle}>No target camera yet</Text>
          <Text style={styles.emptyCopy}>Start with the RLC-520A preset or enter a standards-based RTSP camera manually.</Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {cameras.map((camera) => {
            const active = activeCamera?.profile.id === camera.id;
            return (
              <Pressable key={camera.id} onPress={() => void selectCamera(camera.id)} style={[styles.cameraCard, active && styles.cameraCardActive]}>
                <View style={styles.cameraTop}>
                  <View style={styles.cameraIcon}>
                    <MaterialCommunityIcons color={active ? palette.accent : palette.textMuted} name="video-wireless-outline" size={24} />
                  </View>
                  <View style={styles.cameraCopy}>
                    <Text numberOfLines={1} style={styles.cameraName}>{camera.name}</Text>
                    <Text numberOfLines={1} style={styles.cameraMeta}>{camera.host} · {camera.model ?? 'Generic RTSP'}</Text>
                  </View>
                  <StatusPill label={active ? 'Selected' : 'Saved'} tone={active ? 'success' : 'neutral'} />
                </View>
                <View style={styles.capabilities}>
                  <Capability enabled={camera.capabilities.rtsp} label="RTSP" />
                  <Capability enabled={camera.capabilities.httpSnapshot} label="High-res still" />
                  <Capability enabled={camera.onvif.enabled} label="ONVIF" />
                  <Text style={styles.distance}>{camera.targetDistanceYards ? `${camera.targetDistanceYards} yd` : 'Distance unset'}</Text>
                </View>
                <View style={styles.cardActions}>
                  {!active ? <Button compact icon="check" label="Use this" onPress={() => void selectCamera(camera.id)} variant="secondary" /> : null}
                  <Button compact icon="delete-outline" label="Remove" onPress={() => remove(camera)} variant="ghost" />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {busyOperation === 'updating' ? <Text style={styles.working}>Updating local camera settings…</Text> : null}
    </Screen>
  );
}

function Capability({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <View style={styles.capability}>
      <MaterialCommunityIcons color={enabled ? palette.success : palette.textDim} name={enabled ? 'check-circle' : 'minus-circle-outline'} size={14} />
      <Text style={[styles.capabilityText, !enabled && styles.capabilityMuted]}>{label}</Text>
    </View>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  addButton: { flex: 1 },
  systemSetup: { alignSelf: 'flex-start', marginTop: spacing.sm },
  empty: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  cameraCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  cameraCardActive: { borderColor: '#79602A', backgroundColor: '#1D1B14' },
  cameraTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cameraIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: palette.ink,
  },
  cameraCopy: { flex: 1 },
  cameraName: { ...typography.label, color: palette.text, fontSize: 16 },
  cameraMeta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  capabilities: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  capability: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  capabilityText: { ...typography.caption, color: palette.textMuted },
  capabilityMuted: { color: palette.textDim },
  distance: { ...typography.caption, color: palette.textDim, marginLeft: 'auto' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs },
  working: { ...typography.caption, color: palette.textDim, textAlign: 'center', marginTop: spacing.md },
});
