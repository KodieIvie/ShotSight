import type { IsoTimestamp } from "./common";
import type {
  CameraSourceDataMode,
  CameraSourceImageQuality,
  CameraSourceNetworkStatus,
} from "./cameraSource";

export type ShotSightAppRole = "viewer" | "target-camera";

export type RemotePhonePairingState =
  | "waiting-for-viewer"
  | "connected"
  | "expired"
  | "revoked"
  | "stopped";

export type RemotePhoneTargetStatus =
  | "ready"
  | "connected-to-viewer"
  | "uploading-photo"
  | "connection-lost"
  | "reconnecting"
  | "stopped";

export type RemotePhoneCommandType =
  | "requestPreview"
  | "requestCapture"
  | "ping"
  | "disconnect";

export type RemotePhoneCommandStatus =
  | "queued"
  | "sent"
  | "acknowledged"
  | "completed"
  | "failed"
  | "timed-out";

export interface RemotePhonePairingSession {
  readonly id: string;
  readonly targetDeviceId: string;
  readonly targetLabel: string;
  readonly viewerDeviceId?: string;
  readonly pairingCode: string;
  readonly qrPayload: string;
  readonly sessionToken: string;
  readonly state: RemotePhonePairingState;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly connectedAt?: IsoTimestamp;
}

export interface RemotePhoneTelemetry {
  readonly status: RemotePhoneTargetStatus;
  readonly batteryPercent?: number;
  readonly charging?: boolean;
  readonly network?: CameraSourceNetworkStatus;
  readonly activeCameraLabel?: string;
  readonly activeDataMode: CameraSourceDataMode;
  readonly imageQuality: CameraSourceImageQuality;
  readonly sessionStartedAt?: IsoTimestamp;
  readonly uploadedBytes: number;
  readonly queuedCaptureCount: number;
  readonly lastUpdatedAt: IsoTimestamp;
}

export interface RemotePhoneCommand {
  readonly id: string;
  readonly sessionId: string;
  readonly type: RemotePhoneCommandType;
  readonly status: RemotePhoneCommandStatus;
  readonly requestedAt: IsoTimestamp;
  readonly acknowledgedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly captureId?: string;
  readonly sequenceNumber?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly failureMessage?: string;
}

export interface RemotePhoneCaptureRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly captureId: string;
  readonly sequenceNumber: number;
  readonly capturedAt: IsoTimestamp;
  readonly status: "captured" | "queued" | "uploading" | "delivered" | "failed";
  readonly originalImageUri?: string;
  readonly previewImageUri?: string;
  readonly byteSize?: number;
}

export interface StartTargetCameraSessionInput {
  readonly targetDeviceId: string;
  readonly targetLabel: string;
  readonly now: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly pairingCode: string;
  readonly sessionToken: string;
}

export function createRemotePhonePairingSession(
  input: StartTargetCameraSessionInput,
  id: string,
): RemotePhonePairingSession {
  if (!id.trim()) throw new RangeError("Pairing session id is required");
  if (!input.targetDeviceId.trim()) throw new RangeError("Target device id is required");
  if (!input.targetLabel.trim()) throw new RangeError("Target label is required");
  if (!/^\d{4,8}$/.test(input.pairingCode)) {
    throw new RangeError("Pairing code must be 4 to 8 digits");
  }
  if (!input.sessionToken.trim()) throw new RangeError("Session token is required");
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) {
    throw new RangeError("Pairing session must expire after it is created");
  }

  const qrPayload = encodeURIComponent(JSON.stringify({
    v: 1,
    kind: "shotsight-remote-phone-pairing",
    sessionId: id,
    pairingCode: input.pairingCode,
    token: input.sessionToken,
    targetDeviceId: input.targetDeviceId,
    expiresAt: input.expiresAt,
  }));

  return Object.freeze({
    id,
    targetDeviceId: input.targetDeviceId,
    targetLabel: input.targetLabel,
    pairingCode: input.pairingCode,
    qrPayload: `shotsight:remote-phone:v1:${qrPayload}`,
    sessionToken: input.sessionToken,
    state: "waiting-for-viewer",
    createdAt: input.now,
    expiresAt: input.expiresAt,
  });
}

export function isRemotePhonePairingExpired(
  session: RemotePhonePairingSession,
  now: IsoTimestamp,
): boolean {
  return Date.parse(session.expiresAt) <= Date.parse(now);
}
