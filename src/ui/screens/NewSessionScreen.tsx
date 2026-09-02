import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { CALIBER_PRESETS } from '../../domain';
import { Button, Card, Field, Screen } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSession'>;

const targetTypes = ['paper', 'steel', 'other'] as const;
type TargetType = (typeof targetTypes)[number];

export function NewSessionScreen({ navigation }: Props) {
  const { activeCamera, busyOperation, createSession } = useShotSight();
  const [title, setTitle] = useState('Range session');
  const [rangeName, setRangeName] = useState('');
  const [distance, setDistance] = useState(String(activeCamera?.profile.targetDistanceYards ?? 100));
  const [targetType, setTargetType] = useState<TargetType>('paper');
  const [caliberName, setCaliberName] = useState('.308');
  const [firearm, setFirearm] = useState('');
  const [ammunition, setAmmunition] = useState('');
  const [notes, setNotes] = useState('');

  const save = async (): Promise<void> => {
    try {
      const preset = CALIBER_PRESETS[caliberName as keyof typeof CALIBER_PRESETS];
      await createSession({
        title,
        rangeName,
        targetDistanceYards: Number(distance),
        targetType,
        caliberName: preset?.name,
        bulletDiameterInches: preset?.bulletDiameterInches,
        firearmName: firearm,
        ammunitionName: ammunition,
        notes,
      });
      navigation.replace('Main', { screen: 'Target' });
    } catch (error) {
      Alert.alert('Could not create session', safeError(error));
    }
  };

  return (
    <Screen footer={<Button icon="play-outline" label="Start session" loading={busyOperation === 'creating-session'} onPress={() => void save()} />}>
      <Text style={styles.title}>New range session</Text>
      <Text style={styles.subtitle}>{activeCamera ? `Using ${activeCamera.profile.name}` : 'Select a camera first.'}</Text>
      <Card style={styles.section} title="Session details">
        <View style={styles.fields}>
          <Field label="Title" onChangeText={setTitle} value={title} />
          <Field label="Range name (optional)" onChangeText={setRangeName} placeholder="North Bench" value={rangeName} />
          <Field keyboardType="decimal-pad" label="Target distance (yards)" onChangeText={setDistance} value={distance} />
        </View>
      </Card>
      <Card style={styles.section} title="Target type">
        <View style={styles.choices}>
          {targetTypes.map((item) => <Choice active={targetType === item} key={item} label={item} onPress={() => setTargetType(item)} />)}
        </View>
      </Card>
      <Card style={styles.section} title="Rifle and load (optional)">
        <View style={styles.fields}>
          <Text style={styles.fieldLabel}>Caliber</Text>
          <View style={styles.choices}>
            {Object.values(CALIBER_PRESETS).map((item) => (
              <Choice active={caliberName === item.name} key={item.name} label={item.name} onPress={() => setCaliberName(item.name)} />
            ))}
          </View>
          <Field label="Firearm" onChangeText={setFirearm} placeholder="Optional" value={firearm} />
          <Field label="Ammunition" onChangeText={setAmmunition} placeholder="Optional" value={ammunition} />
          <Field label="Notes" multiline onChangeText={setNotes} placeholder="Conditions, load, intent…" style={styles.notes} textAlignVertical="top" value={notes} />
        </View>
      </Card>
    </Screen>
  );
}

function Choice({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{label}</Text></Pressable>;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs },
  section: { marginTop: spacing.md },
  fields: { gap: spacing.md },
  fieldLabel: { ...typography.label, color: palette.textMuted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.ink },
  choiceActive: { borderColor: palette.accent, backgroundColor: '#251E10' },
  choiceLabel: { ...typography.caption, color: palette.textMuted },
  choiceLabelActive: { color: palette.accent },
  notes: { minHeight: 96, paddingTop: spacing.sm },
});

