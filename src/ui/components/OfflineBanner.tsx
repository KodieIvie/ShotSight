import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing, typography } from '../theme';

export function OfflineBanner() {
  return (
    <View style={styles.banner}>
      <MaterialCommunityIcons color={palette.info} name="wifi" size={20} />
      <View style={styles.copy}>
        <Text style={styles.title}>Local network mode</Text>
        <Text style={styles.body}>Internet is not required. Stay connected to the target-camera Wi-Fi network.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#2F526C',
    borderRadius: radius.md,
    backgroundColor: '#111D25',
  },
  copy: { flex: 1, gap: spacing.xxs },
  title: { ...typography.label, color: palette.info },
  body: { ...typography.caption, color: palette.textMuted },
});

