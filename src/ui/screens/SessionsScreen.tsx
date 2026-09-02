import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { Session } from '../../domain';
import { BrandHeader, Button, Card, Screen, StatusPill } from '../components';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';

type Props = BottomTabScreenProps<MainTabParamList, 'Sessions'>;

export function SessionsScreen(_props: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeSession, sessions, busyOperation, archiveSession, deleteSession, selectSession } = useShotSight();

  const archive = (session: Session): void => {
    Alert.alert('Archive this session?', 'Its photos and measurements remain stored on this device and can be resumed later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', onPress: () => void archiveSession(session.id).catch((error) => Alert.alert('Could not archive session', safeError(error))) },
    ]);
  };

  const remove = (session: Session): void => {
    Alert.alert(
      'Delete this session?',
      'This removes the session metadata and all associated targets, captures, shots, and groups from the local database. Capture files are retained for now so an interrupted delete cannot destroy originals unexpectedly.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete metadata', style: 'destructive', onPress: () => void deleteSession(session.id).catch((error) => Alert.alert('Could not delete session', safeError(error))) },
      ],
    );
  };

  return (
    <Screen>
      <BrandHeader eyebrow="Sessions" subtitle="Every range session is local, resumable, and independent of internet access." />
      <View style={styles.topActions}>
        <Button icon="plus" label="New session" onPress={() => navigation.navigate('NewSession')} style={styles.topAction} />
        <Button disabled={!activeSession} icon="file-delimited-outline" label="Export active" onPress={() => navigation.navigate('SessionExport')} style={styles.topAction} variant="secondary" />
      </View>

      {sessions.length === 0 ? (
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="folder-outline" size={48} />
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <Text style={styles.emptyCopy}>Start a session after selecting a camera. Captures, markers, and later measurements will stay together here.</Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {sessions.map((session) => {
            const active = activeSession?.id === session.id;
            return (
              <Pressable key={session.id} onPress={() => void selectSession(session.id)} style={[styles.sessionCard, active && styles.sessionCardActive]}>
                <View style={styles.top}>
                  <View style={styles.icon}>
                    <MaterialCommunityIcons color={active ? palette.accent : palette.textMuted} name="target" size={23} />
                  </View>
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={styles.sessionTitle}>{session.title}</Text>
                    <Text style={styles.meta}>{formatDate(session.startedAt)} · {session.targetDistanceYards} yd · {session.targetType}</Text>
                  </View>
                  <StatusPill label={session.status} tone={session.status === 'active' ? 'success' : 'neutral'} />
                </View>
                {session.rangeName || session.caliber ? <Text style={styles.detail}>{[session.rangeName, session.caliber?.name].filter(Boolean).join(' · ')}</Text> : null}
                <View style={styles.cardActions}>
                  {!active ? <Button compact icon="play-outline" label="Resume" onPress={() => void selectSession(session.id)} variant="secondary" /> : null}
                  {session.status !== 'archived' ? <Button compact icon="archive-arrow-down-outline" label="Archive" onPress={() => archive(session)} variant="ghost" /> : null}
                  <Button compact icon="delete-outline" label="Delete" onPress={() => remove(session)} variant="ghost" />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {busyOperation === 'updating' ? <Text style={styles.working}>Updating local session data…</Text> : null}
    </Screen>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString();
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  topActions: { flexDirection: 'row', gap: spacing.sm },
  topAction: { flex: 1 },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  sessionCard: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, backgroundColor: palette.surface },
  sessionCardActive: { borderColor: '#79602A', backgroundColor: '#1D1B14' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: palette.ink },
  copy: { flex: 1 },
  sessionTitle: { ...typography.label, color: palette.text, fontSize: 16 },
  meta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  detail: { ...typography.caption, color: palette.textDim, marginLeft: 50 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  working: { ...typography.caption, color: palette.textDim, textAlign: 'center', marginTop: spacing.md },
});
