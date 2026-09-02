import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { VLCPlayer, type VideoInfo } from 'react-native-vlc-media-player';

import type { CameraConnectionState } from '../../domain';
import { palette, radius, spacing, typography } from '../theme';
import { StatusPill } from './StatusPill';

type RtspTargetViewProps = {
  cameraName: string;
  streamUri: string;
  onConnectionChange?: (state: CameraConnectionState, firstFrameMs?: number) => void;
  onFullscreen?: () => void;
  isFullscreen?: boolean;
};

const MAX_RECONNECT_DELAY_MS = 15_000;

export function RtspTargetView({
  cameraName,
  streamUri,
  onConnectionChange,
  onFullscreen,
  isFullscreen = false,
}: RtspTargetViewProps) {
  const [playerKey, setPlayerKey] = useState(0);
  const [state, setState] = useState<CameraConnectionState>('connecting');
  const [firstFrameMs, setFirstFrameMs] = useState<number>();
  const [videoSize, setVideoSize] = useState<VideoInfo['videoSize']>();
  const [controlsVisible, setControlsVisible] = useState(true);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectStartedAt = useRef(Date.now());

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const reportState = useCallback(
    (next: CameraConnectionState, latency?: number) => {
      setState(next);
      onConnectionChange?.(next, latency);
    },
    [onConnectionChange],
  );

  const resetView = useCallback(() => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const reconnect = useCallback(() => {
    if (retryTimer.current) return;
    retryCount.current += 1;
    const delay = Math.min(1_000 * 2 ** (retryCount.current - 1), MAX_RECONNECT_DELAY_MS);
    reportState('reconnecting');
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      connectStartedAt.current = Date.now();
      reportState('connecting');
      setPlayerKey((key) => key + 1);
    }, delay);
  }, [reportState]);

  useEffect(() => {
    connectStartedAt.current = Date.now();
    reportState('connecting');
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [reportState, streamUri]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        retryCount.current = 0;
        connectStartedAt.current = Date.now();
        setPlayerKey((key) => key + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(savedScale.value * event.scale, 8));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((event) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + event.translationX;
        translateY.value = savedTranslateY.value + event.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  });

  const transformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const status = connectionStatus(state);

  return (
    <View style={styles.shell}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.videoTransform, transformStyle]}>
          <VLCPlayer
            key={`${streamUri.length}-${playerKey}`}
            autoAspectRatio
            autoplay
            muted
            onBuffering={() => reportState('connecting')}
            onError={reconnect}
            onLoad={(info) => setVideoSize(info.videoSize)}
            onPlaying={() => {
              if (retryTimer.current) {
                clearTimeout(retryTimer.current);
                retryTimer.current = null;
              }
              retryCount.current = 0;
              const measured = Date.now() - connectStartedAt.current;
              setFirstFrameMs(measured);
              reportState('connected', measured);
            }}
            onStopped={reconnect}
            resizeMode="contain"
            source={{
              uri: streamUri,
              initType: 2,
              initOptions: ['--rtsp-tcp', '--network-caching=300', '--no-audio'],
            }}
            style={styles.video}
          />
        </Animated.View>
      </GestureDetector>

      <View pointerEvents="box-none" style={styles.controlSurface}>
        {controlsVisible ? (
          <>
            <View style={styles.topBar}>
              <View style={styles.cameraCopy}>
                <Text numberOfLines={1} style={styles.cameraName}>{cameraName}</Text>
                <Text style={styles.meta}>
                  {videoSize ? `${videoSize.width} × ${videoSize.height}` : 'Waiting for stream'}
                  {firstFrameMs ? `  •  first frame ${firstFrameMs} ms` : ''}
                </Text>
              </View>
              <StatusPill label={status.label} tone={status.tone} />
            </View>
            <View style={styles.viewerActions} pointerEvents="box-none">
              <View style={styles.actionGroup}>
                <RoundAction
                  icon="eye-off-outline"
                  label="Hide controls"
                  onPress={() => setControlsVisible(false)}
                />
                <RoundAction icon="fit-to-screen-outline" label="Reset zoom" onPress={resetView} />
                {onFullscreen ? <RoundAction icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'} label={isFullscreen ? 'Exit full screen' : 'Full screen'} onPress={onFullscreen} /> : null}
              </View>
              <Text style={styles.hint}>Pinch to zoom • drag to pan • double-tap to reset</Text>
            </View>
          </>
        ) : (
          <Pressable
            accessibilityLabel="Show target controls"
            onPress={() => setControlsVisible(true)}
            style={styles.hiddenHint}
          >
            <MaterialCommunityIcons color={palette.textMuted} name="eye-outline" size={18} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function RoundAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={styles.roundAction}>
      <MaterialCommunityIcons color={palette.text} name={icon} size={22} />
    </Pressable>
  );
}

function connectionStatus(state: CameraConnectionState): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  switch (state) {
    case 'connected':
      return { label: 'Live', tone: 'success' };
    case 'connecting':
      return { label: 'Connecting', tone: 'warning' };
    case 'reconnecting':
      return { label: 'Reconnecting', tone: 'warning' };
    case 'authentication-failed':
      return { label: 'Check login', tone: 'danger' };
    case 'unreachable':
    case 'stream-error':
      return { label: 'Stream error', tone: 'danger' };
    default:
      return { label: 'Offline', tone: 'neutral' };
  }
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 320,
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: palette.black,
  },
  videoTransform: { ...StyleSheet.absoluteFill },
  video: { width: '100%', height: '100%', backgroundColor: palette.black },
  controlSurface: { ...StyleSheet.absoluteFill },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  cameraCopy: { flex: 1 },
  cameraName: { ...typography.label, color: palette.text, fontSize: 15 },
  meta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  viewerActions: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  actionGroup: { flexDirection: 'row', gap: spacing.xs },
  roundAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: 'rgba(13,19,16,0.86)',
  },
  hint: {
    ...typography.caption,
    color: palette.textMuted,
    maxWidth: Platform.OS === 'web' ? 300 : 210,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  hiddenHint: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
});
