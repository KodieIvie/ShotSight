import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import { RtspTargetView, Screen } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'LiveTarget'>;

export function LiveTargetScreen({ navigation }: Props) {
  const { activeCamera, liveStreamUri, reportConnection } = useShotSight();

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    return () => {
      void ScreenOrientation.unlockAsync().catch(() => undefined);
    };
  }, []);

  if (!activeCamera || !liveStreamUri) {
    return <Screen scroll={false}><View style={styles.missing}><Text style={styles.text}>No active local stream.</Text></View></Screen>;
  }
  return (
    <Screen scroll={false} style={styles.screen}>
      <RtspTargetView
        cameraName={activeCamera.profile.name}
        isFullscreen
        onConnectionChange={reportConnection}
        onFullscreen={() => navigation.goBack()}
        streamUri={liveStreamUri}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
  text: { ...typography.body, color: palette.textMuted },
});

