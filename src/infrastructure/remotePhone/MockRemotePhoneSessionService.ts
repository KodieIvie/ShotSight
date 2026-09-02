import type {
  CameraSourceImageQuality,
  RemotePhoneCaptureRecord,
  RemotePhoneCommand,
  RemotePhoneCommandType,
  RemotePhonePairingSession,
  RemotePhoneTelemetry,
} from '../../domain';
import {
  createRemotePhonePairingSession,
  isRemotePhonePairingExpired,
} from '../../domain';

interface StoredRemotePhoneSession {
  readonly session: RemotePhonePairingSession;
  readonly telemetry: RemotePhoneTelemetry;
  readonly commands: readonly RemotePhoneCommand[];
  readonly captures: readonly RemotePhoneCaptureRecord[];
}

export class MockRemotePhoneSessionService {
  private readonly sessions = new Map<string, StoredRemotePhoneSession>();

  startTargetCamera(targetLabel = 'Target Phone'): RemotePhonePairingSession {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const session = createRemotePhonePairingSession({
      targetDeviceId: `mock-target-${createShortId()}`,
      targetLabel,
      now: nowIso,
      expiresAt,
      pairingCode: createPairingCode(),
      sessionToken: `mock-token-${createShortId()}-${createShortId()}`,
    }, `mock-session-${createShortId()}`);

    this.sessions.set(session.id, {
      session,
      telemetry: {
        status: 'ready',
        batteryPercent: 78,
        charging: false,
        network: {
          type: 'wifi',
          quality: 'good',
          isInternetReachable: true,
        },
        activeCameraLabel: 'Rear main camera',
        activeDataMode: 'photo',
        imageQuality: 'balanced',
        sessionStartedAt: nowIso,
        uploadedBytes: 0,
        queuedCaptureCount: 0,
        lastUpdatedAt: nowIso,
      },
      commands: [],
      captures: [],
    });

    return session;
  }

  stopTargetCamera(sessionId: string): RemotePhonePairingSession | undefined {
    const stored = this.sessions.get(sessionId);
    if (!stored) return undefined;
    const session = { ...stored.session, state: 'stopped' as const };
    this.sessions.set(sessionId, {
      ...stored,
      session,
      telemetry: {
        ...stored.telemetry,
        status: 'stopped',
        lastUpdatedAt: new Date().toISOString(),
      },
    });
    return session;
  }

  pairViewer(pairingCode: string, viewerDeviceId = 'mock-viewer'): RemotePhonePairingSession {
    const now = new Date().toISOString();
    const stored = [...this.sessions.values()].find((candidate) => (
      candidate.session.pairingCode === pairingCode.trim() &&
      candidate.session.state === 'waiting-for-viewer'
    ));

    if (!stored) {
      throw new Error('No waiting target phone is using that pairing code.');
    }
    if (isRemotePhonePairingExpired(stored.session, now)) {
      const expired = { ...stored.session, state: 'expired' as const };
      this.sessions.set(stored.session.id, { ...stored, session: expired });
      throw new Error('That pairing code expired. Start Target Camera mode again.');
    }

    const session = {
      ...stored.session,
      viewerDeviceId,
      state: 'connected' as const,
      connectedAt: now,
    };
    this.sessions.set(session.id, {
      ...stored,
      session,
      telemetry: {
        ...stored.telemetry,
        status: 'connected-to-viewer',
        lastUpdatedAt: now,
      },
    });
    return session;
  }

  getSession(sessionId: string): RemotePhonePairingSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  getTelemetry(sessionId: string): RemotePhoneTelemetry | undefined {
    return this.sessions.get(sessionId)?.telemetry;
  }

  listCommands(sessionId: string): readonly RemotePhoneCommand[] {
    return this.sessions.get(sessionId)?.commands ?? [];
  }

  listCaptures(sessionId: string): readonly RemotePhoneCaptureRecord[] {
    return this.sessions.get(sessionId)?.captures ?? [];
  }

  requestPreview(sessionId: string): RemotePhoneCommand {
    return this.completeCommand(sessionId, 'requestPreview');
  }

  requestCapture(
    sessionId: string,
    imageQuality: CameraSourceImageQuality = 'balanced',
  ): RemotePhoneCommand {
    const stored = this.requireSession(sessionId);
    const now = new Date().toISOString();
    const sequenceNumber = stored.captures.length + 1;
    const captureId = `mock-capture-${createShortId()}`;
    const command = this.completeCommand(sessionId, 'requestCapture', {
      captureId,
      sequenceNumber,
      payload: { imageQuality },
    });
    const capture: RemotePhoneCaptureRecord = {
      id: `mock-record-${createShortId()}`,
      sessionId,
      captureId,
      sequenceNumber,
      capturedAt: now,
      status: 'queued',
      originalImageUri: `mock://remote-phone/${captureId}/original.jpg`,
      previewImageUri: `mock://remote-phone/${captureId}/preview.jpg`,
      byteSize: imageQuality === 'high' ? 4_800_000 : imageQuality === 'data-saver' ? 850_000 : 2_200_000,
    };

    const latest = this.requireSession(sessionId);
    this.sessions.set(sessionId, {
      ...latest,
      telemetry: {
        ...latest.telemetry,
        status: 'uploading-photo',
        uploadedBytes: latest.telemetry.uploadedBytes + (capture.byteSize ?? 0),
        queuedCaptureCount: latest.telemetry.queuedCaptureCount + 1,
        imageQuality,
        lastUpdatedAt: now,
      },
      captures: [...latest.captures, capture],
    });

    return command;
  }

  ping(sessionId: string): RemotePhoneCommand {
    return this.completeCommand(sessionId, 'ping');
  }

  disconnect(sessionId: string): RemotePhoneCommand {
    const command = this.completeCommand(sessionId, 'disconnect');
    const stored = this.requireSession(sessionId);
    this.sessions.set(sessionId, {
      ...stored,
      session: { ...stored.session, state: 'stopped' },
      telemetry: {
        ...stored.telemetry,
        status: 'stopped',
        lastUpdatedAt: new Date().toISOString(),
      },
    });
    return command;
  }

  private completeCommand(
    sessionId: string,
    type: RemotePhoneCommandType,
    options: {
      readonly captureId?: string;
      readonly sequenceNumber?: number;
      readonly payload?: Readonly<Record<string, unknown>>;
    } = {},
  ): RemotePhoneCommand {
    const stored = this.requireSession(sessionId);
    const now = new Date().toISOString();
    if (stored.session.state !== 'connected' && type !== 'ping') {
      throw new Error('Pair a viewer before sending target-phone commands.');
    }

    const command: RemotePhoneCommand = {
      id: `mock-command-${createShortId()}`,
      sessionId,
      type,
      status: 'completed',
      requestedAt: now,
      acknowledgedAt: now,
      completedAt: now,
      captureId: options.captureId,
      sequenceNumber: options.sequenceNumber,
      payload: options.payload,
    };

    this.sessions.set(sessionId, {
      ...stored,
      telemetry: {
        ...stored.telemetry,
        lastUpdatedAt: now,
      },
      commands: [...stored.commands, command],
    });
    return command;
  }

  private requireSession(sessionId: string): StoredRemotePhoneSession {
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new Error('Remote phone session is no longer available.');
    return stored;
  }
}

export const mockRemotePhoneSessionService = new MockRemotePhoneSessionService();

function createPairingCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function createShortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
