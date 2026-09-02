import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { BrandHeader, Card, OfflineBanner, Screen, StatusPill } from '../components';
import { palette, spacing, typography } from '../theme';

const roadmap = [
  { icon: 'numeric', label: 'Automatic confirmed-shot numbering', ready: true },
  { icon: 'target', label: 'Newest-impact focus and aggressive search', ready: true },
  { icon: 'backup-restore', label: 'Target baseline reset inside a session', ready: true },
  { icon: 'play-circle-outline', label: 'Shot playback, group filters, and heatmap', ready: true },
  { icon: 'group', label: 'Named groups, cold bore, and flyer exclusions', ready: true },
  { icon: 'tune-vertical', label: 'Scope-click zeroing assistant', ready: true },
  { icon: 'file-delimited-outline', label: 'Private local CSV export', ready: true },
  { icon: 'target-variant', label: 'Multiple independently baselined targets', ready: true },
  { icon: 'shield-outline', label: 'Paper and steel candidate strategies', ready: true },
  { icon: 'lan-connect', label: 'Local ONVIF Device-service probe', ready: true },
  { icon: 'qrcode-scan', label: 'Versioned offline QR pairing', ready: true },
  { icon: 'battery-outline', label: 'Radio / battery gateway contract', ready: true },
  { icon: 'perspective-more', label: 'Perspective correction', ready: false },
] as const;

export function SettingsScreen() {
  const { autoFocusNewestShot, setAutoFocusNewestShot } = useShotSight();
  return (
    <Screen>
      <BrandHeader eyebrow="Settings" subtitle="Local-first by design. Your target images stay on this device." />
      <OfflineBanner />

      <Card style={styles.section} title="Privacy defaults">
        <InfoRow icon="cloud-off-outline" text="No cloud account or subscription" />
        <InfoRow icon="chart-box-outline" text="No telemetry, ads, or analytics SDK" />
        <InfoRow icon="shield-key-outline" text="Camera secrets use Keychain / Keystore" />
        <InfoRow icon="database-lock-outline" text="Sessions and metadata use local SQLite" />
      </Card>

      <Card style={styles.section} title="Range review">
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchTitle}>Auto-focus newest impact</Text>
            <Text style={styles.switchText}>After a capture finds candidates, open the 3x review focus automatically. Turn this off to keep the live target view uninterrupted.</Text>
          </View>
          <Switch
            accessibilityLabel="Auto-focus newest impact"
            onValueChange={(enabled) => void setAutoFocusNewestShot(enabled)}
            thumbColor={autoFocusNewestShot ? palette.accent : palette.textMuted}
            trackColor={{ false: palette.borderStrong, true: '#765D25' }}
            value={autoFocusNewestShot}
          />
        </View>
      </Card>

      <Card style={styles.section} title="Feature status">
        <Text style={styles.intro}>
          The local range workflow is built ahead of physical testing. Camera connectivity, full-resolution capture, ONVIF behavior, hardware radios, and detector acceptance remain the release gate.
        </Text>
        {roadmap.map((item) => (
          <View key={item.label} style={styles.roadmapRow}>
            <MaterialCommunityIcons color={palette.textMuted} name={item.icon} size={20} />
            <Text style={styles.rowText}>{item.label}</Text>
            <StatusPill label={item.ready ? 'Built' : 'Planned'} tone={item.ready ? 'success' : 'neutral'} />
          </View>
        ))}
      </Card>

      <Text style={styles.version}>shotSight {Constants.expoConfig?.version ?? 'development'}</Text>
    </Screen>
  );
}

function InfoRow({ icon, text }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; text: string }) {
  return (
    <View style={styles.infoRow}>
      <MaterialCommunityIcons color={palette.success} name={icon} size={20} />
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, gap: spacing.sm },
  intro: { ...typography.body, color: palette.textMuted, marginBottom: spacing.xs },
  infoRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchCopy: { flex: 1, gap: spacing.xxs },
  switchTitle: { ...typography.label, color: palette.text },
  switchText: { ...typography.caption, color: palette.textMuted },
  roadmapRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: { ...typography.body, color: palette.text, flex: 1 },
  version: { ...typography.caption, color: palette.textDim, textAlign: 'center', marginTop: spacing.lg },
});
