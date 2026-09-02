import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RemotePhonePairingSession, RemotePhoneTelemetry } from '../../domain';
import { mockRemotePhoneSessionService } from '../../infrastructure/remotePhone';
import { Button, Card, OfflineBanner, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TargetCameraMode'>;

export function TargetCameraModeScreen(_props: Props) {
  const [session, setSession] = useState<RemotePhonePairingSession>();
  const [telemetry, setTelemetry] = useState<RemotePhoneTelemetry>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!session) return undefined;
    const interval = setInterval(() => {
      const latestSession = mockRemotePhoneSessionService.getSession(session.id);
      setSession(latestSession);
      setTelemetry(mockRemotePhoneSessionService.getTelemetry(session.id));
      const startedAt = telemetry?.sessionStartedAt ? Date.parse(telemetry.sessionStartedAt) : Date.now();
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [session, telemetry?.sessionStartedAt]);

  const start = (): void => {
    const next = mockRemotePhoneSessionService.startTargetCamera('Target Phone');
    setSession(next);
    setTelemetry(mockRemotePhoneSessionService.getTelemetry(next.id));
    setElapsedSeconds(0);
  };

  const stop = (): void => {
    if (!session) return;
    const stopped = mockRemotePhoneSessionService.stopTargetCamera(session.id);
    setSession(stopped);
    setTelemetry(stopped ? mockRemotePhoneSessionService.getTelemetry(stopped.id) : undefined);
  };

  const captures = session ? mockRemotePhoneSessionService.listCaptures(session.id) : [];
  const connected = session?.state === 'connected';

  return (
    <Screen>
      <Text style={styles.kicker}>SHOTSiGHT</Text>
      <Text style={styles.title}>Target Camera</Text>
      <Text style={styles.subtitle}>Run this phone near the target as a remote camera endpoint.</Text>
      <OfflineBanner />

      {session && session.state !== 'stopped' ? (
        <>
          <Card style={styles.section} title="Pairing">
            <View style={styles.codePanel}>
              <Text style={styles.code}>{session.pairingCode}</Text>
              <StatusPill label={connected ? 'Connected to viewer' : 'Ready'} tone={connected ? 'success' : 'info'} />
            </View>
            <Text style={styles.note}>Mock QR payload is ready for the future scanner path:</Text>
            <Text numberOfLines={3} style={styles.payload}>{session.qrPayload}</Text>
          </Card>

          <Card style={styles.section} title="Status">
            <StatusMetric icon="battery-70" label="Battery" value={telemetry?.batteryPercent !== undefined ? `${telemetry.batteryPercent}%` : 'Unknown'} />
            <StatusMetric icon="wifi" label="Network" value={`${telemetry?.network?.type ?? 'unknown'} / ${telemetry?.network?.quality ?? 'unknown'}`} />
            <StatusMetric icon="camera-outline" label="Current camera" value={telemetry?.activeCameraLabel ?? 'Rear main camera'} />
            <StatusMetric icon="timer-outline" label="Session time" value={formatDuration(elapsedSeconds)} />
            <StatusMetric icon="database-arrow-up-outline" label="Data used" value={formatBytes(telemetry?.uploadedBytes)} />
            <StatusMetric icon="cloud-upload-outline" label="Queued captures" value={String(captures.length)} />
          </Card>

          <Card style={styles.section} title="Controls">
            <View style={styles.controlRow}>
              <Button compact icon="eye-outline" label="Preview" onPress={() => undefined} style={styles.flexButton} variant="secondary" />
              <Button compact icon="camera-control" label="Auto focus" onPress={() => undefined} style={styles.flexButton} variant="ghost" />
            </View>
            <View style={styles.controlRow}>
              <Button compact icon="cellphone-wireless" label="Rear camera" onPress={() => undefined} style={styles.flexButton} variant="ghost" />
              <Button compact icon="crosshairs-gps" label="Photo mode" onPress={() => undefined} style={styles.flexButton} variant="ghost" />
            </View>
            <Text style={styles.note}>Camera controls are placeholders until the native camera source is added.</Text>
          </Card>

          <Button icon="stop" label="Stop target camera" onPress={stop} variant="danger" />
        </>
      ) : (
        <Card style={styles.section} title="Start target camera">
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons color={palette.accent} name="cellphone-wireless" size={48} />
          </View>
          <Text style={styles.copy}>This starts a local mock target-camera session with a short pairing code. The production version will keep the phone awake, capture full-resolution stills, and queue uploads until the viewer confirms receipt.</Text>
          <Button icon="play" label="Start Target Camera" onPress={start} />
        </Card>
      )}
    </Screen>
  );
}

function StatusMetric({ icon, label, value }: {
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.metricRow}>
      <MaterialCommunityIcons color={palette.textMuted} name={icon} size={20} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '0 KB';
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  kicker: { ...typography.label, color: palette.accent, letterSpacing: 0 },
  title: { ...typography.title, color: palette.text, marginTop: spacing.xxs },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  section: { gap: spacing.md, marginTop: spacing.md },
  heroIcon: { alignItems: 'center', paddingTop: spacing.sm },
  copy: { ...typography.body, color: palette.textMuted },
  note: { ...typography.caption, color: palette.textDim },
  codePanel: { alignItems: 'center', gap: spacing.sm },
  code: { color: palette.text, fontSize: 42, lineHeight: 48, fontWeight: '800' },
  payload: {
    ...typography.caption,
    color: palette.textMuted,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.ink,
  },
  metricRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  metricLabel: { ...typography.label, color: palette.textMuted, width: 112 },
  metricValue: { ...typography.caption, color: palette.text, flex: 1, textAlign: 'right' },
  controlRow: { flexDirection: 'row', gap: spacing.sm },
  flexButton: { flex: 1 },
});
