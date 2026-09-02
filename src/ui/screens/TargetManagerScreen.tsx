import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { Target } from '../../domain';
import { Button, Card, Field, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TargetManager'>;

const targetTypes = ['paper', 'steel', 'other'] as const;

/**
 * Session-level target switcher. A target remains an independent coordinate
 * system, so switching never mixes its baseline, capture review, shots, or
 * groups with another target in the same session.
 */
export function TargetManagerScreen({ navigation }: Props) {
  const {
    activeSession,
    activeTarget,
    busyOperation,
    createTarget,
    selectTarget,
    targets,
  } = useShotSight();
  const [name, setName] = useState(() => `Target ${targets.length + 1}`);
  const [type, setType] = useState<Target['type']>(activeSession?.targetType ?? 'paper');

  useEffect(() => {
    if (!activeSession) return;
    setType(activeSession.targetType);
  }, [activeSession?.id, activeSession?.targetType]);

  const create = async (): Promise<void> => {
    try {
      const target = await createTarget({ name, type });
      Alert.alert(
        'Target ready',
        `${target.name} is now active. Capture a clean baseline before reviewing impacts on it.`,
        [{ text: 'Go to target', onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      Alert.alert('Could not add target', safeError(error));
    }
  };

  const switchTarget = (target: Target): void => {
    if (target.id === activeTarget?.id) return;
    void selectTarget(target.id)
      .then(() => navigation.goBack())
      .catch((error) => Alert.alert('Could not switch target', safeError(error)));
  };

  if (!activeSession) {
    return (
      <Screen>
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="target-variant" size={48} />
          <Text style={styles.emptyTitle}>Start a session first</Text>
          <Text style={styles.emptyCopy}>Targets live inside a range session so each one can retain its own clean baseline, setup, and shot record.</Text>
          <Button icon="plus" label="New session" onPress={() => navigation.navigate('NewSession')} />
        </Card>
      </Screen>
    );
  }

  const changing = busyOperation === 'updating' || busyOperation === 'creating-session';
  return (
    <Screen>
      <Text style={styles.title}>Session targets</Text>
      <Text style={styles.subtitle}>{activeSession.title} · switch physical targets without mixing their captures, calibration, groups, or impact review.</Text>

      <View style={styles.list}>
        {targets.map((target) => (
          <TargetRow
            active={target.id === activeTarget?.id}
            disabled={changing}
            key={target.id}
            onPress={() => switchTarget(target)}
            target={target}
          />
        ))}
      </View>

      <Card style={styles.createCard} title="Add another target">
        <Text style={styles.createCopy}>Use a clear label such as “Load A”, “Cold-bore target”, or “Steel rack”. The new target starts with no baseline or copied measurement setup.</Text>
        <Field
          autoCapitalize="words"
          label="Target name"
          onChangeText={setName}
          placeholder="Load B"
          returnKeyType="done"
          value={name}
        />
        <View style={styles.typeChoices}>
          {targetTypes.map((item) => (
            <TypeChoice
              active={type === item}
              key={item}
              label={item}
              onPress={() => setType(item)}
            />
          ))}
        </View>
        <Button
          disabled={!name.trim()}
          icon="target-variant"
          label="Add & select target"
          loading={changing}
          onPress={() => void create()}
        />
      </Card>

      <Text style={styles.note}>Target selection is saved locally. Session export still includes every target, while on-screen tools always operate on the selected target only.</Text>
    </Screen>
  );
}

function TargetRow({ active, disabled, onPress, target }: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly target: Target;
}) {
  const status = target.baseline
    ? `Baseline v${target.baseline.revision}`
    : 'Needs baseline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.targetRow, active && styles.targetRowActive, pressed && styles.targetRowPressed]}
    >
      <View style={[styles.targetIcon, active && styles.targetIconActive]}>
        <MaterialCommunityIcons color={active ? palette.accent : palette.textMuted} name={target.type === 'steel' ? 'shield-outline' : 'target'} size={23} />
      </View>
      <View style={styles.targetCopy}>
        <Text numberOfLines={1} style={styles.targetName}>{target.name}</Text>
        <Text style={styles.targetMeta}>{target.type} · {status}</Text>
      </View>
      {active ? <StatusPill label="Active" tone="success" /> : <MaterialCommunityIcons color={palette.textDim} name="chevron-right" size={23} />}
    </Pressable>
  );
}

function TypeChoice({ active, label, onPress }: {
  readonly active: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.typeChoice, active && styles.typeChoiceActive]}
    >
      <Text style={[styles.typeChoiceLabel, active && styles.typeChoiceLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  targetRow: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 72, padding: spacing.sm },
  targetRowActive: { backgroundColor: '#1D1B14', borderColor: '#79602A' },
  targetRowPressed: { opacity: 0.76 },
  targetIcon: { alignItems: 'center', backgroundColor: palette.ink, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  targetIconActive: { backgroundColor: '#302511' },
  targetCopy: { flex: 1 },
  targetName: { ...typography.label, color: palette.text, fontSize: 16 },
  targetMeta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs, textTransform: 'capitalize' },
  createCard: { gap: spacing.md, marginTop: spacing.xl },
  createCopy: { ...typography.body, color: palette.textMuted },
  typeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  typeChoice: { backgroundColor: palette.ink, borderColor: palette.borderStrong, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: 38, paddingHorizontal: spacing.sm },
  typeChoiceActive: { backgroundColor: '#251E10', borderColor: palette.accent },
  typeChoiceLabel: { ...typography.caption, color: palette.textMuted, textTransform: 'capitalize' },
  typeChoiceLabelActive: { color: palette.accent },
  note: { ...typography.caption, color: palette.textDim, marginTop: spacing.lg, textAlign: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
});
