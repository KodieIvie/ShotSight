import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { OnvifProbeReport } from '../../infrastructure';
import { BrandHeader, Button, Card, OfflineBanner, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CameraDiagnostics'>;

interface LocalNetworkInfo {
  readonly type?: string;
  readonly connected?: boolean;
  readonly internetReachable?: boolean;
  readonly ipAddress?: string;
}

export function CameraDiagnosticsScreen(_props: Props) {
  const {
    activeCamera,
    connectionLatencyMs,
    connectionState,
    busyOperation,
    liveStreamEndpoint,
    testActiveCamera,
    testActiveOnvif,
  } = useShotSight();
  const [network, setNetwork] = useState<LocalNetworkInfo>();
  const [snapshotSummary, setSnapshotSummary] = useState<string>();
  const [onvifReport, setOnvifReport] = useState<OnvifProbeReport>();

  const refreshNetwork = async (): Promise<void> => {
    try {
      const [state, ipAddress] = await Promise.all([Network.getNetworkStateAsync(), Network.getIpAddressAsync()]);
      setNetwork({
        type: state.type,
        connected: state.isConnected,
        internetReachable: state.isInternetReachable,
        ipAddress,
      });
    } catch {
      setNetwork({});
    }
  };

  useEffect(() => {
    void refreshNetwork();
  }, []);

  useEffect(() => {
    setSnapshotSummary(undefined);
    setOnvifReport(undefined);
  }, [activeCamera?.profile.id]);

  const testSnapshot = async (): Promise<void> => {
    try {
      const report = await testActiveCamera();
      const available = report.attempts.find((attempt) => attempt.outcome === 'available');
      setSnapshotSummary(
        report.available
          ? `Available via ${available?.candidateId ?? 'camera endpoint'}${available?.latencyMs ? ` in ${available.latencyMs} ms` : ''}.`
          : report.attempts.length
            ? 'No configured snapshot endpoint returned an image. RTSP live view may still work.'
            : 'This profile has no HTTP snapshot endpoint configured.',
      );
    } catch (error) {
      Alert.alert('Snapshot check failed', safeError(error));
    }
  };

  const probeOnvif = async (): Promise<void> => {
    try {
      setOnvifReport(await testActiveOnvif());
    } catch (error) {
      Alert.alert('ONVIF probe failed', safeError(error));
    }
  };

  const connectionTone = connectionState === 'connected' ? 'success' : connectionState === 'connecting' || connectionState === 'reconnecting' ? 'warning' : 'neutral';
  return (
    <Screen>
      <BrandHeader eyebrow="Diagnostics" subtitle="Checks stay inside the selected local network." />
      <OfflineBanner />

      <Card style={styles.section} title="Phone and range network">
        <DiagnosticRow icon="wifi" label="Network" value={network?.type ?? 'Checking…'} />
        <DiagnosticRow icon="ip-network-outline" label="Phone IP" value={network?.ipAddress ?? 'Unavailable'} />
        <DiagnosticRow icon="lan-connect" label="Local route" value={network?.connected ? 'Connected' : 'Not connected'} good={network?.connected} />
        <DiagnosticRow
          icon="web-off"
          label="Internet"
          value={network?.internetReachable ? 'Available (not required)' : 'Not reachable (okay)'}
          good={!network?.internetReachable}
        />
        <Button compact icon="refresh" label="Refresh network" onPress={() => void refreshNetwork()} variant="ghost" />
      </Card>

      <Card style={styles.section} title="Selected camera">
        {activeCamera ? (
          <>
            <DiagnosticRow icon="camera-outline" label="Camera" value={`${activeCamera.profile.name} · ${activeCamera.profile.host}`} />
            <DiagnosticRow icon="video-wireless-outline" label="RTSP endpoint" value={liveStreamEndpoint ?? 'Not resolved'} />
            <View style={styles.statusRow}>
              <Text style={styles.rowLabel}>Live stream</Text>
              <StatusPill label={connectionState.replace('-', ' ')} tone={connectionTone} />
            </View>
            <DiagnosticRow icon="timer-outline" label="First frame" value={connectionLatencyMs ? `${connectionLatencyMs} ms (stream open time)` : 'Open Target to measure'} />
            <Button icon="image-search-outline" label="Test high-res snapshot" loading={busyOperation === 'testing-camera'} onPress={() => void testSnapshot()} variant="secondary" />
            {snapshotSummary ? <Text style={styles.snapshotSummary}>{snapshotSummary}</Text> : null}

            <View style={styles.onvifDivider} />
            <DiagnosticRow
              icon="lan-connect"
              label="ONVIF"
              value={activeCamera.profile.onvif.enabled
                ? `${(activeCamera.profile.onvif.protocol ?? 'http').toUpperCase()} • port ${activeCamera.profile.onvif.port ?? 80}`
                : 'Disabled in profile'}
              good={activeCamera.profile.onvif.enabled}
            />
            {activeCamera.profile.onvif.enabled ? (
              <Button
                icon="lan-check"
                label="Probe local ONVIF"
                loading={busyOperation === 'testing-camera'}
                onPress={() => void probeOnvif()}
                variant="secondary"
              />
            ) : (
              <Text style={styles.snapshotSummary}>Enable ONVIF in local camera setup to probe its Device service.</Text>
            )}
            {onvifReport ? <OnvifResult report={onvifReport} /> : null}
          </>
        ) : (
          <Text style={styles.empty}>Add a camera first. Diagnostics do not scan your subnet or require internet access.</Text>
        )}
      </Card>

      <Card style={styles.section} title="What this means">
        <Text style={styles.copy}>“First frame” measures how quickly the player opened the stream; it is not glass-to-glass video latency. RTSP and snapshot checks are separate because a camera can expose one without the other.</Text>
      </Card>
    </Screen>
  );
}

function OnvifResult({ report }: { readonly report: OnvifProbeReport }) {
  const deviceLabel = [report.deviceInformation?.manufacturer, report.deviceInformation?.model]
    .filter((value): value is string => Boolean(value))
    .join(' • ');
  const capabilities = report.capabilities
    ? [
      report.capabilities.media && 'Media',
      report.capabilities.events && 'Events',
      report.capabilities.imaging && 'Imaging',
      report.capabilities.ptz && 'PTZ',
      report.capabilities.analytics && 'Analytics',
    ].filter((value): value is string => Boolean(value)).join(', ') || 'Device service only'
    : undefined;
  return (
    <View style={styles.onvifResult}>
      <View style={styles.statusRow}>
        <Text style={styles.rowLabel}>ONVIF result</Text>
        <StatusPill label={formatOnvifStatus(report.status)} tone={onvifTone(report.status)} />
      </View>
      <Text style={styles.snapshotSummary}>{report.message}</Text>
      {deviceLabel ? <DiagnosticRow icon="camera-outline" label="Device" value={deviceLabel} /> : null}
      {report.deviceInformation?.firmwareVersion ? <DiagnosticRow icon="update" label="Firmware" value={report.deviceInformation.firmwareVersion} /> : null}
      {capabilities ? <DiagnosticRow icon="format-list-checks" label="Capabilities" value={capabilities} /> : null}
    </View>
  );
}

function DiagnosticRow({ icon, label, value, good }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons color={good ? palette.success : palette.textMuted} name={icon} size={20} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text numberOfLines={2} style={[styles.rowValue, good && styles.good]}>{value}</Text>
    </View>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

function formatOnvifStatus(status: OnvifProbeReport['status']): string {
  return status.replaceAll('-', ' ');
}

function onvifTone(status: OnvifProbeReport['status']): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'available') return 'success';
  if (status === 'authentication-required') return 'info';
  if (status === 'authentication-failed' || status === 'unreachable' || status === 'timeout' || status === 'invalid-endpoint') return 'danger';
  if (status === 'unsupported-service' || status === 'malformed-response' || status === 'soap-fault' || status === 'transport-error') return 'warning';
  return 'neutral';
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowLabel: { ...typography.label, color: palette.textMuted, width: 92 },
  rowValue: { ...typography.caption, color: palette.text, flex: 1, textAlign: 'right' },
  good: { color: palette.success },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  onvifDivider: { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.xs },
  onvifResult: { gap: spacing.sm, marginTop: spacing.xs },
  snapshotSummary: { ...typography.body, color: palette.textMuted },
  empty: { ...typography.body, color: palette.textMuted },
  copy: { ...typography.body, color: palette.textMuted },
});
