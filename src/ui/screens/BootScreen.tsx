import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BrandHeader, Button } from '../components';
import { palette, spacing, typography } from '../theme';

export function BootScreen({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <View style={styles.screen}>
      <BrandHeader />
      {error ? (
        <>
          <Text style={styles.title}>Local storage could not be opened</Text>
          <Text style={styles.copy}>{error}</Text>
          {retry ? <Button label="Try again" onPress={retry} style={styles.button} /> : null}
        </>
      ) : (
        <>
          <ActivityIndicator color={palette.accent} size="large" />
          <Text style={styles.copy}>Opening your local range data…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: palette.background,
  },
  title: { ...typography.heading, color: palette.text, textAlign: 'center' },
  copy: { ...typography.body, color: palette.textMuted, textAlign: 'center', maxWidth: 420 },
  button: { marginTop: spacing.sm, minWidth: 180 },
});

