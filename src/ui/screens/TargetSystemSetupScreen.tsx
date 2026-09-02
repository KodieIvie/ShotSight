import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { createTargetSystemCameraSetupSeed } from '../../application/targetSystemCameraSetup';
import { useShotSight } from '../../application/ShotSightProvider';
import { Button, Card, Field, OfflineBanner, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TargetSystemSetup'>;

/**
 * Setup surface for a future ShotSight commercial target system. It accepts a
 * scan result as text today so pairing remains entirely offline without
 * bringing a camera/scanner permission dependency into the app yet.
 */
export function TargetSystemSetupScreen({ navigation }: Props) {
  const {
    busyOperation,
    clearTargetSystemPairing,
    pairTargetSystem,
    refreshTargetSystemStatus,
    targetSystemPairing,
    targetSystemStatus,
  } = useShotSight();
  const [pairingText, setPairingText] = useState('');
  const busy = busyOperation === 'updating';
  const cameraSeed = targetSystemPairing
    ? createTargetSystemCameraSetupSeed(targetSystemPairing)
    : undefined;

  const pair = async (): Promise<void> => {
    try {
      const pairing = await pairTargetSystem(pairingText);
      setPairingText('');
      Alert.alert(
        'Target system paired',
        `${pairing.label} is saved locally. Camera credentials were not read from or stored in the QR code.`,
      );
    } catch (error) {
      Alert.alert('Could not pair target system', safeError(error));
    }
  };

  const refreshStatus = async (): Promise<void> => {
    try {
      await refreshTargetSystemStatus();
    } catch (error) {
      Alert.alert('Could not refresh system status', safeError(error));
    }
  };

  const forget = (): void => {
    Alert.alert(
      'Forget this target system?',
      'This removes only the local, credential-free pairing metadata. Saved cameras, their secure credentials, and range sessions stay intact.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget pairing',
          style: 'destructive',
          onPress: () => void clearTargetSystemPairing().catch((error) => Alert.alert('Could not forget pairing', safeError(error))),
        },
      ],
    );
  };

  return (
    <Screen>
      <Text style={styles.title}>Target system setup</Text>
      <Text style={styles.subtitle}>Offline configuration for a future camera, radio, and battery kit. No cloud account is used.</Text>
      <OfflineBanner />

      {targetSystemPairing ? (
        <>
          <Card style={styles.section} title="Paired target system">
            <SystemRow icon="label-outline" label="Name" value={targetSystemPairing.label} />
            <SystemRow icon="identifier" label="System ID" value={targetSystemPairing.systemId} />
            <SystemRow icon="camera-outline" label="Camera" value={targetSystemPairing.camera.host} />
            <SystemRow
              icon="lan-connect"
              label="ONVIF"
              value={cameraSeed?.onvifEnabled ? `Enabled • port ${cameraSeed.onvifPort ?? 80}` : 'Not supplied'}
            />
            {targetSystemPairing.radio ? <SystemRow icon="access-point" label="Radio" value={`${targetSystemPairing.radio.transport}${targetSystemPairing.radio.deviceId ? ` • ${targetSystemPairing.radio.deviceId}` : ''}`} /> : null}
            <Button
              icon="camera-plus-outline"
              label="Set up paired camera"
              onPress={() => navigation.navigate('CameraSetup', { useTargetSystemPairing: true })}
              variant="secondary"
            />
            <Text style={styles.note}>This only pre-fills credential-free local camera metadata. You will enter the camera login separately and it stays in secure device storage.</Text>
          </Card>

          <Card style={styles.section} title="Hardware status">
            {targetSystemStatus ? (
              <>
                <StatusRow label="Gateway" state={targetSystemStatus.gateway.state} />
                <Text style={styles.statusCopy}>{targetSystemStatus.gateway.message ?? 'Gateway status received.'}</Text>
                <StatusRow label="Camera" state={targetSystemStatus.camera.state} />
                <Text style={styles.statusCopy}>{targetSystemStatus.camera.message ?? 'Camera status received.'}</Text>
                {targetSystemStatus.radio ? (
                  <>
                    <StatusRow label="Radio" state={targetSystemStatus.radio.state} />
                    <Text style={styles.statusCopy}>{targetSystemStatus.radio.message ?? 'Radio status received.'}</Text>
                  </>
                ) : null}
                {targetSystemStatus.battery ? (
                  <>
                    <StatusRow label="Battery" state={targetSystemStatus.battery.state} />
                    <Text style={styles.statusCopy}>{batteryStatusCopy(targetSystemStatus.battery)}</Text>
                  </>
                ) : null}
              </>
            ) : (
              <Text style={styles.statusCopy}>No status has been read yet.</Text>
            )}
            <Button
              icon="refresh"
              label="Refresh hardware status"
              loading={busy}
              onPress={() => void refreshStatus()}
              variant="secondary"
            />
            <Text style={styles.note}>No target-system radio or battery gateway is installed in this build, so “unavailable” is an honest expected result rather than a connection failure.</Text>
          </Card>

          <Button icon="delete-outline" label="Forget pairing" onPress={forget} variant="danger" />
        </>
      ) : (
        <Card style={styles.section} title="Pair offline QR configuration">
          <View style={styles.qrIcon}>
            <MaterialCommunityIcons color={palette.accent} name="qrcode-scan" size={42} />
          </View>
          <Text style={styles.copy}>Paste the exact text from a ShotSight offline pairing QR code. This versioned payload may include local host, endpoint, and radio identifiers, but it rejects usernames, passwords, tokens, and unknown fields.</Text>
          <Field
            autoCapitalize="none"
            label="Offline pairing payload"
            maxLength={4096}
            multiline
            onChangeText={setPairingText}
            placeholder="shotsight:pair:v1:%7B...%7D"
            style={styles.pairingInput}
            textAlignVertical="top"
            value={pairingText}
          />
          <Button
            disabled={!pairingText.trim()}
            icon="link-variant"
            label="Pair target system"
            loading={busy}
            onPress={() => void pair()}
          />
          <Text style={styles.note}>A native QR scanner can feed this same text field later. Pairing itself is already local and does not depend on the scanner or an internet connection.</Text>
        </Card>
      )}
    </Screen>
  );
}

function SystemRow({ icon, label, value }: {
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons color={palette.textMuted} name={icon} size={20} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function StatusRow({ label, state }: { readonly label: string; readonly state: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <StatusPill label={formatState(state)} tone={statusTone(state)} />
    </View>
  );
}

function formatState(value: string): string {
  return value.replaceAll('-', ' ');
}

function statusTone(state: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (state === 'available' || state === 'connected' || state === 'paired' || state === 'full' || state === 'external-power') return 'success';
  if (state === 'unavailable' || state === 'not-probed' || state === 'unsupported' || state === 'unknown') return 'neutral';
  if (state === 'low' || state === 'charging' || state === 'discharging' || state === 'connecting' || state === 'scanning' || state === 'authentication-required') return 'warning';
  if (state === 'critical' || state === 'unreachable' || state === 'stream-error') return 'danger';
  return 'info';
}

function batteryStatusCopy(status: {
  readonly chargePercent?: number;
  readonly voltage?: number;
  readonly message?: string;
}): string {
  if (status.message) return status.message;
  const values = [
    status.chargePercent !== undefined ? `${Math.round(status.chargePercent)}%` : undefined,
    status.voltage !== undefined ? `${status.voltage.toFixed(2)} V` : undefined,
  ].filter((value): value is string => Boolean(value));
  return values.join(' • ') || 'Battery status received.';
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  section: { gap: spacing.md, marginTop: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  rowLabel: { ...typography.label, color: palette.textMuted, width: 82 },
  rowValue: { ...typography.caption, color: palette.text, flex: 1, textAlign: 'right' },
  statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  statusCopy: { ...typography.caption, color: palette.textMuted, marginTop: -spacing.xs },
  note: { ...typography.caption, color: palette.textDim },
  copy: { ...typography.body, color: palette.textMuted },
  qrIcon: { alignItems: 'center', paddingTop: spacing.sm },
  pairingInput: { minHeight: 128, paddingTop: spacing.sm },
});
