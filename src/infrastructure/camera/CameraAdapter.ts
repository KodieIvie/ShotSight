import type { CameraProfile } from '../../domain';

/** Credentials are supplied just-in-time from the credential vault and are never persisted in SQLite. */
export interface CameraCredentials {
  readonly username: string;
  readonly password: string;
}

export type StreamQuality = 'main' | 'sub';

export interface RtspStreamCandidate {
  readonly id: string;
  readonly label: string;
  readonly quality: StreamQuality;
  /** Playable URL. This value can contain credentials and must never be logged. */
  readonly url: string;
  /** Safe counterpart for logs and diagnostics. */
  readonly redactedUrl: string;
}

export interface HttpSnapshotCandidate {
  readonly id: string;
  readonly label: string;
  /** Download URL. This value can contain credentials and must never be logged. */
  readonly url: string;
  readonly redactedUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface CameraEndpointContext {
  readonly profile: CameraProfile;
  readonly credentials?: CameraCredentials;
  /** Used to defeat camera-side snapshot caches. */
  readonly nonce?: string;
}

/**
 * Vendor-neutral boundary between ShotSight and a LAN camera.
 *
 * Adapters only describe local endpoints. Playback and capture are intentionally
 * separate concerns so another RTSP/ONVIF camera can be added without changing UI.
 */
export interface CameraAdapter {
  readonly id: string;
  readonly displayName: string;

  matches(profile: CameraProfile): boolean;
  getRtspStreamCandidates(context: CameraEndpointContext): readonly RtspStreamCandidate[];
  getSnapshotCandidates(context: CameraEndpointContext): readonly HttpSnapshotCandidate[];
}

export function preferredRtspCandidate(
  adapter: CameraAdapter,
  context: CameraEndpointContext,
): RtspStreamCandidate | undefined {
  const candidates = adapter.getRtspStreamCandidates(context);
  return (
    candidates.find((candidate) => candidate.quality === context.profile.preferredStream) ??
    candidates[0]
  );
}
