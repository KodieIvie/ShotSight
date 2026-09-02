import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useShotSight } from '../../application/ShotSightProvider';
import type { Shot, ShotGroup } from '../../domain';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { StatusPill } from '../components/StatusPill';
import { ShotPlaybackCanvas } from '../components/ShotPlaybackCanvas';
import { palette, radius, spacing, typography } from '../theme';
import {
  selectRangeReviewShots,
  shotsAtPlaybackPosition,
  shotsForTargetBaseline,
} from './rangeReviewUtils';

const PLAYBACK_SPEEDS_MS = [350, 650, 1_000] as const;

/**
 * Local, visual-only range review. It never changes shots, groups, captures,
 * or analysis records; it only replays the confirmed data already on device.
 */
export function TargetPlaybackScreen() {
  const { activeSession, activeTarget, captures, groups, shots } = useShotSight();
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showShotNumbers, setShowShotNumbers] = useState(true);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);

  const baseline = useMemo(
    () => captures.find((capture) => capture.id === activeTarget?.baseline?.captureId),
    [activeTarget?.baseline?.captureId, captures],
  );
  const targetShots = useMemo(
    () => shotsForTargetBaseline(
      shots,
      activeTarget?.id,
      activeTarget?.baseline?.revision,
    ),
    [activeTarget?.baseline?.revision, activeTarget?.id, shots],
  );
  const targetGroups = useMemo(
    () => groups.filter((group) => group.targetId === activeTarget?.id),
    [activeTarget?.id, groups],
  );
  const selectedGroup = useMemo(
    () => targetGroups.find((group) => group.id === selectedGroupId),
    [selectedGroupId, targetGroups],
  );
  const reviewShots = useMemo(
    () => selectRangeReviewShots(targetShots, selectedGroup, includeExcluded),
    [includeExcluded, selectedGroup, targetShots],
  );
  const displayedShots = useMemo(
    () => shotsAtPlaybackPosition(reviewShots, position),
    [position, reviewShots],
  );
  const activeShot = displayedShots[displayedShots.length - 1];

  useEffect(() => {
    if (selectedGroupId !== 'all' && !targetGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId('all');
    }
  }, [selectedGroupId, targetGroups]);

  useEffect(() => {
    setPosition((current) => Math.min(current, reviewShots.length));
  }, [reviewShots.length]);

  useEffect(() => {
    setIsPlaying(false);
    setPosition(0);
  }, [includeExcluded, selectedGroupId]);

  useEffect(() => {
    if (!isPlaying || reviewShots.length === 0) return undefined;
    const timer = setInterval(() => {
      setPosition((current) => {
        const next = Math.min(reviewShots.length, current + 1);
        if (next >= reviewShots.length) setIsPlaying(false);
        return next;
      });
    }, PLAYBACK_SPEEDS_MS[speedIndex]);
    return () => clearInterval(timer);
  }, [isPlaying, reviewShots.length, speedIndex]);

  const selectGroup = (nextId: string): void => {
    setSelectedGroupId(nextId);
  };

  const step = (amount: number): void => {
    setIsPlaying(false);
    setPosition((current) => Math.max(0, Math.min(reviewShots.length, current + amount)));
  };

  const togglePlayback = (): void => {
    if (!reviewShots.length) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (position >= reviewShots.length) setPosition(0);
    setIsPlaying(true);
  };

  const cycleSpeed = (): void => {
    setSpeedIndex((current) => (current + 1) % PLAYBACK_SPEEDS_MS.length);
  };

  if (!activeSession || !activeTarget || !baseline) {
    return (
      <Screen>
        <Card style={styles.empty}>
          <MaterialCommunityIcons color={palette.accent} name="play-circle-outline" size={48} />
          <Text style={styles.emptyTitle}>Set a clean target baseline first</Text>
          <Text style={styles.emptyCopy}>Playback uses that original as the stable surface for confirmed impacts. It stays local and does not alter your session.</Text>
        </Card>
      </Screen>
    );
  }

  const groupLabel = selectedGroup?.label ?? 'All confirmed shots';
  const progress = reviewShots.length ? position / reviewShots.length : 0;

  return (
    <Screen>
      <Text style={styles.title}>Shot sequence</Text>
      <Text style={styles.subtitle}>Replay confirmed impacts on baseline v{activeTarget.baseline?.revision ?? 1}. A target reset starts a fresh visual timeline.</Text>

      <ScrollView
        contentContainerStyle={styles.groupChips}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <GroupChip active={selectedGroupId === 'all'} label="All shots" onPress={() => selectGroup('all')} />
        {targetGroups.map((group) => (
          <GroupChip
            active={group.id === selectedGroupId}
            color={group.color}
            key={group.id}
            label={group.label}
            onPress={() => selectGroup(group.id)}
          />
        ))}
      </ScrollView>

      <ShotPlaybackCanvas
        activeShotId={activeShot?.id}
        heightPixels={baseline.heightPixels}
        imageUri={baseline.previewImageUri ?? baseline.originalImageUri}
        overlayColor={selectedGroup?.color}
        shots={displayedShots}
        showHeatmap={showHeatmap}
        showShotNumbers={showShotNumbers}
        widthPixels={baseline.widthPixels}
      />

      <View style={styles.timelineHeader}>
        <View>
          <Text style={styles.timelineTitle}>{groupLabel}</Text>
          <Text style={styles.timelineMeta}>{position} of {reviewShots.length} impact{reviewShots.length === 1 ? '' : 's'} shown</Text>
        </View>
        {activeShot ? <ShotStatus shot={activeShot} /> : <StatusPill label="Baseline" tone="neutral" />}
      </View>
      <View accessibilityLabel={`Playback progress ${position} of ${reviewShots.length}`} style={styles.track}>
        <View style={[styles.progress, { width: `${progress * 100}%` }]} />
      </View>

      <View style={styles.playbackControls}>
        <Button compact disabled={position === 0} icon="skip-previous" label="Back" onPress={() => step(-1)} style={styles.control} variant="ghost" />
        <Button compact disabled={reviewShots.length === 0} icon={isPlaying ? 'pause' : 'play'} label={isPlaying ? 'Pause' : position >= reviewShots.length ? 'Replay' : 'Play'} onPress={togglePlayback} style={styles.playControl} />
        <Button compact disabled={position >= reviewShots.length} icon="skip-next" label="Next" onPress={() => step(1)} style={styles.control} variant="ghost" />
      </View>
      <View style={styles.secondaryControls}>
        <Button compact icon="speedometer" label={`${(1_000 / PLAYBACK_SPEEDS_MS[speedIndex]).toFixed(1)}×`} onPress={cycleSpeed} style={styles.secondaryControl} variant="secondary" />
        <Button compact icon={showHeatmap ? 'blur' : 'blur-off'} label={showHeatmap ? 'Heatmap on' : 'Heatmap off'} onPress={() => setShowHeatmap((current) => !current)} style={styles.secondaryControl} variant="secondary" />
      </View>
      <View style={styles.secondaryControls}>
        <Button compact icon={showShotNumbers ? 'numeric' : 'numeric-off'} label={showShotNumbers ? 'Numbers on' : 'Numbers off'} onPress={() => setShowShotNumbers((current) => !current)} style={styles.secondaryControl} variant="ghost" />
        <Button compact icon={includeExcluded ? 'eye-outline' : 'eye-off-outline'} label={includeExcluded ? 'Including excluded' : 'Hide excluded'} onPress={() => setIncludeExcluded((current) => !current)} style={styles.secondaryControl} variant="ghost" />
      </View>

      <Card style={styles.explainer} title={showHeatmap ? 'Density overlay' : 'Visual review'}>
        <Text style={styles.explainerText}>{showHeatmap ? 'The translucent grid grows brighter where more currently replayed impacts land. It uses confirmed points only and does not change group statistics.' : 'Tap Play to watch shot markers appear in order. Select a group to replay only its saved members; flyer and per-group exclusions are hidden by default.'}</Text>
      </Card>
      <Text style={styles.reference}>Baseline capture #{baseline.sequenceNumber} · {baseline.widthPixels} × {baseline.heightPixels} px · local only</Text>
    </Screen>
  );
}

function GroupChip({ active, color, label, onPress }: {
  readonly active: boolean;
  readonly color?: string;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const swatch = validColor(color) ? color : palette.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.groupChip, active && styles.groupChipActive]}
    >
      {color ? <View style={[styles.groupSwatch, { backgroundColor: swatch }]} /> : null}
      <Text numberOfLines={1} style={[styles.groupChipText, active && styles.groupChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ShotStatus({ shot }: { readonly shot: Shot }) {
  if (shot.isColdBore) return <StatusPill label={`#${shot.number} cold bore`} tone="info" />;
  if (shot.isFlyer) return <StatusPill label={`#${shot.number} flyer`} tone="warning" />;
  return <StatusPill label={`Shot #${shot.number}`} tone="success" />;
}

function validColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{3,8}$/iu.test(value));
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: palette.text },
  subtitle: { ...typography.body, color: palette.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  groupChips: { gap: spacing.xs, paddingBottom: spacing.md, paddingRight: spacing.md },
  groupChip: { alignItems: 'center', borderColor: palette.border, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, maxWidth: 160, minHeight: 38, paddingHorizontal: spacing.sm, backgroundColor: palette.surface },
  groupChipActive: { backgroundColor: '#302511', borderColor: palette.accent },
  groupChipText: { ...typography.caption, color: palette.textMuted, flexShrink: 1 },
  groupChipTextActive: { color: palette.accent },
  groupSwatch: { width: 8, height: 8, borderRadius: 4 },
  timelineHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  timelineTitle: { ...typography.label, color: palette.text },
  timelineMeta: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xxs },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: palette.surfaceRaised, marginTop: spacing.sm },
  progress: { height: '100%', borderRadius: radius.pill, backgroundColor: palette.accent },
  playbackControls: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  control: { flex: 1 },
  playControl: { flex: 1.22 },
  secondaryControls: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondaryControl: { flex: 1 },
  explainer: { marginTop: spacing.lg },
  explainerText: { ...typography.body, color: palette.textMuted },
  reference: { ...typography.caption, color: palette.textDim, marginTop: spacing.lg, textAlign: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptyCopy: { ...typography.body, color: palette.textMuted, textAlign: 'center' },
});
