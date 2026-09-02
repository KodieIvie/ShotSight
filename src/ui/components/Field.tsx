import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { palette, radius, spacing, typography } from '../theme';

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
};

export function Field({ label, hint, error, style, ...props }: FieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={palette.textDim}
        selectionColor={palette.accent}
        style={[styles.input, error && styles.inputError, style]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { ...typography.label, color: palette.textMuted },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.md,
    backgroundColor: palette.ink,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: { borderColor: palette.danger },
  hint: { ...typography.caption, color: palette.textDim },
  error: { ...typography.caption, color: palette.danger },
});

