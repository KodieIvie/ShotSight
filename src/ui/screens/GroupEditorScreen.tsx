import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import {
  measureShotGroup,
  shotsIncludedInGroup,
  type ShotGroup,
  type ShotGroupMembership,
} from '../../domain';
import { Button, Card, Field, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';
import { shotsForTargetBaseline } from './rangeReviewUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupEditor'>;

export function GroupEditorScreen({ navigation, route }: Props) {
  const {
    activeSession,
    activeTarget,
    busyOperation,
    groups,
    shots,
    removeShotGroup,
    saveShotGroup,
    setColdBore,
  } = useShotSight();
  const existingGroup = route.params.groupId
    ? groups.find((group) => group.id === route.params.groupId)
    : undefined;
  const targetShots = useMemo(
    () => shotsForTargetBaseline(
      shots,
      activeTarget?.id,
      activeTarget?.baseline?.revision,
    ),
    [activeTarget?.baseline?.revision, activeTarget?.id, shots],
  );
  const currentBaselineShotIds = useMemo(
    () => new Set(targetShots.map((shot) => shot.id)),
    [targetShots],
  );
  const [label, setLabel] = useState(existingGroup?.label ?? '');
  const [color, setColor] = useState(existingGroup?.color ?? '');
  const [memberIds, setMemberIds] = useState<ReadonlySet<string>>(
    () => new Set(
      existingGroup?.members
        .filter((member) => currentBaselineShotIds.has(member.shotId))
        .map((member) => member.shotId) ?? [],
    ),
  );
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(
    () => new Set(
      existingGroup?.members
        .filter((member) => (
          currentBaselineShotIds.has(member.shotId)
          && member.excludeFromStatistics
        ))
        .map((member) => member.shotId) ?? [],
    ),
  );

  useEffect(() => {
    setLabel(existingGroup?.label ?? '');
    setColor(existingGroup?.color ?? '');
    setMemberIds(new Set(
      existingGroup?.members
        .filter((member) => currentBaselineShotIds.has(member.shotId))
        .map((member) => member.shotId) ?? [],
    ));
    setExcludedIds(new Set(
      existingGroup?.members
        .filter((member) => (
          currentBaselineShotIds.has(member.shotId)
          && member.excludeFromStatistics
        ))
        .map((member) => member.shotId) ?? [],
    ));
  }, [activeTarget?.baseline?.revision, activeTarget?.id, existingGroup?.id, existingGroup?.updatedAt]);

  const currentMembers = useMemo<readonly ShotGroupMembership[]>(
    () => Object.freeze(
      targetShots
        .filter((shot) => memberIds.has(shot.id))
        .map((shot) => Object.freeze({
          shotId: shot.id,
          excludeFromStatistics: excludedIds.has(shot.id),
        })),
    ),
    [excludedIds, memberIds, targetShots],
  );
  const historicalMembers = useMemo<readonly ShotGroupMembership[]>(
    () => Object.freeze(
      (existingGroup?.members ?? [])
        .filter((member) => !currentBaselineShotIds.has(member.shotId))
        .map((member) => Object.freeze({ ...member })),
    ),
    [currentBaselineShotIds, existingGroup?.members],
  );
  const persistedMembers = useMemo<readonly ShotGroupMembership[]>(
    () => Object.freeze([...historicalMembers, ...currentMembers]),
    [currentMembers, historicalMembers],
  );

  const provisionalGroup = useMemo<ShotGroup | undefined>(() => {
    if (!activeSession || !activeTarget) return undefined;
    const timestamp = existingGroup?.updatedAt ?? new Date().toISOString();
    return Object.freeze({
      id: existingGroup?.id ?? 'unsaved-group',
      sessionId: activeSession.id,
      targetId: activeTarget.id,
      label: label.trim() || 'Untitled group',
      color: color.trim() || undefined,
      members: currentMembers,
      createdAt: existingGroup?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }, [activeSession, activeTarget, color, currentMembers, existingGroup, label]);

  const measurement = useMemo(() => {
    if (!activeSession || !activeTarget?.calibration || !provisionalGroup) return undefined;
    try {
      const included = shotsIncludedInGroup(provisionalGroup, targetShots);
      return measureShotGroup(included, activeTarget.calibration, activeSession.targetDistanceYards, {
        bulletDiameterInches: activeSession.caliber?.bulletDiameterInches,
      });
    } catch {
      return undefined;
    }
  }, [activeSession, activeTarget?.calibration, provisionalGroup, targetShots]);

  if (!activeSession || !activeTarget) {
    return (
      <Screen>
        <Text style={styles.missing}>Open a range session before creating a shot group.</Text>
      </Screen>
    );
  }

  if (route.params.groupId && !existingGroup) {
    return (
      <Screen>
        <Text style={styles.missing}>This shot group is no longer available on the active target.</Text>
        <Button compact icon="arrow-left" label="Back to shots" onPress={() => navigation.goBack()} variant="ghost" />
      </Screen>
    );
  }

  const toggleMember = (shotId: string): void => {
    setMemberIds((current) => {
      const next = new Set(current);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
    setExcludedIds((current) => {
      const next = new Set(current);
      next.delete(shotId);
      return next;
    });
  };

  const toggleExclusion = (shotId: string): void => {
    if (!memberIds.has(shotId)) return;
    setExcludedIds((current) => {
      const next = new Set(current);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    if (!label.trim()) {
      Alert.alert('Name the group', 'Use a useful label such as Load A, Cold Bore, or 140 gr test.');
      return;
    }
    try {
      await saveShotGroup({
        id: existingGroup?.id,
        label,
        color,
        members: persistedMembers,
      });
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not save group', safeError(error));
    }
  };

  const makeColdBore = (shotNumber: number, shotId: string): void => {
    void setColdBore(shotId).catch((error) => {
      Alert.alert(`Could not mark #${shotNumber} as cold bore`, safeError(error));
    });
  };

  const remove = (): void => {
    if (!existingGroup) return;
    Alert.alert('Delete this group?', 'The underlying shots remain in the session.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete group',
        style: 'destructive',
        onPress: () => {
          void removeShotGroup(existingGroup.id)
            .then(() => navigation.goBack())
            .catch((error) => Alert.alert('Could not delete group', safeError(error)));
        },
      },
    ]);
  };

  return (
    <Screen
      footer={(
        <Button
          disabled={!label.trim()}
          icon="content-save-outline"
          label={existingGroup ? 'Save group' : 'Create group'}
          loading={busyOperation === 'updating'}
          onPress={() => void save()}
        />
      )}
    >
      <Text style={styles.title}>{existingGroup ? 'Edit shot group' : 'New shot group'}</Text>
      <Text style={styles.subtitle}>Build independent groups on the same target. A shot can appear in more than one group without changing its confirmed number.</Text>

      <Card style={styles.form} title="Group details">
        <Field
          label="Label"
          onChangeText={setLabel}
          placeholder="Load A, Cold Bore, 140 gr test"
          value={label}
        />
        <Field
          autoCapitalize="none"
          label="Color (optional)"
          onChangeText={setColor}
          placeholder="#E8B84B"
          value={color}
        />
      </Card>

      <Card
        accessory={<StatusPill label={`${memberIds.size} selected`} tone="info" />}
        style={styles.measurement}
        title="Current-baseline group measurement"
      >
        {measurement ? (
          <>
            <Text style={styles.measurementValue}>{measurement.centerToCenterInches.toFixed(2)} in</Text>
            <Text style={styles.measurementMeta}>{measurement.moa.toFixed(2)} MOA - {measurement.mil.toFixed(2)} MIL - {measurement.shotCount} included</Text>
          </>
        ) : activeTarget.calibration ? (
          <Text style={styles.measurementHint}>Select at least two non-excluded shots to calculate group size.</Text>
        ) : (
          <Text style={styles.measurementHint}>Add a target calibration to see inches, MOA, and MIL. Membership is still saved now.</Text>
        )}
      </Card>

      <Text style={styles.sectionTitle}>Shots on the current baseline</Text>
      {targetShots.length ? targetShots.map((shot) => {
        const selected = memberIds.has(shot.id);
        const excluded = excludedIds.has(shot.id);
        return (
          <View key={shot.id} style={[styles.shotRow, selected && styles.shotSelected]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => toggleMember(shot.id)}
              style={styles.selection}
            >
              <MaterialCommunityIcons
                color={selected ? palette.accent : palette.textDim}
                name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={25}
              />
              <View style={styles.shotCopy}>
                <View style={styles.shotHeading}>
                  <Text style={styles.shotTitle}>Shot #{shot.number}</Text>
                  {shot.isColdBore ? <StatusPill label="Cold bore" tone="info" /> : null}
                  {shot.isFlyer ? <StatusPill label="Global flyer" tone="warning" /> : null}
                </View>
                <Text style={styles.shotMeta}>{Math.round(shot.position.x)}, {Math.round(shot.position.y)} px</Text>
              </View>
            </Pressable>
            <View style={styles.rowActions}>
              {selected ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: excluded }}
                  onPress={() => toggleExclusion(shot.id)}
                  style={[styles.actionChip, excluded && styles.actionChipExcluded]}
                >
                  <Text style={[styles.actionChipText, excluded && styles.actionChipTextExcluded]}>{excluded ? 'Excluded' : 'Use in stats'}</Text>
                </Pressable>
              ) : null}
              {!shot.isColdBore ? (
                <Pressable accessibilityRole="button" onPress={() => makeColdBore(shot.number, shot.id)} style={styles.coldBoreAction}>
                  <Text style={styles.coldBoreText}>Set cold</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      }) : (
        <Card style={styles.noShots}>
          <Text style={styles.noShotsTitle}>No shots to group yet</Text>
          <Text style={styles.noShotsCopy}>Mark impacts on the current target baseline, then return here to organize them.</Text>
        </Card>
      )}

      {existingGroup ? (
        <Button compact icon="delete-outline" label="Delete group" loading={busyOperation === 'updating'} onPress={remove} variant="danger" />
      ) : null}
    </Screen>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  form: { gap: spacing.md },
  measurement: { gap: spacing.xs, marginTop: spacing.md },
  measurementValue: { ...typography.heading, color: palette.accent, fontSize: 26 },
  measurementMeta: { ...typography.caption, color: palette.textMuted },
  measurementHint: { ...typography.body, color: palette.textMuted },
  sectionTitle: { ...typography.heading, color: palette.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  shotRow: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, marginBottom: spacing.sm, padding: spacing.sm },
  shotSelected: { borderColor: '#725A29', backgroundColor: '#211C14' },
  selection: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shotCopy: { flex: 1, gap: spacing.xxs },
  shotHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  shotTitle: { ...typography.label, color: palette.text },
  shotMeta: { ...typography.caption, color: palette.textMuted },
  rowActions: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'flex-end', marginTop: spacing.sm },
  actionChip: { borderColor: palette.borderStrong, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  actionChipExcluded: { borderColor: '#775C29', backgroundColor: '#302511' },
  actionChipText: { ...typography.caption, color: palette.textMuted },
  actionChipTextExcluded: { color: palette.warning },
  coldBoreAction: { borderColor: palette.border, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  coldBoreText: { ...typography.caption, color: palette.info },
  noShots: { gap: spacing.xs },
  noShotsTitle: { ...typography.heading, color: palette.text },
  noShotsCopy: { ...typography.body, color: palette.textMuted },
  missing: { ...typography.body, color: palette.textMuted, marginTop: spacing.xl, textAlign: 'center' },
});
