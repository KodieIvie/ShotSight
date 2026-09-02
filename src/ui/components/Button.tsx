import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { palette, radius, spacing, typography } from '../theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  compact?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function Button({
  label,
  onPress,
  icon,
  disabled,
  loading,
  variant = 'primary',
  compact,
  style,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        styles[variant],
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? palette.accentInk : palette.text} size="small" />
      ) : icon ? (
        <MaterialCommunityIcons
          color={variant === 'primary' ? palette.accentInk : variant === 'danger' ? palette.danger : palette.text}
          name={icon}
          size={compact ? 18 : 22}
        />
      ) : null}
      <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
  },
  compact: { minHeight: 42, paddingHorizontal: spacing.md },
  primary: { backgroundColor: palette.accent, borderColor: palette.accent },
  secondary: { backgroundColor: palette.surfaceRaised, borderColor: palette.borderStrong },
  ghost: { backgroundColor: 'transparent', borderColor: palette.border },
  danger: { backgroundColor: 'transparent', borderColor: palette.danger },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.42 },
  label: { ...typography.label, fontSize: 15 },
  primaryLabel: { color: palette.accentInk },
  secondaryLabel: { color: palette.text },
  ghostLabel: { color: palette.text },
  dangerLabel: { color: palette.danger },
});

