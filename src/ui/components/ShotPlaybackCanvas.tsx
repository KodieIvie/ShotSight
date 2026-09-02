import { useMemo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { Shot } from '../../domain';
import { palette, radius } from '../theme';
import { buildShotHeatmap } from '../screens/rangeReviewUtils';

interface ShotPlaybackCanvasProps {
  readonly imageUri: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  /** The shots that should be visible at the current point in playback. */
  readonly shots: readonly Shot[];
  readonly activeShotId?: string;
  readonly overlayColor?: string;
  readonly showHeatmap?: boolean;
  readonly showShotNumbers?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * Draws registered shot coordinates over the clean baseline image. The image
 * is intentionally stretched inside an aspect-ratio constrained surface, so
 * each overlay point is a direct fraction of the original pixel dimensions.
 */
export function ShotPlaybackCanvas({
  imageUri,
  widthPixels,
  heightPixels,
  shots,
  activeShotId,
  overlayColor,
  showHeatmap = false,
  showShotNumbers = true,
  style,
  testID,
}: ShotPlaybackCanvasProps) {
  const heatmap = useMemo(
    () => showHeatmap
      ? buildShotHeatmap(shots, widthPixels, heightPixels)
      : [],
    [heightPixels, shots, showHeatmap, widthPixels],
  );
  const color = safeColor(overlayColor);
  const aspectRatio = widthPixels > 0 && heightPixels > 0
    ? widthPixels / heightPixels
    : 4 / 3;

  return (
    <View
      accessibilityLabel={`Target review showing ${shots.length} confirmed impact${shots.length === 1 ? '' : 's'}`}
      accessible
      style={[styles.canvas, { aspectRatio }, style]}
      testID={testID}
    >
      <Image resizeMode="stretch" source={{ uri: imageUri }} style={styles.image} />
      {heatmap.map((cell) => (
        <View
          key={`${cell.column}-${cell.row}`}
          pointerEvents="none"
          style={[
            styles.heatCell,
            {
              backgroundColor: color,
              left: `${(cell.column / 14) * 100}%`,
              top: `${(cell.row / 14) * 100}%`,
              width: `${100 / 14}%`,
              height: `${100 / 14}%`,
              opacity: 0.16 + cell.intensity * 0.58,
            },
          ]}
        />
      ))}
      {shots.map((shot) => {
        const isActive = shot.id === activeShotId;
        const markerColor = shot.isFlyer
          ? palette.warning
          : shot.isColdBore
            ? palette.info
            : color;
        return (
          <View
            key={shot.id}
            pointerEvents="none"
            style={[
              styles.marker,
              shot.isFlyer && styles.flyerMarker,
              isActive && styles.activeMarker,
              {
                borderColor: markerColor,
                left: `${normalized(shot.position.x, widthPixels) * 100}%`,
                top: `${normalized(shot.position.y, heightPixels) * 100}%`,
              },
            ]}
          >
            <View style={[styles.markerDot, { backgroundColor: markerColor }]} />
            {showShotNumbers ? (
              <View style={[styles.markerLabel, { borderColor: markerColor }]}>
                <Text style={[styles.markerLabelText, { color: markerColor }]}>#{shot.number}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function normalized(value: number, size: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.max(0, Math.min(1, value / size));
}

function safeColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{3,8}$/iu.test(value) ? value : palette.accent;
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.black,
  },
  image: { width: '100%', height: '100%' },
  heatCell: {
    position: 'absolute',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 14,
    backgroundColor: 'rgba(9, 13, 11, 0.76)',
  },
  activeMarker: { borderWidth: 3, transform: [{ scale: 1.22 }] },
  flyerMarker: { borderStyle: 'dashed' },
  markerDot: { width: 7, height: 7, borderRadius: 4 },
  markerLabel: {
    position: 'absolute',
    top: -10,
    left: 19,
    minWidth: 27,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: palette.ink,
  },
  markerLabelText: { fontSize: 10, fontWeight: '700' },
});
