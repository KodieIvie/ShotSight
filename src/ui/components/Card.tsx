import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radius, spacing, typography } from '../theme';

type CardProps = PropsWithChildren<{
  title?: string;
  accessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
}>;

export function Card({ title, accessory, children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.heading}>
          <Text style={styles.title}>{title}</Text>
          {accessory}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    padding: spacing.md,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: { ...typography.heading, color: palette.text },
});
