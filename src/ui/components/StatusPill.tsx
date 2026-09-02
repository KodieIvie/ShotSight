import { StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing, typography } from '../theme';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <View style={[styles.pill, styles[`${tone}Pill`]]}>
      <View style={[styles.dot, styles[`${tone}Dot`]]} />
      <Text numberOfLines={1} style={[styles.text, styles[`${tone}Text`]]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 28,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { ...typography.caption },
  neutralPill: { backgroundColor: palette.surfaceRaised, borderColor: palette.border },
  successPill: { backgroundColor: '#14261A', borderColor: '#305C3E' },
  warningPill: { backgroundColor: '#2B2113', borderColor: '#6D512A' },
  dangerPill: { backgroundColor: '#2A1717', borderColor: '#683434' },
  infoPill: { backgroundColor: '#14212B', borderColor: '#2F526C' },
  neutralDot: { backgroundColor: palette.textDim },
  successDot: { backgroundColor: palette.success },
  warningDot: { backgroundColor: palette.warning },
  dangerDot: { backgroundColor: palette.danger },
  infoDot: { backgroundColor: palette.info },
  neutralText: { color: palette.textMuted },
  successText: { color: palette.success },
  warningText: { color: palette.warning },
  dangerText: { color: palette.danger },
  infoText: { color: palette.info },
});

