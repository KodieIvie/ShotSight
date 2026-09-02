import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import type { RemotePhoneCommand, RemotePhonePairingSession, RemotePhoneTelemetry } from '../../domain';
import { mockRemotePhoneSessionService } from '../../infrastructure/remotePhone';
import { Button, Card, Field, OfflineBanner, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'RemotePhoneConnect'>;

export function RemotePhoneConnectScreen(_props: Props) {
  const [pairingCode, setPairingCode] = useState('');
  const [session, setSession] = useState<RemotePhonePairingSession>();
  const [telemetry, setTelemetry] = useState<RemotePhoneTelemetry>();
  const [lastCommand, setLastCommand] = useState<RemotePhoneCommand>();

  const connect = (): void => {
    try {
      const paired = mockRemotePhoneSessionService.pairViewer(pairingCode);
      setSession(paired);
      setTelemetry(mockRemotePhoneSessionService.getTelemetry(paired.id));
      setPairingCode('');
    } catch (error) {
      Alert.alert('Could not connect target phone', safeError(error));
    }
  };

  const sendPreviewRequest = (): void => {
    if (!session) return;
    try {
      setLastCommand(mockRemotePhoneSessionService.requestPreview(session.id));
      setTelemetry(mockRemotePhoneSessionService.getTelemetry(session.id));
    } catch (error) {
      Alert.alert('Preview request failed', safeError(error));
    }
  };

  const checkTarget = (): void => {
    if (!session) return;
    try {
      setLastCommand(mockRemotePhoneSessionService.requestCapture(session.id));
      setTelemetry(mockRemotePhoneSessionService.getTelemetry(session.id));
    } catch (error) {
      Alert.alert('Capture request failed', safeError(error));
    }
  };

  const ping = (): void => {
    if (!session) return;
    try {
      setLastCommand(mockRemotePhoneSessionService.ping(session.id));
      setTelemetry(mockRemotePhoneSessionService.getTelemetry(session.id));
    } catch (error) {
      Alert.alert('Ping failed', safeError(error));
    }
  };

  const disconnect = (): void => {
    if (!session) return;
    try {
      setLastCommand(mockRemotePhoneSessionService.disconnect(session.id));
      setTelemetry(mockRemotePhoneSessionService.getTelemetry(session.id));
      setSession(undefined);
    } catch (error) {
      Alert.alert('Disconnect failed', safeError(error));
    }
  };

  const captures = session ? mockRemotePhoneSessionService.listCaptures(session.id) : [];

  return (
    <Screen>
      <Text style={styles.title}>Connect target phone</Text>
      <Text style={styles.subtitle}>Viewer mode for pairing another phone as the remote target camera.</Text>
      <OfflineBanner />

      {session ? (
        <>
          <Card style={styles.section} title="Target phone">
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>{session.targetLabel}</Text>
              <StatusPill label="Connected" tone="success" />
            </View>
            <TelemetryGrid telemetry={telemetry} />
          </Card>

          <Card style={styles.section} title="Viewer controls">
            <Button icon="crosshairs-gps" label="Check target" onPress={checkTarget} />
            <View style={styles.commandRow}>
              <Button compact icon="eye-outline" label="Preview" onPress={sendPreviewRequest} style={styles.flexButton} variant="secondary" />
              <Button compact icon="access-point-network" label="Ping" onPress={ping} style={styles.flexButton} variant="ghost" />
            </View>
            <Text style={styles.note}>This mock path exercises pairing and commands only. Real high-resolution capture will be wired through the target phone camera source next.</Text>
          </Card>

          <Card style={styles.section} title="Last command">
            {lastCommand ? (
              <>
                <CommandRow label="Type" value={lastCommand.type} />
                <CommandRow label="Status" value={lastCommand.status} />
                <CommandRow label="Capture" value={lastCommand.captureId ?? 'None'} />
              </>
            ) : (
              <Text style={styles.note}>No command sent yet.</Text>
            )}
          </Card>

          <Card style={styles.section} title="Queued captures">
            {captures.length ? captures.slice(-3).map((capture) => (
              <View key={capture.id} style={styles.captureRow}>
                <MaterialCommunityIcons color={palette.accent} name="camera-outline" size={20} />
                <View style={styles.captureCopy}>
                  <Text style={styles.captureTitle}>Capture {capture.sequenceNumber}</Text>
                  <Text style={styles.note}>{formatBytes(capture.byteSize)} queued for viewer receipt</Text>
                </View>
                <StatusPill label={capture.status} tone="warning" />
              </View>
            )) : (
              <Text style={styles.note}>No captures requested in this mock session.</Text>
            )}
          </Card>

          <Button icon="stop" label="Disconnect" onPress={disconnect} variant="danger" />
        </>
      ) : (
        <Card style={styles.section} title="Pair with target phone">
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons color={palette.accent} name="cellphone-link" size={44} />
          </View>
          <Text style={styles.copy}>Enter the short code shown by Target Camera mode. QR scanning will feed this same pairing model later.</Text>
          <Field
            keyboardType="number-pad"
            label="Pairing code"
            maxLength={8}
            onChangeText={setPairingCode}
            placeholder="4827"
            value={pairingCode}
          />
          <Button
            disabled={!/^\d{4,8}$/.test(pairingCode.trim())}
            icon="link-variant"
            label="Connect target phone"
            onPress={connect}
          />
        </Card>
      )}
    </Screen>
  );
}

function TelemetryGrid({ telemetry }: { readonly telemetry?: RemotePhoneTelemetry }) {
  if (!telemetry) return <Text style={styles.note}>Waiting for target phone telemetry.</Text>;
  return (
    <View style={styles.grid}>
      <Metric icon="battery-70" label="Battery" value={telemetry.batteryPercent !== undefined ? `${telemetry.batteryPercent}%` : 'Unknown'} />
      <Metric icon="wifi" label="Network" value={`${telemetry.network?.type ?? 'unknown'} / ${telemetry.network?.quality ?? 'unknown'}`} />
      <Metric icon="camera-outline" label="Camera" value={telemetry.activeCameraLabel ?? 'Unknown'} />
      <Metric icon="database-arrow-up-outline" label="Data" value={formatBytes(telemetry.uploadedBytes)} />
    </View>
  );
}

function Metric({ icon, label, value }: {
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.metric}>
      <MaterialCommunityIcons color={palette.textMuted} name={icon} size={18} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function CommandRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '0 KB';
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  section: { gap: spacing.md, marginTop: spacing.md },
  heroIcon: { alignItems: 'center', paddingTop: spacing.sm },
  copy: { ...typography.body, color: palette.textMuted },
  note: { ...typography.caption, color: palette.textDim },
  statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  statusLabel: { ...typography.heading, color: palette.text, flex: 1 },
  commandRow: { flexDirection: 'row', gap: spacing.sm },
  flexButton: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    width: '47%',
    minHeight: 84,
    justifyContent: 'space-between',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.ink,
  },
  metricLabel: { ...typography.caption, color: palette.textDim },
  metricValue: { ...typography.label, color: palette.text },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  detailLabel: { ...typography.label, color: palette.textMuted },
  detailValue: { ...typography.caption, color: palette.text, flex: 1, textAlign: 'right' },
  captureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  captureCopy: { flex: 1 },
  captureTitle: { ...typography.label, color: palette.text },
});
