import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { BrandHeader, Button, Card, Screen, StatusPill } from '../components';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';
import { getManualShotEligibility } from './manualShotEligibility';

type Props = BottomTabScreenProps<MainTabParamList, 'Shots'>;

export function ShotsScreen(_props: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeSession, activeTarget, captures, groups, shots, targets, nextShotNumber, busyOperation, setShotFlyer } = useShotSight();
  const latestCapture = captures[captures.length - 1];

  if (!activeSession || !activeTarget) {
    return (
      <Screen>
        <BrandHeader eyebrow="Shots" subtitle="Confirmed impacts become a clean, numbered record." />
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="numeric-1-circle-outline" size={48} />
          <Text style={styles.emptyTitle}>Start a session first</Text>
          <Text style={styles.emptyCopy}>Shot markers belong to a target and its capture history, so numbering stays reliable throughout the session.</Text>
          <Button icon="plus" label="New session" onPress={() => navigation.navigate('NewSession')} />
        </Card>
      </Screen>
    );
  }

  const toggleFlyer = (shotId: string, current: boolean): void => {
    void setShotFlyer(shotId, !current).catch((error) => Alert.alert('Could not update shot', safeError(error)));
  };
  const manualEligibility = getManualShotEligibility(latestCapture, activeTarget, captures);

  return (
    <Screen>
      <BrandHeader eyebrow="Shots" subtitle={`${activeSession.title} · confirmed impacts are numbered automatically`} />
      <View style={styles.targetSwitcher}>
        <Text numberOfLines={1} style={styles.targetSwitcherText}>Showing groups and impacts for {activeTarget.name}</Text>
        <Button compact disabled={busyOperation !== undefined} icon="target-variant" label={`Targets (${targets.length})`} onPress={() => navigation.navigate('TargetManager')} variant="secondary" />
      </View>
      <View style={styles.summaryRow}>
        <Summary label="Confirmed" value={String(shots.length)} />
        <Summary label="Included" value={String(shots.filter((shot) => !shot.isFlyer).length)} />
        <Summary label="Cold bore" value={shots.find((shot) => shot.isColdBore) ? `#${shots.find((shot) => shot.isColdBore)?.number}` : '—'} />
      </View>
      <Button
        disabled={!latestCapture || !manualEligibility.eligible}
        icon="map-marker-plus-outline"
        label={latestCapture && manualEligibility.eligible ? 'Mark shot on latest capture' : 'Register capture to mark'}
        onPress={() => latestCapture && navigation.navigate('ManualShot', { captureId: latestCapture.id })}
      />
      {!manualEligibility.eligible ? <Text style={styles.hint}>{manualEligibility.reason}</Text> : null}

      <View style={styles.groupsHeader}>
        <View>
          <Text style={styles.groupsTitle}>Shot groups</Text>
          <Text style={styles.groupsMeta}>{groups.length ? `${groups.length} saved` : 'Organize any subset of shots'}</Text>
        </View>
        <Button compact icon="plus" label="New group" onPress={() => navigation.navigate('GroupEditor', {})} variant="secondary" />
      </View>
      {groups.length ? (
        <View style={styles.groupList}>
          {groups.map((group) => (
            <Pressable key={group.id} onPress={() => navigation.navigate('GroupEditor', { groupId: group.id })} style={styles.groupCard}>
              <View style={[styles.groupColor, { backgroundColor: group.color ?? palette.accent }]} />
              <View style={styles.groupCopy}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                <Text style={styles.groupMeta}>{group.members.length} selected {group.members.length === 1 ? 'shot' : 'shots'}</Text>
              </View>
              <MaterialCommunityIcons color={palette.textDim} name="chevron-right" size={22} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {shots.length ? (
        <View style={styles.list}>
          {shots.map((shot) => (
            <Card key={shot.id} style={[styles.shot, shot.isFlyer && styles.shotFlyer]}>
              <View style={styles.shotRow}>
                <View style={styles.number}>
                  <Text style={styles.numberText}>#{shot.number}</Text>
                </View>
                <View style={styles.shotCopy}>
                  <View style={styles.shotTitleRow}>
                    <Text style={styles.shotTitle}>{shot.source === 'manual' ? 'Manual mark' : 'Detected impact'}</Text>
                    {shot.isColdBore ? <StatusPill label="Cold bore" tone="info" /> : null}
                    {shot.isFlyer ? <StatusPill label="Excluded" tone="warning" /> : null}
                  </View>
                  <Text style={styles.shotMeta}>{Math.round(shot.position.x)}, {Math.round(shot.position.y)} px · {formatTime(shot.confirmedAt)}</Text>
                </View>
              </View>
              <View style={styles.shotActions}>
                <Button
                  compact
                  icon={shot.isFlyer ? 'undo-variant' : 'flag-outline'}
                  label={shot.isFlyer ? 'Include in stats' : 'Mark flyer'}
                  loading={busyOperation === 'updating'}
                  onPress={() => toggleFlyer(shot.id, shot.isFlyer)}
                  variant="ghost"
                />
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <Card style={styles.emptyList}>
          <Text style={styles.emptyListTitle}>No confirmed shots yet</Text>
          <Text style={styles.emptyListCopy}>Tap a target point to add session shot #{nextShotNumber}. Later automatic candidates will require confirmation before receiving a number.</Text>
        </Card>
      )}
      <Card style={styles.foundation} title="Measurement workflow">
        <Text style={styles.foundationText}>Use Target → Tools to lock the target area and set calibration, then create a group here to see center-to-center size, MOA, and MIL. Flyer flags remain non-destructive.</Text>
      </Card>
    </Screen>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <View style={styles.summary}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  targetSwitcher: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, padding: spacing.sm },
  targetSwitcherText: { ...typography.caption, color: palette.textMuted, flex: 1 },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summary: { flex: 1, minHeight: 76, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  summaryValue: { ...typography.heading, color: palette.accent, textAlign: 'center' },
  summaryLabel: { ...typography.caption, color: palette.textMuted, textAlign: 'center', marginTop: spacing.xxs },
  hint: { ...typography.caption, color: palette.textDim, textAlign: 'center', marginTop: spacing.sm },
  groupsHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.lg },
  groupsTitle: { ...typography.heading, color: palette.text },
  groupsMeta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  groupList: { gap: spacing.xs, marginTop: spacing.sm },
  groupCard: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 58, paddingHorizontal: spacing.sm },
  groupColor: { borderRadius: 5, height: 28, width: 6 },
  groupCopy: { flex: 1 },
  groupLabel: { ...typography.label, color: palette.text },
  groupMeta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  shot: { gap: spacing.sm },
  shotFlyer: { borderColor: '#6D512A', backgroundColor: '#211C14' },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  number: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#302511', borderWidth: 1, borderColor: '#775C29' },
  numberText: { ...typography.label, color: palette.accent, fontSize: 15 },
  shotCopy: { flex: 1, gap: spacing.xxs },
  shotTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  shotTitle: { ...typography.label, color: palette.text },
  shotMeta: { ...typography.caption, color: palette.textMuted },
  shotActions: { alignItems: 'flex-end' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
  emptyList: { marginTop: spacing.lg, gap: spacing.xs },
  emptyListTitle: { ...typography.heading, color: palette.text },
  emptyListCopy: { ...typography.body, color: palette.textMuted },
  foundation: { marginTop: spacing.lg },
  foundationText: { ...typography.body, color: palette.textMuted },
});
