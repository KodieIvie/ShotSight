import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import {
  SessionCsvShareError,
  type SessionCsvExportResult,
} from '../../infrastructure/export/SessionCsvExportService';
import { Button, Card, Screen, StatusPill } from '../components';
import { palette, spacing, typography } from '../theme';

/**
 * An intentionally narrow first export surface. It produces a data-only CSV;
 * original images, image URIs, camera endpoints, and credentials never enter
 * the report or the share sheet.
 */
export function SessionExportScreen() {
  const { activeSession, busyOperation, exportActiveSessionCsv } = useShotSight();
  const [lastExport, setLastExport] = useState<SessionCsvExportResult>();

  const exportCsv = async (share: boolean): Promise<void> => {
    try {
      const result = await exportActiveSessionCsv(share);
      setLastExport(result);
      if (share && result.shareStatus === 'shared') {
        Alert.alert('CSV ready to share', `${result.file.filename} was saved locally and passed to the system share sheet.`);
      } else if (share && result.shareStatus === 'unavailable') {
        Alert.alert('CSV saved locally', `${result.file.filename} is saved on this device. A system share sheet is not available here.`);
      } else {
        Alert.alert('CSV saved locally', `${result.file.filename} is ready in ShotSight's local export folder.`);
      }
    } catch (error) {
      if (error instanceof SessionCsvShareError) {
        setLastExport(error.result);
        Alert.alert('CSV saved locally', `${error.result.file.filename} was saved, but the system share sheet could not open. You can try Share CSV again.`);
        return;
      }
      Alert.alert('Could not export session', safeError(error));
    }
  };

  if (!activeSession) {
    return (
      <Screen>
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="file-delimited-outline" size={48} />
          <Text style={styles.emptyTitle}>Open a session to export it</Text>
          <Text style={styles.emptyCopy}>CSV export contains confirmed shot coordinates, groups, calibration, and session metadata from the currently active local session.</Text>
        </Card>
      </Screen>
    );
  }

  const exporting = busyOperation === 'exporting';
  return (
    <Screen>
      <Text style={styles.title}>Export session CSV</Text>
      <Text style={styles.subtitle}>Create a spreadsheet-friendly local report for {activeSession.title}. Sharing is always an explicit action.</Text>

      <Card accessory={<StatusPill label="Local only" tone="success" />} style={styles.card} title="Included">
        <Info icon="target" text="Session and target metadata, baseline revision, calibration, POA, and desired-zero references" />
        <Info icon="format-list-numbered" text="Confirmed shot numbers, coordinates, source, confidence, cold-bore, and flyer state" />
        <Info icon="group" text="Named groups and their inclusion/exclusion membership" />
      </Card>

      <Card accessory={<StatusPill label="Never included" tone="neutral" />} style={styles.card} title="Privacy boundary">
        <Info icon="image-off-outline" text="No original target images, image paths, preview files, or image bytes" />
        <Info icon="shield-key-outline" text="No camera IPs, RTSP URLs, usernames, passwords, or credential references" />
      </Card>

      <View style={styles.actions}>
        <Button
          icon="content-save-outline"
          label="Save CSV locally"
          loading={exporting}
          onPress={() => void exportCsv(false)}
          style={styles.action}
          variant="secondary"
        />
        <Button
          icon="share-variant-outline"
          label="Save & share CSV"
          loading={exporting}
          onPress={() => void exportCsv(true)}
          style={styles.action}
        />
      </View>

      {lastExport ? (
        <Card style={styles.result} title="Last local export">
          <Text style={styles.filename}>{lastExport.file.filename}</Text>
          <Text style={styles.resultText}>{lastExport.file.rowCount} CSV rows · {formatBytes(lastExport.file.byteCount)} · {formatShareStatus(lastExport.shareStatus)}</Text>
        </Card>
      ) : null}

      <Text style={styles.note}>CSV export is available before physical range testing. Annotated-image and PDF reports remain future export formats.</Text>
    </Screen>
  );
}

function Info({ icon, text }: { readonly icon: keyof typeof MaterialCommunityIcons.glyphMap; readonly text: string }) {
  return (
    <View style={styles.info}>
      <MaterialCommunityIcons color={palette.textMuted} name={icon} size={19} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1) return '0 B';
  if (value < 1_024) return `${Math.round(value)} B`;
  return `${(value / 1_024).toFixed(1)} KB`;
}

function formatShareStatus(status: SessionCsvExportResult['shareStatus']): string {
  switch (status) {
    case 'shared': return 'shared through system sheet';
    case 'unavailable': return 'share sheet unavailable';
    default: return 'saved only';
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  card: { gap: spacing.sm, marginTop: spacing.md },
  info: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  infoText: { ...typography.body, color: palette.textMuted, flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
  action: { minHeight: 58 },
  result: { gap: spacing.xs, marginTop: spacing.lg },
  filename: { ...typography.label, color: palette.accent },
  resultText: { ...typography.caption, color: palette.textMuted },
  note: { ...typography.caption, color: palette.textDim, marginTop: spacing.lg, textAlign: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
});
