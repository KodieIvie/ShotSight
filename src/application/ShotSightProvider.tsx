import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import {
  deduplicateShotCandidates,
  captureToBaselineTransform,
  isPointWithinCapture,
  composeTransforms,
  invertTransform,
  mapPointThroughTransform,
  type AnalysisCandidate,
  type AnalysisImage,
  type AnalysisJob,
  type AnalysisReferenceMode,
  type AnalysisSensitivity,
  type CameraProfile,
  type CoordinateTransform,
  type CameraConnectionState,
  type Capture,
  createKnownLineCalibration,
  createCameraProfile,
  createManualCalibration,
  createTarget as createSessionTarget,
  parseOfflineTargetSystemPairingPayload,
  type PixelPoint,
  type PixelRect,
  type OfflineTargetSystemPairingPayload,
  type Session,
  type Shot,
  type ShotCandidate,
  type ShotGroup,
  type ShotGroupMembership,
  type Target,
  type TargetCalibration,
  type TargetRoi,
  type TargetSystemStatusSnapshot,
  validateOfflineTargetSystemPairingPayload,
} from '../domain';
import {
  CameraAdapterRegistry,
  CameraProfileStore,
  type CameraCredentials,
  HttpSnapshotService,
  LocalImageAnalysisService,
  normalizeCameraHost,
  preferredRtspCandidate,
  REOLINK_RLC_520A_PRESET_ID,
  reolinkRlc520aProfileDefaults,
  SecureStoreCredentialVault,
  LocalSessionCsvExportService,
  NoHardwareTargetSystemGateway,
  OnvifDeviceProbe,
  type OnvifProbeReport,
  shotSightDatabase,
  type SessionCsvExportResult,
  createShotSightRepositories,
  type SnapshotProbeReport,
} from '../infrastructure';

const ACTIVE_CAMERA_KEY = 'active-camera-id';
const ACTIVE_SESSION_KEY = 'active-session-id';
const ACTIVE_TARGET_KEY_PREFIX = 'active-target-id';
const AUTO_FOCUS_NEWEST_SHOT_KEY = 'auto-focus-newest-shot';
const TARGET_SYSTEM_PAIRING_KEY = 'target-system-pairing-v1';

const repositories = createShotSightRepositories(shotSightDatabase);
const credentialVault = new SecureStoreCredentialVault();
const cameraStore = new CameraProfileStore(repositories.cameras, credentialVault);
const cameraAdapters = new CameraAdapterRegistry();
const snapshotService = new HttpSnapshotService();
const imageAnalysisService = new LocalImageAnalysisService();
const sessionCsvExportService = new LocalSessionCsvExportService();
const onvifDeviceProbe = new OnvifDeviceProbe();
const targetSystemGateway = new NoHardwareTargetSystemGateway();

export type CameraKind = 'reolink-rlc-520a' | 'generic-rtsp';

export interface CameraSetupInput {
  readonly kind: CameraKind;
  readonly name: string;
  readonly host: string;
  readonly username?: string;
  readonly password?: string;
  readonly mainRtspUrl?: string;
  readonly subRtspUrl?: string;
  readonly snapshotUrl?: string;
  readonly onvifEnabled?: boolean;
  readonly onvifPort?: number;
  readonly onvifProtocol?: 'http' | 'https';
  readonly targetDistanceYards?: number;
  readonly cameraToTargetDistanceYards?: number;
}

export interface SessionSetupInput {
  readonly title: string;
  readonly rangeName?: string;
  readonly targetDistanceYards: number;
  readonly targetType: Session['targetType'];
  readonly caliberName?: string;
  readonly bulletDiameterInches?: number;
  readonly firearmName?: string;
  readonly ammunitionName?: string;
  readonly notes?: string;
}

/** Adds another independently baselined physical target to the active session. */
export interface TargetSetupInput {
  readonly name: string;
  readonly type?: Target['type'];
}

export interface CameraTestResult {
  readonly profile: CameraProfile;
  readonly report: SnapshotProbeReport;
}

export interface SaveShotGroupInput {
  /** Omit this value to create a new named group. */
  readonly id?: string;
  readonly label: string;
  readonly color?: string;
  /** Preserves per-group statistic exclusions when supplied. */
  readonly members?: readonly ShotGroupMembership[];
  /** Convenience form for groups where every selected shot is included. */
  readonly memberShotIds?: readonly string[];
}

/** Rectangle values are fractions of the chosen original image dimensions. */
export interface NormalizedTargetRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type TargetReferencePointKind = 'point-of-aim' | 'desired-zero';
export type AnalysisSearchMode = 'standard' | 'aggressive';

export interface AnalysisRunResult {
  readonly jobId: string;
  readonly captureId: string;
  readonly referenceCaptureId: string;
  readonly candidates: readonly AnalysisCandidate[];
  readonly registrationConfidence: number;
  readonly elapsedMs: number;
}

/** Secrets are kept internal to the provider and never exposed through the UI context. */
interface ResolvedCamera {
  readonly profile: CameraProfile;
  readonly credentials?: CameraCredentials;
}

interface ActiveCamera {
  readonly profile: CameraProfile;
}

interface ShotSightContextValue {
  readonly ready: boolean;
  readonly error?: string;
  readonly cameras: readonly CameraProfile[];
  readonly activeCamera?: ActiveCamera;
  /** Ephemeral authenticated RTSP URL. Never persisted or shown in diagnostics. */
  readonly liveStreamUri?: string;
  /** Credential-safe RTSP endpoint for UI diagnostics. */
  readonly liveStreamEndpoint?: string;
  readonly connectionLatencyMs?: number;
  readonly connectionState: CameraConnectionState;
  /** Credential-free local QR pairing metadata, if a commercial target system is paired. */
  readonly targetSystemPairing?: OfflineTargetSystemPairingPayload;
  /** Latest safe hardware-gateway status. The default gateway explicitly reports no hardware. */
  readonly targetSystemStatus?: TargetSystemStatusSnapshot;
  readonly sessions: readonly Session[];
  readonly activeSession?: Session;
  /** Every physical target in the active session, ordered by creation time. */
  readonly targets: readonly Target[];
  readonly activeTarget?: Target;
  /** The next immutable session-wide shot number; active lists remain target-scoped. */
  readonly nextShotNumber: number;
  readonly captures: readonly Capture[];
  readonly shots: readonly Shot[];
  readonly groups: readonly ShotGroup[];
  readonly analysisCandidates: readonly AnalysisCandidate[];
  /** Opens the review/focus surface after an automatic analysis finds a candidate. */
  readonly autoFocusNewestShot: boolean;
  readonly busyOperation?: 'saving-camera' | 'testing-camera' | 'creating-session' | 'capturing' | 'analyzing' | 'exporting' | 'updating';
  refresh: () => Promise<void>;
  setAutoFocusNewestShot: (enabled: boolean) => Promise<void>;
  /** Builds a private local CSV; share is always an explicit caller action. */
  exportActiveSessionCsv: (share?: boolean) => Promise<SessionCsvExportResult>;
  saveCamera: (input: CameraSetupInput) => Promise<CameraProfile>;
  testCamera: (input: CameraSetupInput) => Promise<CameraTestResult>;
  testActiveCamera: () => Promise<SnapshotProbeReport>;
  /** Probes only the selected camera's local ONVIF Device service. */
  testActiveOnvif: () => Promise<OnvifProbeReport>;
  /** Parses and persists a credential-free versioned offline QR payload. */
  pairTargetSystem: (rawPayload: string) => Promise<OfflineTargetSystemPairingPayload>;
  clearTargetSystemPairing: () => Promise<void>;
  refreshTargetSystemStatus: () => Promise<TargetSystemStatusSnapshot>;
  selectCamera: (cameraId: string) => Promise<void>;
  removeCamera: (cameraId: string) => Promise<void>;
  reportConnection: (state: CameraConnectionState, latencyMs?: number) => void;
  createSession: (input: SessionSetupInput) => Promise<Session>;
  selectSession: (sessionId: string) => Promise<void>;
  createTarget: (input: TargetSetupInput) => Promise<Target>;
  selectTarget: (targetId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  captureCurrentTarget: () => Promise<Capture>;
  establishBaseline: (captureId: string, reset?: boolean) => Promise<Target>;
  addManualShot: (captureId: string, normalizedPosition: { readonly x: number; readonly y: number }) => Promise<Shot>;
  setShotFlyer: (shotId: string, isFlyer: boolean) => Promise<void>;
  analyzeCapture: (captureId: string, mode?: AnalysisSearchMode) => Promise<AnalysisRunResult>;
  confirmAnalysisCandidate: (candidateId: string) => Promise<Shot>;
  rejectAnalysisCandidate: (candidateId: string, reason?: string) => Promise<void>;
  /** Designates the session's single cold-bore shot, or clears the designation. */
  setColdBore: (shotId?: string) => Promise<void>;
  saveShotGroup: (input: SaveShotGroupInput) => Promise<ShotGroup>;
  removeShotGroup: (groupId: string) => Promise<void>;
  /** Persists a full-resolution registered ROI. */
  saveTargetRoi: (roi?: TargetRoi) => Promise<Target>;
  /** Convenience form for a rectangular ROI drawn in normalized image space. */
  setTargetRoi: (normalizedRect?: NormalizedTargetRectangle) => Promise<Target>;
  saveCalibration: (calibration: TargetCalibration) => Promise<Target>;
  saveManualCalibration: (pixelsPerInchX: number, pixelsPerInchY?: number) => Promise<Target>;
  saveKnownLineCalibration: (
    normalizedStart: PixelPoint,
    normalizedEnd: PixelPoint,
    knownLengthInches: number,
  ) => Promise<Target>;
  setTargetReferencePoint: (
    kind: TargetReferencePointKind,
    normalizedPosition?: PixelPoint,
  ) => Promise<Target>;
  setPointOfAim: (normalizedPosition?: PixelPoint) => Promise<Target>;
  setDesiredZeroPoint: (normalizedPosition?: PixelPoint) => Promise<Target>;
}

const ShotSightContext = createContext<ShotSightContextValue | null>(null);

export function ShotSightProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [cameras, setCameras] = useState<readonly CameraProfile[]>([]);
  const [resolvedCamera, setResolvedCamera] = useState<ResolvedCamera>();
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session>();
  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [activeTarget, setActiveTarget] = useState<Target>();
  const [nextShotNumber, setNextShotNumber] = useState(1);
  const [captures, setCaptures] = useState<readonly Capture[]>([]);
  const [shots, setShots] = useState<readonly Shot[]>([]);
  const [groups, setGroups] = useState<readonly ShotGroup[]>([]);
  const [analysisCandidates, setAnalysisCandidates] = useState<readonly AnalysisCandidate[]>([]);
  const [autoFocusNewestShot, setAutoFocusNewestShotState] = useState(true);
  const [connectionLatencyMs, setConnectionLatencyMs] = useState<number>();
  const [connectionState, setConnectionState] = useState<CameraConnectionState>('disconnected');
  const [targetSystemPairing, setTargetSystemPairing] = useState<OfflineTargetSystemPairingPayload>();
  const [targetSystemStatus, setTargetSystemStatus] = useState<TargetSystemStatusSnapshot>();
  const [busyOperation, setBusyOperation] = useState<ShotSightContextValue['busyOperation']>();

  const loadSessionWorkspace = useCallback(async (sessionId: string, preferredTargetId?: string | null) => {
    const session = await repositories.sessions.findById(sessionId);
    if (!session) {
      setActiveSession(undefined);
      setTargets([]);
      setActiveTarget(undefined);
      setNextShotNumber(1);
      setCaptures([]);
      setShots([]);
      setGroups([]);
      setAnalysisCandidates([]);
      return;
    }
    const targets = await repositories.targets.listForSession(session.id);
    const savedTargetId = preferredTargetId
      ?? (await repositories.settings.get<string>(activeTargetSettingKey(session.id)));
    const target = targets.find((candidate) => candidate.id === savedTargetId) ?? targets[0];
    const [loadedCaptures, loadedShots, loadedGroups, loadedCandidates, sessionShots] = await Promise.all([
      target
        ? repositories.captures.listForTarget(target.id)
        : Promise.resolve<readonly Capture[]>([]),
      target
        ? repositories.shots.listForTarget(target.id)
        : Promise.resolve<readonly Shot[]>([]),
      target
        ? repositories.groups.listForTarget(target.id)
        : Promise.resolve<readonly ShotGroup[]>([]),
      target
        ? repositories.analysis.listCandidatesForTarget(target.id)
        : Promise.resolve<readonly AnalysisCandidate[]>([]),
      repositories.shots.listForSession(session.id),
    ]);
    setActiveSession(session);
    setTargets(targets);
    setActiveTarget(target);
    setNextShotNumber(sessionShots.reduce((maximum, shot) => Math.max(maximum, shot.number), 0) + 1);
    setCaptures(loadedCaptures);
    setShots(loadedShots);
    setGroups(loadedGroups);
    setAnalysisCandidates(loadedCandidates);
    if (target) {
      await repositories.settings.set(activeTargetSettingKey(session.id), target.id);
    }
  }, []);

  const selectCamera = useCallback(async (cameraId: string) => {
    const resolved = await cameraStore.findById(cameraId);
    if (!resolved) {
      throw new Error('That camera profile no longer exists.');
    }
    setResolvedCamera({ profile: resolved.profile, credentials: resolved.credentials });
    await repositories.settings.set(ACTIVE_CAMERA_KEY, cameraId);
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    await loadSessionWorkspace(sessionId);
    await repositories.settings.set(ACTIVE_SESSION_KEY, sessionId);
  }, [loadSessionWorkspace]);

  const selectTarget = useCallback(async (targetId: string): Promise<void> => {
    if (!activeSession) {
      throw new Error('Open a range session before switching targets.');
    }
    const target = await repositories.targets.findById(targetId);
    if (!target || target.sessionId !== activeSession.id) {
      throw new Error('That target is not available in the active session.');
    }
    setBusyOperation('updating');
    try {
      await loadSessionWorkspace(activeSession.id, target.id);
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, loadSessionWorkspace]);

  const refresh = useCallback(async () => {
    try {
      const [profiles, listedSessions, savedAutoFocusNewestShot, savedTargetSystemPairing] = await Promise.all([
        cameraStore.list(),
        repositories.sessions.list(),
        repositories.settings.get<boolean>(AUTO_FOCUS_NEWEST_SHOT_KEY),
        loadTargetSystemPairing(),
      ]);
      setCameras(profiles);
      setSessions(listedSessions);
      setAutoFocusNewestShotState(savedAutoFocusNewestShot !== false);
      setTargetSystemPairing(savedTargetSystemPairing);
      setTargetSystemStatus(
        savedTargetSystemPairing
          ? await targetSystemGateway.getStatus(savedTargetSystemPairing)
          : undefined,
      );
      if (resolvedCamera && !profiles.some((profile) => profile.id === resolvedCamera.profile.id)) {
        setResolvedCamera(undefined);
      }
      if (activeSession) {
        await loadSessionWorkspace(activeSession.id, activeTarget?.id);
      }
      setError(undefined);
      setReady(true);
    } catch (caught) {
      setError(safeError(caught));
    }
  }, [resolvedCamera, activeSession, activeTarget, loadSessionWorkspace]);

  useEffect(() => {
    let mounted = true;
    const boot = async (): Promise<void> => {
      try {
        await shotSightDatabase.open();
        const [profiles, listedSessions, savedCameraId, savedSessionId, savedAutoFocusNewestShot, savedTargetSystemPairing] = await Promise.all([
          cameraStore.list(),
          repositories.sessions.list(),
          repositories.settings.get<string>(ACTIVE_CAMERA_KEY),
          repositories.settings.get<string>(ACTIVE_SESSION_KEY),
          repositories.settings.get<boolean>(AUTO_FOCUS_NEWEST_SHOT_KEY),
          loadTargetSystemPairing(),
        ]);
        if (!mounted) return;
        setCameras(profiles);
        setSessions(listedSessions);
        setAutoFocusNewestShotState(savedAutoFocusNewestShot !== false);
        setTargetSystemPairing(savedTargetSystemPairing);
        setTargetSystemStatus(
          savedTargetSystemPairing
            ? await targetSystemGateway.getStatus(savedTargetSystemPairing)
            : undefined,
        );
        const initialCamera = profiles.find((profile) => profile.id === savedCameraId) ?? profiles[0];
        if (initialCamera) {
          const resolved = await cameraStore.resolve(initialCamera);
          if (mounted) setResolvedCamera({ profile: resolved.profile, credentials: resolved.credentials });
        }
        const initialSession = listedSessions.find((session) => session.id === savedSessionId) ?? listedSessions.find((session) => session.status === 'active');
        if (initialSession && mounted) {
          await loadSessionWorkspace(initialSession.id);
        }
        if (mounted) setReady(true);
      } catch (caught) {
        if (mounted) setError(safeError(caught));
      }
    };
    void boot();
    return () => {
      mounted = false;
    };
  }, [loadSessionWorkspace]);

  const setAutoFocusNewestShot = useCallback(async (enabled: boolean): Promise<void> => {
    await repositories.settings.set(AUTO_FOCUS_NEWEST_SHOT_KEY, enabled);
    setAutoFocusNewestShotState(enabled);
  }, []);

  const pairTargetSystem = useCallback(async (
    rawPayload: string,
  ): Promise<OfflineTargetSystemPairingPayload> => {
    const pairing = parseOfflineTargetSystemPairingPayload(rawPayload);
    setBusyOperation('updating');
    try {
      await repositories.settings.set(TARGET_SYSTEM_PAIRING_KEY, pairing);
      setTargetSystemPairing(pairing);
      setTargetSystemStatus(await targetSystemGateway.getStatus(pairing));
      return pairing;
    } finally {
      setBusyOperation(undefined);
    }
  }, []);

  const clearTargetSystemPairing = useCallback(async (): Promise<void> => {
    setBusyOperation('updating');
    try {
      await repositories.settings.remove(TARGET_SYSTEM_PAIRING_KEY);
      setTargetSystemPairing(undefined);
      setTargetSystemStatus(undefined);
    } finally {
      setBusyOperation(undefined);
    }
  }, []);

  const refreshTargetSystemStatus = useCallback(async (): Promise<TargetSystemStatusSnapshot> => {
    if (!targetSystemPairing) {
      throw new Error('Pair a target system before refreshing its hardware status.');
    }
    setBusyOperation('updating');
    try {
      const status = await targetSystemGateway.getStatus(targetSystemPairing);
      setTargetSystemStatus(status);
      return status;
    } finally {
      setBusyOperation(undefined);
    }
  }, [targetSystemPairing]);

  const exportActiveSessionCsv = useCallback(async (
    share = true,
  ): Promise<SessionCsvExportResult> => {
    if (!activeSession) {
      throw new Error('Open a range session before exporting its CSV.');
    }
    setBusyOperation('exporting');
    try {
      const [targets, sessionShots, sessionGroups] = await Promise.all([
        repositories.targets.listForSession(activeSession.id),
        repositories.shots.listForSession(activeSession.id),
        repositories.groups.listForSession(activeSession.id),
      ]);
      const input = Object.freeze({
        session: activeSession,
        targets,
        shots: sessionShots,
        groups: sessionGroups,
        exportedAt: new Date().toISOString(),
      });
      return share
        ? await sessionCsvExportService.saveAndShare(input)
        : await sessionCsvExportService.save(input);
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession]);

  const saveCamera = useCallback(async (input: CameraSetupInput): Promise<CameraProfile> => {
    setBusyOperation('saving-camera');
    try {
      const id = Crypto.randomUUID();
      const { profile, credentials } = buildCameraProfile(input, id);
      const saved = await cameraStore.save(profile, credentials);
      const listed = await cameraStore.list();
      setCameras(listed);
      await selectCamera(saved.id);
      return saved;
    } finally {
      setBusyOperation(undefined);
    }
  }, [selectCamera]);

  const testCamera = useCallback(async (input: CameraSetupInput): Promise<CameraTestResult> => {
    setBusyOperation('testing-camera');
    try {
      const { profile, credentials } = buildCameraProfile(input, Crypto.randomUUID());
      const adapter = cameraAdapters.forProfile(profile);
      const report = await snapshotService.probe(adapter, { profile, credentials });
      return { profile, report };
    } finally {
      setBusyOperation(undefined);
    }
  }, []);

  const testActiveCamera = useCallback(async (): Promise<SnapshotProbeReport> => {
    if (!resolvedCamera) throw new Error('Select a camera before running diagnostics.');
    setBusyOperation('testing-camera');
    try {
      const adapter = cameraAdapters.forProfile(resolvedCamera.profile);
      return await snapshotService.probe(adapter, resolvedCamera);
    } finally {
      setBusyOperation(undefined);
    }
  }, [resolvedCamera]);

  const testActiveOnvif = useCallback(async (): Promise<OnvifProbeReport> => {
    if (!resolvedCamera) throw new Error('Select a camera before running an ONVIF probe.');
    if (!resolvedCamera.profile.onvif.enabled) {
      throw new Error('Enable ONVIF in this camera profile before running a probe.');
    }
    setBusyOperation('testing-camera');
    try {
      return await onvifDeviceProbe.probe({
        endpoint: {
          host: resolvedCamera.profile.host,
          port: resolvedCamera.profile.onvif.port,
          protocol: resolvedCamera.profile.onvif.protocol ?? 'http',
        },
        credentials: resolvedCamera.credentials,
      });
    } finally {
      setBusyOperation(undefined);
    }
  }, [resolvedCamera]);

  const removeCamera = useCallback(async (cameraId: string): Promise<void> => {
    setBusyOperation('updating');
    try {
      const hasSessions = sessions.some((session) => session.cameraProfileId === cameraId);
      if (hasSessions) {
        throw new Error('Archive or delete the sessions that use this camera before removing it.');
      }
      await cameraStore.remove(cameraId);
      const listed = await cameraStore.list();
      setCameras(listed);
      if (resolvedCamera?.profile.id === cameraId) {
        const next = listed[0];
        setResolvedCamera(undefined);
        if (next) await selectCamera(next.id);
      }
    } finally {
      setBusyOperation(undefined);
    }
  }, [resolvedCamera, selectCamera, sessions]);

  const createSession = useCallback(async (input: SessionSetupInput): Promise<Session> => {
    if (!resolvedCamera) throw new Error('Connect a local target camera before starting a session.');
    setBusyOperation('creating-session');
    try {
      if (!input.title.trim()) throw new Error('Give this range session a title.');
      if (!Number.isFinite(input.targetDistanceYards) || input.targetDistanceYards <= 0) {
        throw new Error('Target distance must be a positive number of yards.');
      }
      const timestamp = new Date().toISOString();
      const sessionId = Crypto.randomUUID();
      const targetId = Crypto.randomUUID();
      const session: Session = Object.freeze({
        id: sessionId,
        title: input.title.trim(),
        startedAt: timestamp,
        updatedAt: timestamp,
        rangeName: emptyToUndefined(input.rangeName),
        targetDistanceYards: input.targetDistanceYards,
        cameraProfileId: resolvedCamera.profile.id,
        targetType: input.targetType,
        caliber: input.caliberName && input.bulletDiameterInches
          ? { name: input.caliberName, bulletDiameterInches: input.bulletDiameterInches }
          : undefined,
        firearmName: emptyToUndefined(input.firearmName),
        ammunitionName: emptyToUndefined(input.ammunitionName),
        notes: emptyToUndefined(input.notes),
        status: 'active',
      });
      const target = createSessionTarget({
        id: targetId,
        sessionId,
        name: 'Target 1',
        type: input.targetType,
        createdAt: timestamp,
      });
      await repositories.sessions.upsert(session);
      await repositories.targets.create(target);
      setSessions(await repositories.sessions.list());
      await selectSession(session.id);
      return session;
    } finally {
      setBusyOperation(undefined);
    }
  }, [resolvedCamera, selectSession]);

  const createTarget = useCallback(async (input: TargetSetupInput): Promise<Target> => {
    if (!activeSession) {
      throw new Error('Open a range session before adding another target.');
    }
    const name = input.name.trim();
    if (targets.some((target) => target.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) {
      throw new Error('Choose a different target name for this session.');
    }
    setBusyOperation('updating');
    try {
      const target = createSessionTarget({
        id: Crypto.randomUUID(),
        sessionId: activeSession.id,
        name,
        type: input.type ?? activeSession.targetType,
        createdAt: new Date().toISOString(),
      });
      await repositories.targets.create(target);
      await loadSessionWorkspace(activeSession.id, target.id);
      return target;
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, loadSessionWorkspace, targets]);

  const archiveSession = useCallback(async (sessionId: string): Promise<void> => {
    setBusyOperation('updating');
    try {
      await repositories.sessions.setStatus(sessionId, 'archived', new Date().toISOString());
      const listed = await repositories.sessions.list();
      setSessions(listed);
      if (activeSession?.id === sessionId) {
        const next = listed.find((session) => session.status === 'active') ?? listed[0];
        if (next) await selectSession(next.id);
        else {
          setActiveSession(undefined);
          setTargets([]);
          setActiveTarget(undefined);
          setNextShotNumber(1);
          setCaptures([]);
          setShots([]);
          setGroups([]);
          setAnalysisCandidates([]);
        }
      }
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, selectSession]);

  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    setBusyOperation('updating');
    try {
      await repositories.sessions.remove(sessionId);
      const listed = await repositories.sessions.list();
      setSessions(listed);
      if (activeSession?.id === sessionId) {
        const next = listed.find((session) => session.status === 'active') ?? listed[0];
        if (next) await selectSession(next.id);
        else {
          setActiveSession(undefined);
          setTargets([]);
          setActiveTarget(undefined);
          setNextShotNumber(1);
          setCaptures([]);
          setShots([]);
          setGroups([]);
          setAnalysisCandidates([]);
        }
      }
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, selectSession]);

  const captureCurrentTarget = useCallback(async (): Promise<Capture> => {
    if (!resolvedCamera) throw new Error('Select a camera first.');
    if (!activeSession || !activeTarget) throw new Error('Start or resume a session before capturing.');
    setBusyOperation('capturing');
    try {
      const captureId = Crypto.randomUUID();
      const adapter = cameraAdapters.forProfile(resolvedCamera.profile);
      const snapshot = await snapshotService.capture(adapter, resolvedCamera, {
        sessionId: activeSession.id,
        captureId,
      });
      const timestamp = new Date().toISOString();
      const capture = await repositories.captures.addWithNextSequence({
        id: captureId,
        sessionId: activeSession.id,
        targetId: activeTarget.id,
        cameraProfileId: resolvedCamera.profile.id,
        baselineRevision: activeTarget.baseline?.revision ?? 1,
        capturedAt: timestamp,
        originalImageUri: snapshot.originalImageUri,
        previewImageUri: snapshot.previewImageUri,
        widthPixels: snapshot.widthPixels,
        heightPixels: snapshot.heightPixels,
        kind: activeTarget.baseline ? 'observation' : 'baseline',
        analysisStatus: 'not-requested',
        cumulativeShotCount: nextShotNumber - 1,
        cameraMetadata: {
          source: 'http-snapshot',
          latencyMs: snapshot.latencyMs,
          mimeType: snapshot.mimeType,
        },
      });
      if (!activeTarget.baseline) {
        const baseline = await repositories.targets.establishBaseline(activeTarget.id, {
          captureId: capture.id,
          establishedAt: timestamp,
          reason: 'initial',
        });
        setActiveTarget(baseline);
      }
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
      return capture;
    } finally {
      setBusyOperation(undefined);
    }
  }, [resolvedCamera, activeSession, activeTarget, loadSessionWorkspace, nextShotNumber]);

  const establishBaseline = useCallback(async (captureId: string, reset = false): Promise<Target> => {
    if (!activeSession || !activeTarget) throw new Error('Open a session before setting a baseline.');
    setBusyOperation('updating');
    try {
      const next = await repositories.targets.establishBaseline(activeTarget.id, {
        captureId,
        establishedAt: new Date().toISOString(),
        reason: reset ? 'target-reset' : 'initial',
      });
      setActiveTarget(next);
      await loadSessionWorkspace(activeSession.id, next.id);
      return next;
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, loadSessionWorkspace]);

  const addManualShot = useCallback(async (
    captureId: string,
    normalizedPosition: { readonly x: number; readonly y: number },
  ): Promise<Shot> => {
    if (!activeSession || !activeTarget) throw new Error('Open a session before marking shots.');
    const capture = captures.find((item) => item.id === captureId);
    if (!capture) throw new Error('The capture is no longer available in this session.');
    const rawPosition = Object.freeze({
      x: Math.max(0, Math.min(1, normalizedPosition.x)) * capture.widthPixels,
      y: Math.max(0, Math.min(1, normalizedPosition.y)) * capture.heightPixels,
    });
    if (!activeTarget.baseline) {
      throw new Error('Set a clean target baseline before marking an impact.');
    }
    if (capture.targetId !== activeTarget.id) {
      throw new Error('That capture belongs to a different target.');
    }
    if (capture.baselineRevision !== activeTarget.baseline.revision) {
      throw new Error('That capture belongs to an older target baseline. Mark impacts on a current capture instead.');
    }
    const baseline = captures.find((item) => item.id === activeTarget.baseline?.captureId);
    if (!baseline) {
      throw new Error('The current clean baseline is not available locally. Capture a new baseline before marking impacts.');
    }
    // Observations need a verified persisted registration before their tapped
    // pixel is treated as a clean-baseline coordinate. Baseline taps are
    // already in that coordinate space.
    const captureToBaseline = capture.id === baseline.id
      ? undefined
      : captureToBaselineTransform(capture, baseline);
    if (capture.id !== baseline.id && !captureToBaseline) {
      throw new Error('Run Detect or Search hard on this capture first so it can be registered to the clean baseline before you mark an impact.');
    }
    const position = captureToBaseline
      ? mapPointThroughTransform(rawPosition, captureToBaseline)
      : rawPosition;
    if (!isPointWithinCapture(position, baseline)) {
      throw new Error('That impact maps outside the clean baseline. Reframe the target or capture a new baseline before marking it manually.');
    }
    setBusyOperation('updating');
    try {
      const shot = await repositories.shots.confirm({
        id: Crypto.randomUUID(),
        sessionId: activeSession.id,
        targetId: activeTarget.id,
        captureId,
        position,
        confirmedAt: new Date().toISOString(),
        baselineRevision: activeTarget.baseline?.revision ?? 1,
        source: 'manual',
        caliberDiameterInches: activeSession.caliber?.bulletDiameterInches,
      });
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
      return shot;
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, captures, loadSessionWorkspace]);

  const setShotFlyer = useCallback(async (shotId: string, isFlyer: boolean): Promise<void> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a target before changing an impact exclusion.');
    }
    const shot = shots.find((item) => item.id === shotId)
      ?? await repositories.shots.findById(shotId);
    if (!shot || shot.sessionId !== activeSession.id || shot.targetId !== activeTarget.id) {
      throw new Error('That impact is not available on the active target.');
    }
    setBusyOperation('updating');
    try {
      await repositories.shots.setFlyer(shotId, isFlyer);
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, loadSessionWorkspace, shots]);

  const analyzeCapture = useCallback(async (
    captureId: string,
    mode: AnalysisSearchMode = 'standard',
  ): Promise<AnalysisRunResult> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a target session before analyzing a capture.');
    }
    // Read durable state rather than relying on a React render between a
    // capture finishing and its automatic analysis beginning. This makes the
    // post-capture path work even though state setters have not re-rendered
    // the provider yet.
    const target = await repositories.targets.findById(activeTarget.id) ?? activeTarget;
    const allTargetCaptures = await repositories.captures.listForTarget(target.id);
    const capture = allTargetCaptures.find((item) => item.id === captureId);
    if (!capture || capture.targetId !== target.id) {
      throw new Error('That capture is not available on the active target.');
    }
    if (capture.baselineRevision !== target.baseline?.revision) {
      throw new Error('This capture belongs to an older target baseline. Select a current capture before searching for impacts.');
    }
    const targetCaptures = allTargetCaptures.filter(
      (item) => item.baselineRevision === capture.baselineRevision,
    );
    const baseline = targetCaptures.find((item) => item.id === target.baseline?.captureId);
    if (!baseline) {
      throw new Error('Set a clean baseline before searching for new impacts.');
    }
    if (capture.id === baseline.id) {
      throw new Error('Capture a later target image before running impact analysis.');
    }
    const previous = [...targetCaptures]
      .reverse()
      .find((item) => item.sequenceNumber < capture.sequenceNumber);
    const previousToBaseline = previous
      ? captureToBaselineTransform(previous, baseline)
      : undefined;
    const canUsePrevious = Boolean(
      previous
      && previous.id !== baseline.id
      && previousToBaseline,
    );
    const referenceMode: AnalysisReferenceMode = mode === 'aggressive'
      ? 'clean-baseline'
      : canUsePrevious
        ? 'hybrid'
        : 'clean-baseline';
    const referenceCapture = referenceMode === 'clean-baseline' ? baseline : previous ?? baseline;
    const referenceToBaseline = referenceCapture.id === baseline.id
      ? undefined
      : captureToBaselineTransform(referenceCapture, baseline);
    const sensitivity = analysisSensitivityFor(mode);
    const startedAt = new Date().toISOString();
    const job: AnalysisJob = Object.freeze({
      id: Crypto.randomUUID(),
      sessionId: activeSession.id,
      targetId: target.id,
      captureId: capture.id,
      referenceCaptureId: referenceCapture.id,
      baselineRevision: capture.baselineRevision,
      referenceMode,
      sensitivity,
      analyzerId: 'local-jpeg-translation',
      analyzerVersion: '1',
      status: 'processing',
      requestedAt: startedAt,
      startedAt,
    });

    setBusyOperation('analyzing');
    try {
      await repositories.analysis.upsertJob(job);
      await repositories.captures.upsert(Object.freeze({
        ...capture,
        analysisStatus: 'processing',
      }));
      const result = await imageAnalysisService.analyze({
        sessionId: activeSession.id,
        targetId: target.id,
        baselineRevision: capture.baselineRevision,
        targetType: target.type,
        referenceMode,
        cleanBaseline: asAnalysisImage(baseline),
        previous: previous ? asAnalysisImage(previous) : undefined,
        current: asAnalysisImage(capture),
        lockedRoi: referenceToBaseline
          ? mapTargetRoiToSpace(target.roi, invertTransform(referenceToBaseline))
          : target.roi,
        sensitivity,
      });
      const currentToBaseline = referenceToBaseline
        ? composeTransforms(result.registration.currentToReference, referenceToBaseline)
        : result.registration.currentToReference;
      const candidatesInBaselineSpace = referenceToBaseline
        ? mapShotCandidatesToSpace(result.candidates, referenceToBaseline)
        : result.candidates;
      const knownShots = (await repositories.shots.listForTarget(target.id)).filter(
        (shot) => shot.baselineRevision === capture.baselineRevision,
      );
      const pendingCandidates = (await repositories.analysis.listCandidatesForTarget(target.id, 'pending')).filter(
        (candidate) => candidate.baselineRevision === capture.baselineRevision,
      );
      const deduped = deduplicateShotCandidates(
        candidatesInBaselineSpace,
        [
          ...knownShots.map((shot) => ({ id: shot.id, position: shot.position })),
          ...pendingCandidates.map((candidate) => ({ id: candidate.id, position: candidate.position })),
        ],
        sensitivity.deduplicationRadiusPixels,
      );
      const completedAt = new Date().toISOString();
      const candidates: readonly AnalysisCandidate[] = Object.freeze(
        deduped.accepted.map((candidate) => Object.freeze({
          ...candidate,
          id: Crypto.randomUUID(),
          jobId: job.id,
          sessionId: activeSession.id,
          targetId: target.id,
          captureId: capture.id,
          baselineRevision: capture.baselineRevision,
          state: 'pending' as const,
          provenance: Object.freeze({
            analyzerId: job.analyzerId,
            analyzerVersion: job.analyzerVersion,
            referenceCaptureId: referenceCapture.id,
            registrationConfidence: result.registration.confidence,
            // Candidate positions are normalized to the clean baseline's
            // coordinate space, even when detection used a previous frame.
            registrationTransform: currentToBaseline,
          }),
          createdAt: completedAt,
          updatedAt: completedAt,
        })),
      );
      await repositories.analysis.upsertCandidates(candidates);
      await repositories.analysis.upsertJob(Object.freeze({
        ...job,
        status: 'completed' as const,
        completedAt,
      }));
      await repositories.captures.upsert(Object.freeze({
        ...capture,
        analysisStatus: 'completed' as const,
        newlyDetectedShotCount: candidates.length,
        targetMetadata: Object.freeze({
          ...capture.targetMetadata,
          registrationTransform: currentToBaseline,
          registrationConfidence: result.registration.confidence,
          roi: result.roi.roi,
        }),
      }));
      await loadSessionWorkspace(activeSession.id, target.id);
      return Object.freeze({
        jobId: job.id,
        captureId: capture.id,
        referenceCaptureId: referenceCapture.id,
        candidates,
        registrationConfidence: result.registration.confidence,
        elapsedMs: result.elapsedMs,
      });
    } catch (caught) {
      const completedAt = new Date().toISOString();
      const failureMessage = safeError(caught);
      try {
        await repositories.analysis.upsertJob(Object.freeze({
          ...job,
          status: 'failed' as const,
          completedAt,
          failureMessage,
        }));
        await repositories.captures.upsert(Object.freeze({
          ...capture,
          analysisStatus: 'failed' as const,
        }));
        await loadSessionWorkspace(activeSession.id, target.id);
      } catch {
        // Preserve the original analysis error; the next refresh can reconcile status.
      }
      throw caught;
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, loadSessionWorkspace]);

  const confirmAnalysisCandidate = useCallback(async (candidateId: string): Promise<Shot> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a target session before confirming an impact.');
    }
    const candidate = analysisCandidates.find((item) => item.id === candidateId)
      ?? await repositories.analysis.findCandidateById(candidateId);
    if (!candidate || candidate.targetId !== activeTarget.id || candidate.sessionId !== activeSession.id) {
      throw new Error('That proposed impact is not available on the active target.');
    }
    if (candidate.state !== 'pending') {
      throw new Error('That proposed impact has already been reviewed.');
    }
    setBusyOperation('updating');
    try {
      const shot = await repositories.shots.confirmAnalysisCandidate(candidate.id, {
        id: Crypto.randomUUID(),
        sessionId: activeSession.id,
        targetId: activeTarget.id,
        captureId: candidate.captureId,
        position: candidate.position,
        confirmedAt: new Date().toISOString(),
        baselineRevision: candidate.baselineRevision,
        source: 'automatic',
        confidence: candidate.confidence,
        caliberDiameterInches: activeSession.caliber?.bulletDiameterInches,
        note: candidate.classification,
      });
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
      return shot;
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, analysisCandidates, loadSessionWorkspace]);

  const rejectAnalysisCandidate = useCallback(async (
    candidateId: string,
    reason?: string,
  ): Promise<void> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a target session before rejecting an impact candidate.');
    }
    const candidate = analysisCandidates.find((item) => item.id === candidateId)
      ?? await repositories.analysis.findCandidateById(candidateId);
    if (!candidate || candidate.targetId !== activeTarget.id || candidate.sessionId !== activeSession.id) {
      throw new Error('That proposed impact is not available on the active target.');
    }
    setBusyOperation('updating');
    try {
      await repositories.analysis.reviewCandidate(candidate.id, {
        state: 'rejected',
        reviewedAt: new Date().toISOString(),
        rejectionReason: emptyToUndefined(reason),
      });
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, analysisCandidates, loadSessionWorkspace]);

  const setColdBore = useCallback(async (shotId?: string): Promise<void> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a session before choosing the cold-bore shot.');
    }
    if (shotId) {
      const shot = shots.find((item) => item.id === shotId)
        ?? await repositories.shots.findById(shotId);
      if (!shot || shot.sessionId !== activeSession.id || shot.targetId !== activeTarget.id) {
        throw new Error('The selected cold-bore shot is not on the active target.');
      }
    }
    setBusyOperation('updating');
    try {
      await repositories.shots.setColdBore(activeSession.id, shotId);
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, loadSessionWorkspace, shots]);

  const saveShotGroup = useCallback(async (input: SaveShotGroupInput): Promise<ShotGroup> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a session before creating a shot group.');
    }
    const label = input.label.trim();
    if (!label) throw new Error('Give the shot group a name.');
    if (input.members && input.memberShotIds) {
      throw new Error('Provide either group memberships or shot IDs, not both.');
    }
    const existing = input.id ? groups.find((group) => group.id === input.id) : undefined;
    if (input.id && !existing) {
      throw new Error('That shot group is not available on the active target.');
    }
    const members = input.members
      ? input.members.map((member) => Object.freeze({ ...member }))
      : input.memberShotIds
        ? input.memberShotIds.map((shotId) => Object.freeze({ shotId, excludeFromStatistics: false }))
        : existing?.members.map((member) => Object.freeze({ ...member })) ?? [];
    const timestamp = new Date().toISOString();
    const group: ShotGroup = Object.freeze({
      id: existing?.id ?? Crypto.randomUUID(),
      sessionId: activeSession.id,
      targetId: activeTarget.id,
      label,
      color: emptyToUndefined(input.color),
      members: Object.freeze(members),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    setBusyOperation('updating');
    try {
      await repositories.groups.upsert(group);
      const saved = await repositories.groups.findById(group.id);
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
      return saved ?? group;
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, groups, loadSessionWorkspace]);

  const removeShotGroup = useCallback(async (groupId: string): Promise<void> => {
    if (!activeSession || !activeTarget) {
      throw new Error('Open a session before editing shot groups.');
    }
    const group = groups.find((item) => item.id === groupId)
      ?? await repositories.groups.findById(groupId);
    if (!group || group.sessionId !== activeSession.id || group.targetId !== activeTarget.id) {
      throw new Error('That shot group is not available on the active target.');
    }
    setBusyOperation('updating');
    try {
      await repositories.groups.remove(groupId);
      await loadSessionWorkspace(activeSession.id, activeTarget.id);
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeSession, activeTarget, groups, loadSessionWorkspace]);

  const persistActiveTarget = useCallback(async (nextTarget: Target): Promise<Target> => {
    if (!activeSession || !activeTarget || activeTarget.id !== nextTarget.id) {
      throw new Error('Open the target before changing its setup.');
    }
    await repositories.targets.upsert(nextTarget);
    const saved = await repositories.targets.findById(nextTarget.id);
    await loadSessionWorkspace(activeSession.id, nextTarget.id);
    return saved ?? nextTarget;
  }, [activeSession, activeTarget, loadSessionWorkspace]);

  const saveTargetRoi = useCallback(async (roi?: TargetRoi): Promise<Target> => {
    if (!activeTarget) throw new Error('Open a target before setting its analysis area.');
    setBusyOperation('updating');
    try {
      return await persistActiveTarget(Object.freeze({
        ...activeTarget,
        roi: cloneTargetRoi(roi),
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeTarget, persistActiveTarget]);

  const setTargetRoi = useCallback(async (
    normalizedRect?: NormalizedTargetRectangle,
  ): Promise<Target> => {
    if (!normalizedRect) return saveTargetRoi(undefined);
    if (!activeTarget) throw new Error('Open a target before setting its analysis area.');
    const capture = findCoordinateCapture(activeTarget, captures);
    if (!capture) throw new Error('Capture a target image before drawing its analysis area.');
    return saveTargetRoi(mapNormalizedRectangle(normalizedRect, capture));
  }, [activeTarget, captures, saveTargetRoi]);

  const saveCalibration = useCallback(async (calibration: TargetCalibration): Promise<Target> => {
    if (!activeTarget) throw new Error('Open a target before saving its calibration.');
    if (calibration.targetId !== activeTarget.id) {
      throw new Error('This calibration belongs to a different target.');
    }
    setBusyOperation('updating');
    try {
      return await persistActiveTarget(Object.freeze({
        ...activeTarget,
        calibration,
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeTarget, persistActiveTarget]);

  const saveManualCalibration = useCallback(async (
    pixelsPerInchX: number,
    pixelsPerInchY?: number,
  ): Promise<Target> => {
    if (!activeTarget) throw new Error('Open a target before saving its calibration.');
    const calibration = createManualCalibration({
      id: Crypto.randomUUID(),
      targetId: activeTarget.id,
      calibratedAt: new Date().toISOString(),
    }, pixelsPerInchX, pixelsPerInchY);
    return saveCalibration(calibration);
  }, [activeTarget, saveCalibration]);

  const saveKnownLineCalibration = useCallback(async (
    normalizedStart: PixelPoint,
    normalizedEnd: PixelPoint,
    knownLengthInches: number,
  ): Promise<Target> => {
    if (!activeTarget) throw new Error('Open a target before saving its calibration.');
    const capture = findCoordinateCapture(activeTarget, captures);
    if (!capture) throw new Error('Capture a target image before calibrating it.');
    const calibration = createKnownLineCalibration({
      id: Crypto.randomUUID(),
      targetId: activeTarget.id,
      calibratedAt: new Date().toISOString(),
    }, mapNormalizedPoint(normalizedStart, capture), mapNormalizedPoint(normalizedEnd, capture), knownLengthInches);
    return saveCalibration(calibration);
  }, [activeTarget, captures, saveCalibration]);

  const setTargetReferencePoint = useCallback(async (
    kind: TargetReferencePointKind,
    normalizedPosition?: PixelPoint,
  ): Promise<Target> => {
    if (!activeTarget) throw new Error('Open a target before setting a reference point.');
    const capture = normalizedPosition
      ? findCoordinateCapture(activeTarget, captures)
      : undefined;
    if (normalizedPosition && !capture) {
      throw new Error('Capture a target image before placing a reference point.');
    }
    const referencePoint = capture && normalizedPosition
      ? mapNormalizedPoint(normalizedPosition, capture)
      : undefined;
    setBusyOperation('updating');
    try {
      return await persistActiveTarget(Object.freeze({
        ...activeTarget,
        pointOfAim: kind === 'point-of-aim' ? referencePoint : activeTarget.pointOfAim,
        desiredZeroPoint: kind === 'desired-zero' ? referencePoint : activeTarget.desiredZeroPoint,
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusyOperation(undefined);
    }
  }, [activeTarget, captures, persistActiveTarget]);

  const setPointOfAim = useCallback(async (normalizedPosition?: PixelPoint): Promise<Target> => (
    setTargetReferencePoint('point-of-aim', normalizedPosition)
  ), [setTargetReferencePoint]);

  const setDesiredZeroPoint = useCallback(async (normalizedPosition?: PixelPoint): Promise<Target> => (
    setTargetReferencePoint('desired-zero', normalizedPosition)
  ), [setTargetReferencePoint]);

  const liveStream = useMemo(() => {
    if (!resolvedCamera) return undefined;
    try {
      return preferredRtspCandidate(
        cameraAdapters.forProfile(resolvedCamera.profile),
        resolvedCamera,
      );
    } catch {
      return undefined;
    }
  }, [resolvedCamera]);

  const value = useMemo<ShotSightContextValue>(() => ({
    ready,
    error,
    cameras,
    activeCamera: resolvedCamera ? { profile: resolvedCamera.profile } : undefined,
    liveStreamUri: liveStream?.url,
    liveStreamEndpoint: liveStream?.redactedUrl,
    connectionLatencyMs,
    connectionState,
    targetSystemPairing,
    targetSystemStatus,
    sessions,
    activeSession,
    targets,
    activeTarget,
    nextShotNumber,
    captures,
    shots,
    groups,
    analysisCandidates,
    autoFocusNewestShot,
    busyOperation,
    refresh,
    setAutoFocusNewestShot,
    exportActiveSessionCsv,
    saveCamera,
    testCamera,
    testActiveCamera,
    testActiveOnvif,
    pairTargetSystem,
    clearTargetSystemPairing,
    refreshTargetSystemStatus,
    selectCamera,
    removeCamera,
    reportConnection: (state, latencyMs) => {
      setConnectionState(state);
      if (latencyMs !== undefined) setConnectionLatencyMs(latencyMs);
    },
    createSession,
    selectSession,
    createTarget,
    selectTarget,
    archiveSession,
    deleteSession,
    captureCurrentTarget,
    establishBaseline,
    addManualShot,
    setShotFlyer,
    analyzeCapture,
    confirmAnalysisCandidate,
    rejectAnalysisCandidate,
    setColdBore,
    saveShotGroup,
    removeShotGroup,
    saveTargetRoi,
    setTargetRoi,
    saveCalibration,
    saveManualCalibration,
    saveKnownLineCalibration,
    setTargetReferencePoint,
    setPointOfAim,
    setDesiredZeroPoint,
  }), [
    resolvedCamera,
    activeSession,
    activeTarget,
    addManualShot,
    analysisCandidates,
    analyzeCapture,
    archiveSession,
    autoFocusNewestShot,
    busyOperation,
    cameras,
    clearTargetSystemPairing,
    captureCurrentTarget,
    connectionLatencyMs,
    connectionState,
    confirmAnalysisCandidate,
    createSession,
    createTarget,
    deleteSession,
    error,
    establishBaseline,
    exportActiveSessionCsv,
    groups,
    ready,
    refreshTargetSystemStatus,
    refresh,
    removeCamera,
    saveCamera,
    selectCamera,
    selectSession,
    selectTarget,
    sessions,
    targets,
    saveCalibration,
    saveKnownLineCalibration,
    saveManualCalibration,
    saveShotGroup,
    saveTargetRoi,
    setColdBore,
    setAutoFocusNewestShot,
    setDesiredZeroPoint,
    setPointOfAim,
    setShotFlyer,
    setTargetReferencePoint,
    setTargetRoi,
    shots,
    captures,
    removeShotGroup,
    rejectAnalysisCandidate,
    testCamera,
    testActiveCamera,
    testActiveOnvif,
    targetSystemPairing,
    targetSystemStatus,
    pairTargetSystem,
    liveStream,
    nextShotNumber,
  ]);

  return <ShotSightContext.Provider value={value}>{children}</ShotSightContext.Provider>;
}

export function useShotSight(): ShotSightContextValue {
  const context = useContext(ShotSightContext);
  if (!context) throw new Error('useShotSight must be used inside ShotSightProvider.');
  return context;
}

function activeTargetSettingKey(sessionId: string): string {
  return `${ACTIVE_TARGET_KEY_PREFIX}:${sessionId}`;
}

/**
 * Pairing data is app-owned, but it still crosses a persistence boundary.
 * Revalidate it on load and treat an invalid legacy value as unpaired instead
 * of making the rest of the range workspace unavailable.
 */
async function loadTargetSystemPairing(): Promise<OfflineTargetSystemPairingPayload | undefined> {
  const stored = await repositories.settings.get<unknown>(TARGET_SYSTEM_PAIRING_KEY);
  if (stored === null) return undefined;
  try {
    return validateOfflineTargetSystemPairingPayload(stored);
  } catch {
    return undefined;
  }
}

function buildCameraProfile(input: CameraSetupInput, id: string): {
  readonly profile: CameraProfile;
  readonly credentials?: CameraCredentials;
} {
  const host = normalizeCameraHost(input.host);
  const timestamp = new Date().toISOString();
  const username = emptyToUndefined(input.username);
  const password = input.password ?? '';
  if (username && !password) throw new Error('Enter the camera password, or leave both login fields blank.');
  if (!username && password) throw new Error('Enter the camera username with its password.');
  const credentials = username ? { username, password } : undefined;
  const credentialRef = credentials ? credentialVault.referenceFor(id) : undefined;
  const reolink = input.kind === 'reolink-rlc-520a';
  const defaults = reolink ? reolinkRlc520aProfileDefaults(host) : undefined;
  const profile = createCameraProfile({
    id,
    name: input.name.trim() || defaults?.name || 'Target camera',
    host,
    manufacturer: reolink ? 'Reolink' : undefined,
    model: reolink ? 'RLC-520A' : undefined,
    presetId: reolink ? REOLINK_RLC_520A_PRESET_ID : undefined,
    username,
    credentialRef,
    streams: {
      mainRtspUrl: input.mainRtspUrl?.trim() || defaults?.streams.mainRtspUrl || `rtsp://${host}:554/`,
      subRtspUrl: input.subRtspUrl?.trim() || defaults?.streams.subRtspUrl,
      snapshotUrl: input.snapshotUrl?.trim() || defaults?.streams.snapshotUrl,
    },
    onvif: {
      enabled: input.onvifEnabled ?? Boolean(defaults?.onvif.enabled),
      port: input.onvifPort ?? defaults?.onvif.port,
      protocol: input.onvifProtocol ?? defaults?.onvif.protocol,
    },
    preferredStream: defaults?.preferredStream ?? (input.subRtspUrl ? 'sub' : 'main'),
    preferredStillSource: input.snapshotUrl || defaults?.streams.snapshotUrl ? 'http-snapshot' : 'main-stream-frame',
    targetDistanceYards: input.targetDistanceYards,
    cameraToTargetDistanceYards: input.cameraToTargetDistanceYards,
    capabilities: {
      rtsp: true,
      httpSnapshot: Boolean(input.snapshotUrl || defaults?.streams.snapshotUrl),
      onvif: input.onvifEnabled ?? Boolean(defaults?.onvif.enabled),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return { profile, credentials };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function findCoordinateCapture(
  target: Target,
  captures: readonly Capture[],
): Capture | undefined {
  if (target.baseline) {
    const baseline = captures.find((capture) => capture.id === target.baseline?.captureId);
    if (baseline) return baseline;
  }
  for (let index = captures.length - 1; index >= 0; index -= 1) {
    if (captures[index]?.targetId === target.id) return captures[index];
  }
  return undefined;
}

function mapNormalizedPoint(point: PixelPoint, capture: Capture): PixelPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Target coordinates must be finite.');
  }
  return Object.freeze({
    x: clampUnit(point.x) * capture.widthPixels,
    y: clampUnit(point.y) * capture.heightPixels,
  });
}

function mapNormalizedRectangle(
  rectangle: NormalizedTargetRectangle,
  capture: Capture,
): TargetRoi {
  const values = [rectangle.x, rectangle.y, rectangle.width, rectangle.height];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Target area coordinates must be finite.');
  }
  const endX = rectangle.x + rectangle.width;
  const endY = rectangle.y + rectangle.height;
  const left = clampUnit(Math.min(rectangle.x, endX));
  const right = clampUnit(Math.max(rectangle.x, endX));
  const top = clampUnit(Math.min(rectangle.y, endY));
  const bottom = clampUnit(Math.max(rectangle.y, endY));
  if (right <= left || bottom <= top) {
    throw new Error('Draw a target area with a non-zero width and height.');
  }
  return Object.freeze({
    kind: 'rectangle',
    rect: Object.freeze({
      x: left * capture.widthPixels,
      y: top * capture.heightPixels,
      width: (right - left) * capture.widthPixels,
      height: (bottom - top) * capture.heightPixels,
    }),
  });
}

function cloneTargetRoi(roi: TargetRoi | undefined): TargetRoi | undefined {
  if (!roi) return undefined;
  if (roi.kind === 'rectangle') {
    return Object.freeze({
      kind: 'rectangle',
      rect: Object.freeze({ ...roi.rect }),
    });
  }
  return Object.freeze({
    kind: 'polygon',
    points: Object.freeze(roi.points.map((point) => Object.freeze({ ...point }))),
  });
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function asAnalysisImage(capture: Capture): AnalysisImage {
  return Object.freeze({
    uri: capture.originalImageUri,
    widthPixels: capture.widthPixels,
    heightPixels: capture.heightPixels,
    captureId: capture.id,
  });
}

/** Maps detector candidates into the current clean baseline coordinate space. */
function mapShotCandidatesToSpace(
  candidates: readonly ShotCandidate[],
  transform: CoordinateTransform,
): readonly ShotCandidate[] {
  return Object.freeze(candidates.map((candidate) => Object.freeze({
    ...candidate,
    position: mapPointThroughTransform(candidate.position, transform),
    bounds: mapPixelRectThroughTransform(candidate.bounds, transform),
  })));
}

function mapTargetRoiToSpace(
  roi: TargetRoi | undefined,
  transform: CoordinateTransform,
): TargetRoi | undefined {
  if (!roi) return undefined;
  const rect = roi.kind === 'rectangle'
    ? roi.rect
    : boundsForPoints(roi.points);
  return Object.freeze({
    kind: 'rectangle',
    rect: mapPixelRectThroughTransform(rect, transform),
  });
}

function mapPixelRectThroughTransform(
  rect: PixelRect,
  transform: CoordinateTransform,
): PixelRect {
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => mapPointThroughTransform(point, transform));
  return boundsForPoints(points);
}

function boundsForPoints(points: readonly PixelPoint[]): PixelRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Object.freeze({
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  });
}

function analysisSensitivityFor(mode: AnalysisSearchMode): AnalysisSensitivity {
  if (mode === 'aggressive') {
    return Object.freeze({
      preset: 'high',
      minimumDifference: 8,
      minimumAreaPixels: 3,
      maximumAreaPixels: 40_000,
      deduplicationRadiusPixels: 14,
    });
  }
  return Object.freeze({
    preset: 'medium',
    minimumDifference: 12,
    minimumAreaPixels: 5,
    maximumAreaPixels: 25_000,
    deduplicationRadiusPixels: 18,
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected local error occurred.';
}
