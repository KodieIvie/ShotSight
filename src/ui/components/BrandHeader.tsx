import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { palette, spacing, typography } from '../theme';

type BrandHeaderProps = {
  eyebrow?: string;
  subtitle?: string;
};

export function BrandHeader({ eyebrow, subtitle }: BrandHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <View style={styles.mark}>
          <MaterialCommunityIcons color={palette.accent} name="crosshairs-gps" size={24} />
        </View>
        <Text style={styles.brand}>
          shot<Text style={styles.brandAccent}>Sight</Text>
        </Text>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
  },
  brand: { ...typography.title, color: palette.text, letterSpacing: -1 },
  brandAccent: { color: palette.accent },
  eyebrow: {
    ...typography.caption,
    marginLeft: 'auto',
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.sm },
});

