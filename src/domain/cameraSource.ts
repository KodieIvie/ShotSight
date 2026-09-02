import type { IsoTimestamp, ResourceUri } from "./common";

export type CameraSourceType =
  | "ip-camera"
  | "remote-phone"
  | "imported-image"
  | "shotsight-hardware";

export type CameraSourceConnectionState =
  | "idle"
  | "starting"
  | "ready"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "uploading"
  | "analyzing"
  | "disconnected"
  | "unreachable"
  | "error";

export type CameraSourceDataMode = "photo" | "live-view";
export type CameraSourceImageQuality = "high" | "balanced" | "data-saver";

export interface CameraSourceCapabilities {
  readonly livePreview: boolean;
  readonly highResolutionStill: boolean;
  readonly importedImage: boolean;
  readonly zoom: boolean;
  readonly focus: boolean;
  readonly exposure: boolean;
  readonly torch: boolean;
  readonly batteryStatus: boolean;
  readonly networkStatus: boolean;
}

export interface CameraSourceBatteryStatus {
  readonly percent?: number;
  readonly charging?: boolean;
  readonly thermalState?: "nominal" | "fair" | "serious" | "critical" | "unknown";
}

export interface CameraSourceNetworkStatus {
  readonly type?: "wifi" | "cellular" | "ethernet" | "unknown" | "none";
  readonly quality?: "excellent" | "good" | "fair" | "poor" | "unknown";
  readonly isInternetReachable?: boolean;
}

export interface CameraSourceStatus {
  readonly sourceId: string;
  readonly sourceType: CameraSourceType;
  readonly state: CameraSourceConnectionState;
  readonly checkedAt: IsoTimestamp;
  readonly label?: string;
  readonly message?: string;
  readonly battery?: CameraSourceBatteryStatus;
  readonly network?: CameraSourceNetworkStatus;
  readonly activeDataMode?: CameraSourceDataMode;
}

export interface CameraPreviewStream {
  readonly kind: "rtsp" | "webrtc" | "local-preview" | "static-image";
  readonly uri?: ResourceUri;
  readonly redactedUri?: string;
  readonly widthPixels?: number;
  readonly heightPixels?: number;
  readonly latencyMs?: number;
}

export interface CameraSourceCaptureRequest {
  readonly captureId: string;
  readonly sessionId: string;
  readonly targetId?: string;
  readonly requestedAt: IsoTimestamp;
  readonly quality: CameraSourceImageQuality;
  readonly dataMode: CameraSourceDataMode;
}

export type SourceCaptureTransferStatus =
  | "local"
  | "queued"
  | "uploading"
  | "transferred"
  | "failed";

export interface SourceCaptureResult {
  readonly id: string;
  readonly sessionId: string;
  readonly sourceType: CameraSourceType;
  readonly sourceDeviceId?: string;
  readonly sequenceNumber?: number;
  readonly captureTimestamp: IsoTimestamp;
  readonly receiveTimestamp?: IsoTimestamp;
  readonly originalImageUri: ResourceUri;
  readonly previewImageUri?: ResourceUri;
  readonly originalResolution: {
    readonly widthPixels: number;
    readonly heightPixels: number;
  };
  readonly transferStatus: SourceCaptureTransferStatus;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Source-level camera contract. Implementations advertise capabilities instead
 * of forcing every source to support every camera operation.
 */
export interface CameraSource {
  readonly id: string;
  readonly type: CameraSourceType;
  readonly displayName: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<CameraSourceStatus>;
  getCapabilities(): CameraSourceCapabilities;

  getPreviewStream?(): Promise<CameraPreviewStream>;
  captureHighResolutionImage?(
    request: CameraSourceCaptureRequest,
  ): Promise<SourceCaptureResult>;
  setZoom?(zoom: number): Promise<void>;
  setFocus?(focusPoint: { readonly x: number; readonly y: number } | "auto" | "locked"): Promise<void>;
  setExposure?(exposure: number | "auto" | "locked"): Promise<void>;
  setTorch?(enabled: boolean): Promise<void>;
}

export const IP_CAMERA_SOURCE_CAPABILITIES: CameraSourceCapabilities = Object.freeze({
  livePreview: true,
  highResolutionStill: true,
  importedImage: false,
  zoom: false,
  focus: false,
  exposure: false,
  torch: false,
  batteryStatus: false,
  networkStatus: false,
});

export const REMOTE_PHONE_SOURCE_CAPABILITIES: CameraSourceCapabilities = Object.freeze({
  livePreview: true,
  highResolutionStill: true,
  importedImage: false,
  zoom: true,
  focus: true,
  exposure: true,
  torch: true,
  batteryStatus: true,
  networkStatus: true,
});

export const IMPORTED_IMAGE_SOURCE_CAPABILITIES: CameraSourceCapabilities = Object.freeze({
  livePreview: false,
  highResolutionStill: false,
  importedImage: true,
  zoom: false,
  focus: false,
  exposure: false,
  torch: false,
  batteryStatus: false,
  networkStatus: false,
});
