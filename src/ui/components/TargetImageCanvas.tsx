import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import { palette, radius } from '../theme';

/** A point expressed against the displayed image, from 0 to 1 on both axes. */
export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TargetImageMarker {
  readonly point: NormalizedPoint;
  readonly label: string;
  readonly color?: string;
}

type InteractionMode = 'tap' | 'rectangle';

interface TargetImageCanvasProps {
  readonly imageUri: string;
  readonly aspectRatio: number;
  readonly interactionMode: InteractionMode;
  readonly markers?: readonly TargetImageMarker[];
  readonly rectangle?: NormalizedRectangle;
  readonly onPointPress?: (point: NormalizedPoint) => void;
  readonly onRectangleChange?: (rectangle: NormalizedRectangle) => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

interface CanvasLayout {
  readonly width: number;
  readonly height: number;
}

/**
 * An image-sized coordinate surface for target tools. It intentionally uses
 * `stretch` inside an aspect-ratio-constrained view: a tap always maps to the
 * source image's normalized coordinate system with no letterboxing offset.
 */
export function TargetImageCanvas({
  imageUri,
  aspectRatio,
  interactionMode,
  markers = [],
  rectangle,
  onPointPress,
  onRectangleChange,
  style,
  testID,
}: TargetImageCanvasProps) {
  const [layout, setLayout] = useState<CanvasLayout>({ width: 1, height: 1 });
  const [draftRectangle, setDraftRectangle] = useState<NormalizedRectangle>();
  const gestureStart = useRef<NormalizedPoint | undefined>(undefined);

  useEffect(() => {
    setDraftRectangle(rectangle);
  }, [rectangle?.height, rectangle?.width, rectangle?.x, rectangle?.y]);

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setLayout({ width, height });
  };

  const pointFromEvent = (locationX: number, locationY: number): NormalizedPoint =>
    Object.freeze({
      x: clamp(locationX / layout.width),
      y: clamp(locationY / layout.height),
    });

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => interactionMode === 'rectangle',
      onPanResponderGrant: (event) => {
        const point = pointFromEvent(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        );
        gestureStart.current = point;
        if (interactionMode === 'rectangle') {
          setDraftRectangle(rectangleFromPoints(point, point));
        }
      },
      onPanResponderMove: (event) => {
        if (interactionMode !== 'rectangle' || !gestureStart.current) return;
        const end = pointFromEvent(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        );
        setDraftRectangle(rectangleFromPoints(gestureStart.current, end));
      },
      onPanResponderRelease: (event) => {
        const end = pointFromEvent(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        );
        if (interactionMode === 'rectangle' && gestureStart.current) {
          const next = rectangleFromPoints(gestureStart.current, end);
          setDraftRectangle(next);
          onRectangleChange?.(next);
        } else if (interactionMode === 'tap') {
          onPointPress?.(end);
        }
        gestureStart.current = undefined;
      },
      onPanResponderTerminate: () => { gestureStart.current = undefined; },
    }),
    [interactionMode, layout.height, layout.width, onPointPress, onRectangleChange],
  );

  const visibleRectangle = interactionMode === 'rectangle'
    ? (draftRectangle ?? rectangle)
    : undefined;

  return (
    <View
      {...panResponder.panHandlers}
      accessibilityLabel={interactionMode === 'rectangle' ? 'Target image; drag to select the target region' : 'Target image; tap to select a reference point'}
      accessible
      onLayout={onLayout}
      style={[styles.canvas, { aspectRatio }, style]}
      testID={testID}
    >
      <Image resizeMode="stretch" source={{ uri: imageUri }} style={styles.image} />
      {visibleRectangle ? <RectangleOverlay rectangle={visibleRectangle} /> : null}
      {markers.map((marker) => <Marker key={marker.label} marker={marker} />)}
    </View>
  );
}

function Marker({ marker }: { readonly marker: TargetImageMarker }) {
  const color = marker.color ?? palette.accent;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.marker,
        {
          borderColor: color,
          left: `${clamp(marker.point.x) * 100}%`,
          top: `${clamp(marker.point.y) * 100}%`,
        },
      ]}
    >
      <View style={[styles.markerDot, { backgroundColor: color }]} />
      <View style={[styles.markerLabel, { borderColor: color }]}>
        <Text style={[styles.markerLabelText, { color }]}>{marker.label}</Text>
      </View>
    </View>
  );
}

function RectangleOverlay({ rectangle }: { readonly rectangle: NormalizedRectangle }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.rectangle,
        {
          left: `${clamp(rectangle.x) * 100}%`,
          top: `${clamp(rectangle.y) * 100}%`,
          width: `${clamp(rectangle.width) * 100}%`,
          height: `${clamp(rectangle.height) * 100}%`,
        },
      ]}
    />
  );
}

export function rectangleFromPoints(
  start: NormalizedPoint,
  end: NormalizedPoint,
): NormalizedRectangle {
  const x = Math.min(clamp(start.x), clamp(end.x));
  const y = Math.min(clamp(start.y), clamp(end.y));
  return Object.freeze({
    x,
    y,
    width: Math.abs(clamp(end.x) - clamp(start.x)),
    height: Math.abs(clamp(end.y) - clamp(start.y)),
  });
}

export function pointToNormalized(
  point: { readonly x: number; readonly y: number },
  widthPixels: number,
  heightPixels: number,
): NormalizedPoint {
  return Object.freeze({
    x: clamp(point.x / widthPixels),
    y: clamp(point.y / heightPixels),
  });
}

export function normalizedToPoint(
  point: NormalizedPoint,
  widthPixels: number,
  heightPixels: number,
): { readonly x: number; readonly y: number } {
  return Object.freeze({
    x: clamp(point.x) * widthPixels,
    y: clamp(point.y) * heightPixels,
  });
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.black,
  },
  image: { width: '100%', height: '100%' },
  rectangle: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: palette.accent,
    backgroundColor: 'rgba(232, 184, 75, 0.12)',
  },
  marker: {
    position: 'absolute',
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 15,
    backgroundColor: 'rgba(9, 13, 11, 0.72)',
  },
  markerDot: { width: 7, height: 7, borderRadius: 4 },
  markerLabel: { position: 'absolute', left: 22, top: -8, minWidth: 26, height: 20, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, justifyContent: 'center', backgroundColor: palette.ink },
  markerLabelText: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
});
