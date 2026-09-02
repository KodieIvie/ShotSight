import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { type CameraKind, useShotSight } from '../../application/ShotSightProvider';
import { createTargetSystemCameraSetupSeed } from '../../application/targetSystemCameraSetup';
import { Card, Button, Field, OfflineBanner, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CameraSetup'>;

export function CameraSetupScreen({ navigation, route }: Props) {
  const { busyOperation, saveCamera, targetSystemPairing, testCamera } = useShotSight();
  const [kind, setKind] = useState<CameraKind>('reolink-rlc-520a');
  const [name, setName] = useState('Target camera');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [mainRtspUrl, setMainRtspUrl] = useState('');
  const [subRtspUrl, setSubRtspUrl] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [onvifEnabled, setOnvifEnabled] = useState(true);
  const [onvifPort, setOnvifPort] = useState('8000');
  const [onvifProtocol, setOnvifProtocol] = useState<'http' | 'https'>('http');
  const [targetDistance, setTargetDistance] = useState('100');
  const [testSummary, setTestSummary] = useState<string>();
  const pairedCameraSeed = useMemo(
    () => route.params?.useTargetSystemPairing && targetSystemPairing
      ? createTargetSystemCameraSetupSeed(targetSystemPairing)
      : undefined,
    [route.params?.useTargetSystemPairing, targetSystemPairing],
  );

  useEffect(() => {
    if (kind === 'reolink-rlc-520a' && !pairedCameraSeed) {
      setOnvifEnabled(true);
      setOnvifPort('8000');
      setOnvifProtocol('http');
      setMainRtspUrl('');
      setSubRtspUrl('');
      setSnapshotUrl('');
    }
  }, [kind, pairedCameraSeed]);

  useEffect(() => {
    if (!pairedCameraSeed) return;
    setKind(pairedCameraSeed.kind);
    setName(pairedCameraSeed.name);
    setHost(pairedCameraSeed.host);
    setMainRtspUrl(pairedCameraSeed.mainRtspUrl ?? '');
    setSubRtspUrl(pairedCameraSeed.subRtspUrl ?? '');
    setSnapshotUrl(pairedCameraSeed.snapshotUrl ?? '');
    setOnvifEnabled(pairedCameraSeed.onvifEnabled);
    setOnvifPort(pairedCameraSeed.onvifPort ? String(pairedCameraSeed.onvifPort) : '');
    setOnvifProtocol('http');
  }, [pairedCameraSeed]);

  const input = () => ({
    kind,
    name,
    host,
    username: username.trim() || undefined,
    password: password || undefined,
    mainRtspUrl: mainRtspUrl.trim() || undefined,
    subRtspUrl: subRtspUrl.trim() || undefined,
    snapshotUrl: snapshotUrl.trim() || undefined,
    onvifEnabled,
    onvifPort: onvifPort.trim() ? Number(onvifPort) : undefined,
    onvifProtocol,
    targetDistanceYards: targetDistance.trim() ? Number(targetDistance) : undefined,
  });

  const validate = (): boolean => {
    if (!host.trim()) {
      Alert.alert('Camera IP required', 'Enter the local IP address or hostname of the target camera.');
      return false;
    }
    if (kind === 'generic-rtsp' && !mainRtspUrl.trim()) {
      Alert.alert('RTSP URL required', 'Generic cameras need a credential-free main-stream RTSP URL.');
      return false;
    }
    return true;
  };

  const handleTest = async (): Promise<void> => {
    if (!validate()) return;
    setTestSummary(undefined);
    try {
      const result = await testCamera(input());
      const attempt = result.report.attempts.find((item) => item.outcome === 'available');
      setTestSummary(
        result.report.available
          ? `Snapshot available${attempt?.latencyMs ? ` in ${attempt.latencyMs} ms` : ''}. Save, then open Target to validate RTSP playback.`
          : 'No snapshot endpoint answered. You can still save the profile and validate its RTSP feed; add a snapshot URL for high-resolution captures.',
      );
    } catch (error) {
      Alert.alert('Local test failed', safeError(error));
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!validate()) return;
    try {
      await saveCamera(input());
      navigation.replace('Main', { screen: 'Camera' });
    } catch (error) {
      Alert.alert('Could not save camera', safeError(error));
    }
  };

  const isBusy = busyOperation === 'testing-camera' || busyOperation === 'saving-camera';
  return (
    <Screen
      footer={<Button icon="content-save-outline" label="Save local camera" loading={busyOperation === 'saving-camera'} onPress={() => void handleSave()} />}
    >
      <Text style={styles.title}>Add a target camera</Text>
      <Text style={styles.subtitle}>Direct local LAN connection. No Reolink cloud or account is used.</Text>
      <OfflineBanner />

      {pairedCameraSeed ? (
        <Card style={styles.pairingNotice} title="Paired system metadata loaded">
          <Text style={styles.copy}>The offline QR code filled only local endpoint metadata. Enter or change the camera login below; credentials were not part of the QR code and are saved only in secure device storage.</Text>
          {!pairedCameraSeed.mainRtspUrl && pairedCameraSeed.kind === 'generic-rtsp' ? <Text style={styles.pairingWarning}>This pairing did not include a main RTSP path, so add one before saving a generic profile.</Text> : null}
        </Card>
      ) : null}

      <Text style={styles.label}>Camera type</Text>
      <View style={styles.kindRow}>
        <KindOption
          active={kind === 'reolink-rlc-520a'}
          icon="camera-outline"
          label="RLC-520A"
          onPress={() => setKind('reolink-rlc-520a')}
        />
        <KindOption
          active={kind === 'generic-rtsp'}
          icon="lan-connect"
          label="Generic RTSP"
          onPress={() => setKind('generic-rtsp')}
        />
      </View>

      <Card style={styles.section} title="Local camera">
        <View style={styles.fields}>
          <Field label="Camera name" onChangeText={setName} placeholder="Target camera" value={name} />
          <Field
            autoCapitalize="none"
            keyboardType="url"
            label="Camera IP or hostname"
            onChangeText={setHost}
            placeholder="192.168.50.20"
            value={host}
          />
          <Field label="Username" onChangeText={setUsername} placeholder="admin" value={username} />
          <Field label="Password" onChangeText={setPassword} placeholder="Stored in secure storage" secureTextEntry value={password} />
        </View>
      </Card>

      {kind === 'reolink-rlc-520a' ? (
        <Card style={styles.section} title="RLC-520A local preset">
          <Text style={styles.copy}>Preview: RTSP substream. Still: native main-stream JPEG. The app tries the documented local endpoint patterns only.</Text>
          <View style={styles.endpointRow}>
            <MaterialCommunityIcons color={palette.success} name="check-circle-outline" size={19} />
            <Text style={styles.endpoint}>rtsp://&lt;IP&gt;:554/Preview_01_sub</Text>
          </View>
          <View style={styles.endpointRow}>
            <MaterialCommunityIcons color={palette.success} name="check-circle-outline" size={19} />
            <Text style={styles.endpoint}>RTSP main + HTTP Snap candidates</Text>
          </View>
        </Card>
      ) : (
        <Card style={styles.section} title="Generic camera endpoints">
          <Text style={styles.copy}>Enter credential-free URLs. shotSight adds the credentials only in memory when opening the local connection.</Text>
          <View style={styles.fields}>
            <Field label="Main RTSP URL" onChangeText={setMainRtspUrl} placeholder="rtsp://192.168.50.20:554/live/main" value={mainRtspUrl} />
            <Field label="Preview RTSP URL (optional)" onChangeText={setSubRtspUrl} placeholder="rtsp://192.168.50.20:554/live/sub" value={subRtspUrl} />
            <Field label="High-res snapshot URL (optional)" onChangeText={setSnapshotUrl} placeholder="http://192.168.50.20/snapshot.jpg" value={snapshotUrl} />
          </View>
        </Card>
      )}

      <Card style={styles.section} title="Target defaults">
        <View style={styles.fields}>
          <Field keyboardType="decimal-pad" label="Target distance (yards)" onChangeText={setTargetDistance} value={targetDistance} />
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchLabel}>ONVIF enabled</Text>
              <Text style={styles.copy}>Probe the selected camera's local ONVIF Device service from Diagnostics.</Text>
            </View>
            <Switch
              onValueChange={setOnvifEnabled}
              thumbColor={onvifEnabled ? palette.accent : palette.textDim}
              trackColor={{ false: palette.borderStrong, true: '#765B26' }}
              value={onvifEnabled}
            />
          </View>
          {onvifEnabled ? <Field keyboardType="number-pad" label="ONVIF port" onChangeText={setOnvifPort} value={onvifPort} /> : null}
          {onvifEnabled ? (
            <View style={styles.protocolSection}>
              <Text style={styles.switchLabel}>ONVIF protocol</Text>
              <View style={styles.protocolChoices}>
                <ProtocolOption active={onvifProtocol === 'http'} label="HTTP" onPress={() => setOnvifProtocol('http')} />
                <ProtocolOption active={onvifProtocol === 'https'} label="HTTPS" onPress={() => setOnvifProtocol('https')} />
              </View>
              <Text style={styles.copy}>Use HTTPS only when the camera's local certificate and mobile platform trust behavior have been verified.</Text>
            </View>
          ) : null}
        </View>
      </Card>

      <Button icon="connection" label="Test high-res snapshot" loading={busyOperation === 'testing-camera'} onPress={() => void handleTest()} variant="secondary" />
      {testSummary ? (
        <View style={styles.testResult}>
          <StatusPill label={testSummary.startsWith('Snapshot available') ? 'Snapshot test passed' : 'Snapshot unavailable'} tone={testSummary.startsWith('Snapshot available') ? 'success' : 'warning'} />
          <Text style={styles.testCopy}>{testSummary}</Text>
        </View>
      ) : null}
      {isBusy ? <Text style={styles.working}>Testing only the local camera endpoint…</Text> : null}
    </Screen>
  );
}

function KindOption({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.kind, active && styles.kindActive]}>
      <MaterialCommunityIcons color={active ? palette.accent : palette.textMuted} name={icon} size={24} />
      <Text style={[styles.kindLabel, active && styles.kindLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function ProtocolOption({ active, label, onPress }: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.protocolOption, active && styles.protocolOptionActive]}
    >
      <Text style={[styles.protocolLabel, active && styles.protocolLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.label, color: palette.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs },
  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kind: {
    flex: 1,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  kindActive: { borderColor: palette.accent, backgroundColor: '#251E10' },
  kindLabel: { ...typography.label, color: palette.textMuted },
  kindLabelActive: { color: palette.accent },
  section: { marginTop: spacing.md },
  pairingNotice: { gap: spacing.sm, marginTop: spacing.md },
  fields: { gap: spacing.md },
  copy: { ...typography.caption, color: palette.textMuted },
  pairingWarning: { ...typography.caption, color: palette.warning },
  endpointRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  endpoint: { ...typography.caption, color: palette.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchCopy: { flex: 1, gap: spacing.xxs },
  switchLabel: { ...typography.label, color: palette.text },
  protocolSection: { gap: spacing.xs },
  protocolChoices: { flexDirection: 'row', gap: spacing.xs },
  protocolOption: { alignItems: 'center', backgroundColor: palette.ink, borderColor: palette.borderStrong, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: 38, minWidth: 76, paddingHorizontal: spacing.sm },
  protocolOptionActive: { backgroundColor: '#251E10', borderColor: palette.accent },
  protocolLabel: { ...typography.caption, color: palette.textMuted },
  protocolLabelActive: { color: palette.accent },
  testResult: {
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  testCopy: { ...typography.body, color: palette.textMuted },
  working: { ...typography.caption, color: palette.textDim, textAlign: 'center', marginTop: spacing.sm },
});
