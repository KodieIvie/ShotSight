import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { Capture } from '../../domain';
import { Button, Card, Screen, StatusPill } from '../components';
import type { RootStackParamList } from '../navigation/types';
import { palette, radius, spacing, typography } from '../theme';
import { capturesForTargetBaseline } from './rangeReviewUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'CaptureCompare'>;
type CompareMode = 'overlay' | 'swipe' | 'blink';

/**
 * A capture-review tool deliberately kept independent of the image-analysis
 * implementation.  It gives the shooter a dependable visual comparison while
 * native registration is added behind the same capture model later.
 */
export function CaptureCompareScreen({ navigation, route }: Props) {
  const { activeTarget, captures } = useShotSight();
  const targetCaptures = useMemo(
    () => capturesForTargetBaseline(
      captures,
      activeTarget?.id,
      activeTarget?.baseline?.revision,
    ),
    [activeTarget?.baseline?.revision, activeTarget?.id, captures],
  );
  const requestedBaseline = route.params?.baselineCaptureId;
  const requestedComparison = route.params?.comparisonCaptureId;
  const baseline = targetCaptures.find((capture) => capture.id === requestedBaseline)
    ?? targetCaptures.find((capture) => capture.id === activeTarget?.baseline?.captureId);
  const comparison = targetCaptures.find((capture) => capture.id === requestedComparison)
    ?? [...targetCaptures].reverse().find((capture) => capture.id !== baseline?.id);

  const [mode, setMode] = useState<CompareMode>('overlay');
  const [opacity, setOpacity] = useState(0.5);
  const [divider, setDivider] = useState(0.5);
  const [showComparison, setShowComparison] = useState(true);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const frameWidth = useRef(0);

  useEffect(() => {
    if (mode !== 'blink') {
      setShowComparison(true);
      return undefined;
    }
    const interval = setInterval(() => setShowComparison((visible) => !visible), 700);
    return () => clearInterval(interval);
  }, [mode]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: () => mode === 'swipe',
    onPanResponderGrant: (event) => setDivider(clamp(event.nativeEvent.locationX / Math.max(1, frameWidth.current))),
    onPanResponderMove: (event) => setDivider(clamp(event.nativeEvent.locationX / Math.max(1, frameWidth.current))),
  }), [mode]);

  if (!activeTarget || !baseline || !comparison) {
    return (
      <Screen>
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="compare" size={48} />
          <Text style={styles.emptyTitle}>Capture two target states first</Text>
          <Text style={styles.emptyCopy}>Set a clean baseline, then take at least one later high-resolution capture. ShotSight will keep both originals locally for comparison.</Text>
        </Card>
      </Screen>
    );
  }

  const aspectRatio = comparison.widthPixels / comparison.heightPixels;
  const imageUri = (capture: Capture): string => capture.previewImageUri ?? capture.originalImageUri;
  const isSameDimensions = baseline.widthPixels === comparison.widthPixels && baseline.heightPixels === comparison.heightPixels;
  const normalizedRoi = activeTarget.roi?.kind === 'rectangle'
    ? {
      x: clampUnit(activeTarget.roi.rect.x / baseline.widthPixels),
      y: clampUnit(activeTarget.roi.rect.y / baseline.heightPixels),
      width: clampUnit(activeTarget.roi.rect.width / baseline.widthPixels),
      height: clampUnit(activeTarget.roi.rect.height / baseline.heightPixels),
    }
    : undefined;
  const comparisonLabel = `Capture #${comparison.sequenceNumber}`;

  return (
    <Screen>
      <Text style={styles.title}>Compare target states</Text>
      <Text style={styles.subtitle}>Baseline #{baseline.sequenceNumber} against {comparisonLabel.toLowerCase()}</Text>

      <View style={styles.modeRow}>
        <ModeButton active={mode === 'overlay'} icon="layers-outline" label="Overlay" onPress={() => setMode('overlay')} />
        <ModeButton active={mode === 'swipe'} icon="compare" label="Swipe" onPress={() => setMode('swipe')} />
        <ModeButton active={mode === 'blink'} icon="refresh" label="Blink" onPress={() => setMode('blink')} />
      </View>

      <View
        {...(mode === 'swipe' ? panResponder.panHandlers : {})}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          frameWidth.current = width;
          setFrameSize({ width, height });
        }}
        style={[styles.imageFrame, { aspectRatio }]}
      >
        <Image resizeMode="stretch" source={{ uri: imageUri(baseline) }} style={styles.image} />
        {mode === 'overlay' ? (
          <Image resizeMode="stretch" source={{ uri: imageUri(comparison) }} style={[styles.image, styles.overlayImage, { opacity }]} />
        ) : null}
        {mode === 'blink' && showComparison ? (
          <Image resizeMode="stretch" source={{ uri: imageUri(comparison) }} style={[styles.image, styles.overlayImage]} />
        ) : null}
        {mode === 'swipe' ? (
          <>
            <View pointerEvents="none" style={[styles.clip, { width: frameSize.width * divider }]}>
              <Image
                resizeMode="stretch"
                source={{ uri: imageUri(comparison) }}
                style={[styles.clippedImage, { width: frameSize.width, height: frameSize.height }]}
              />
            </View>
            <View pointerEvents="none" style={[styles.divider, { left: frameSize.width * divider }]}>
              <View style={styles.dividerHandle}><MaterialCommunityIcons color={palette.accentInk} name="arrow-left-right" size={18} /></View>
            </View>
          </>
        ) : null}
        {normalizedRoi ? (
          <View
            pointerEvents="none"
            style={[
              styles.roi,
              {
                left: `${normalizedRoi.x * 100}%`,
                top: `${normalizedRoi.y * 100}%`,
                width: `${normalizedRoi.width * 100}%`,
                height: `${normalizedRoi.height * 100}%`,
              },
            ]}
          />
        ) : null}
        <View pointerEvents="none" style={styles.imageLabelRow}>
          <CaptureLabel label={`BASELINE #${baseline.sequenceNumber}`} side="left" />
          <CaptureLabel label={mode === 'blink' ? (showComparison ? `SHOWING #${comparison.sequenceNumber}` : `SHOWING #${baseline.sequenceNumber}`) : `CURRENT #${comparison.sequenceNumber}`} side="right" />
        </View>
      </View>

      {mode === 'overlay' ? (
        <Card style={styles.controlCard} title="Overlay strength">
          <View style={styles.opacityRow}>
            {[0.25, 0.5, 0.75].map((value) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: opacity === value }}
                key={value}
                onPress={() => setOpacity(value)}
                style={[styles.opacityButton, opacity === value && styles.opacityButtonActive]}
              >
                <Text style={[styles.opacityButtonText, opacity === value && styles.opacityButtonTextActive]}>{Math.round(value * 100)}%</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.controlHint}>The current capture is drawn over the baseline. Lower opacity makes old impacts easier to inspect.</Text>
        </Card>
      ) : mode === 'swipe' ? (
        <Text style={styles.controlHint}>Drag anywhere across the target to reveal the later capture over the baseline.</Text>
      ) : (
        <Text style={styles.controlHint}>Alternates every 0.7 seconds so subtle new changes are easier to spot.</Text>
      )}

      <Card style={styles.captureCard} title="Compared originals">
        <CaptureMetadata capture={baseline} label="Baseline" />
        <CaptureMetadata capture={comparison} label="Current" />
      </Card>
      <View style={styles.note}>
        <MaterialCommunityIcons color={palette.textDim} name="information-outline" size={18} />
        <Text style={styles.noteText}>{isSameDimensions ? 'These captures have matching pixel dimensions.' : 'These captures have different pixel dimensions.'} {normalizedRoi ? 'The locked target area is outlined. ' : ''}This review uses screen alignment only; perspective correction and automatic image registration are kept separate from the original files.</Text>
      </View>
      <Button compact icon="image-search-outline" label="Review current capture" onPress={() => navigation.navigate('CaptureDetail', { captureId: comparison.id })} variant="ghost" />
    </Screen>
  );
}

function ModeButton({ active, icon, label, onPress }: { readonly active: boolean; readonly icon: keyof typeof MaterialCommunityIcons.glyphMap; readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <MaterialCommunityIcons color={active ? palette.accentInk : palette.textMuted} name={icon} size={20} />
      <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function CaptureLabel({ label, side }: { readonly label: string; readonly side: 'left' | 'right' }) {
  return <View style={[styles.captureLabel, side === 'right' && styles.captureLabelRight]}><Text style={styles.captureLabelText}>{label}</Text></View>;
}

function CaptureMetadata({ capture, label }: { readonly capture: Capture; readonly label: string }) {
  return (
    <View style={styles.metadataRow}>
      <View><Text style={styles.metadataLabel}>{label}</Text><Text style={styles.metadataValue}>#{capture.sequenceNumber} · {capture.widthPixels} × {capture.heightPixels}</Text></View>
      <StatusPill label={formatTime(capture.capturedAt)} tone="neutral" />
    </View>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function clamp(value: number): number {
  return Math.max(0.04, Math.min(0.96, value));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  modeRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  modeButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface },
  modeButtonActive: { borderColor: palette.accent, backgroundColor: palette.accent },
  modeLabel: { ...typography.label, color: palette.textMuted },
  modeLabelActive: { color: palette.accentInk },
  imageFrame: { width: '100%', overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.black },
  image: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  overlayImage: { zIndex: 1 },
  clip: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden', zIndex: 2 },
  clippedImage: { position: 'absolute', top: 0, left: 0 },
  divider: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, zIndex: 3, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  dividerHandle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent, borderWidth: 2, borderColor: palette.accentInk },
  roi: { position: 'absolute', zIndex: 4, borderWidth: 2, borderColor: palette.accent, backgroundColor: 'rgba(232, 184, 75, 0.06)' },
  imageLabelRow: { position: 'absolute', zIndex: 5, left: spacing.xs, right: spacing.xs, bottom: spacing.xs, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  captureLabel: { maxWidth: '52%', borderRadius: radius.sm, backgroundColor: 'rgba(0,0,0,0.72)', paddingVertical: 4, paddingHorizontal: spacing.xs },
  captureLabelRight: { marginLeft: 'auto' },
  captureLabelText: { ...typography.caption, color: palette.white, fontSize: 10 },
  controlCard: { marginTop: spacing.md },
  opacityRow: { flexDirection: 'row', gap: spacing.xs },
  opacityButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.sm, borderColor: palette.border, backgroundColor: palette.surfaceRaised },
  opacityButtonActive: { borderColor: palette.accent, backgroundColor: '#302511' },
  opacityButtonText: { ...typography.label, color: palette.textMuted },
  opacityButtonTextActive: { color: palette.accent },
  controlHint: { ...typography.caption, color: palette.textMuted, marginTop: spacing.sm },
  captureCard: { marginTop: spacing.lg, gap: spacing.sm },
  metadataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  metadataLabel: { ...typography.label, color: palette.text },
  metadataValue: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  note: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start', marginTop: spacing.md },
  noteText: { ...typography.caption, color: palette.textDim, flex: 1 },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
});
