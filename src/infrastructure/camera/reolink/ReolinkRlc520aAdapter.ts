import type { CameraProfile } from '../../../domain';
import type {
  CameraAdapter,
  CameraEndpointContext,
  HttpSnapshotCandidate,
  RtspStreamCandidate,
} from '../CameraAdapter';
import {
  basicAuthorizationHeader,
  deduplicateByUrl,
  injectRtspCredentials,
  interpolateCameraUrl,
  normalizeCameraHost,
  redactCameraUrl,
} from '../urlSecurity';

export const REOLINK_RLC_520A_PRESET_ID = 'reolink-rlc-520a';

export interface CameraProfilePreset {
  readonly id: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly defaultName: string;
  readonly defaultRtspPort: number;
  readonly defaultOnvifPort: number;
  readonly mainRtspTemplate: string;
  readonly subRtspTemplate: string;
  readonly snapshotTemplate: string;
}

/** Local-LAN defaults documented by Reolink cameras in the RLC family. */
export const REOLINK_RLC_520A_PRESET: CameraProfilePreset = Object.freeze({
  id: REOLINK_RLC_520A_PRESET_ID,
  manufacturer: 'Reolink',
  model: 'RLC-520A',
  defaultName: 'Target camera',
  defaultRtspPort: 554,
  defaultOnvifPort: 8000,
  mainRtspTemplate: 'rtsp://{host}:554/Preview_01_main',
  subRtspTemplate: 'rtsp://{host}:554/Preview_01_sub',
  snapshotTemplate: 'http://{host}/cgi-bin/api.cgi?cmd=Snap&channel=0',
});

/** Values suitable for a profile creation form; IDs and timestamps remain domain concerns. */
export function reolinkRlc520aProfileDefaults(host: string): Pick<
  CameraProfile,
  'host' | 'name' | 'onvif' | 'preferredStream' | 'presetId' | 'streams'
> {
  const normalizedHost = normalizeCameraHost(host);
  return {
    host: normalizedHost,
    name: REOLINK_RLC_520A_PRESET.defaultName,
    onvif: { enabled: true, port: REOLINK_RLC_520A_PRESET.defaultOnvifPort },
    preferredStream: 'sub',
    presetId: REOLINK_RLC_520A_PRESET_ID,
    streams: {
      mainRtspUrl: interpolateCameraUrl(
        REOLINK_RLC_520A_PRESET.mainRtspTemplate,
        normalizedHost,
      ),
      subRtspUrl: interpolateCameraUrl(
        REOLINK_RLC_520A_PRESET.subRtspTemplate,
        normalizedHost,
      ),
      snapshotUrl: interpolateCameraUrl(
        REOLINK_RLC_520A_PRESET.snapshotTemplate,
        normalizedHost,
      ),
    },
  };
}

/**
 * RLC-520A adapter using only direct RTSP and HTTP endpoints on the camera.
 * There is deliberately no dependency on the Reolink application or cloud API.
 */
export class ReolinkRlc520aAdapter implements CameraAdapter {
  readonly id = REOLINK_RLC_520A_PRESET_ID;
  readonly displayName = 'Reolink RLC-520A (local)';

  matches(profile: CameraProfile): boolean {
    return profile.presetId === REOLINK_RLC_520A_PRESET_ID;
  }

  getRtspStreamCandidates(context: CameraEndpointContext): readonly RtspStreamCandidate[] {
    const { profile, credentials } = context;
    const defaults = reolinkRlc520aProfileDefaults(profile.host);
    const candidates: RtspStreamCandidate[] = [
      this.rtspCandidate(
        'configured-main',
        'Configured main stream',
        'main',
        profile.streams.mainRtspUrl,
        context,
      ),
      this.rtspCandidate(
        'reolink-main',
        'Reolink main stream',
        'main',
        defaults.streams.mainRtspUrl,
        context,
      ),
      this.rtspCandidate(
        'reolink-main-legacy',
        'Reolink main stream (legacy path)',
        'main',
        'rtsp://{host}:554/h264Preview_01_main',
        context,
      ),
    ];

    if (profile.streams.subRtspUrl) {
      candidates.push(
        this.rtspCandidate(
          'configured-sub',
          'Configured preview stream',
          'sub',
          profile.streams.subRtspUrl,
          context,
        ),
      );
    }
    candidates.push(
      this.rtspCandidate(
        'reolink-sub',
        'Reolink preview stream',
        'sub',
        defaults.streams.subRtspUrl ?? '',
        context,
      ),
      this.rtspCandidate(
        'reolink-sub-legacy',
        'Reolink preview stream (legacy path)',
        'sub',
        'rtsp://{host}:554/h264Preview_01_sub',
        context,
      ),
    );

    return deduplicateByUrl(candidates).map((candidate) => ({
      ...candidate,
      url: injectRtspCredentials(candidate.url, credentials),
      redactedUrl: redactCameraUrl(injectRtspCredentials(candidate.url, credentials)),
    }));
  }

  getSnapshotCandidates(context: CameraEndpointContext): readonly HttpSnapshotCandidate[] {
    const { profile, credentials } = context;
    const host = normalizeCameraHost(profile.host);
    const nonce = encodeURIComponent(context.nonce ?? `${Date.now()}`);
    const candidates: HttpSnapshotCandidate[] = [];

    if (profile.streams.snapshotUrl) {
      const configuredUrl = this.withCacheBuster(
        interpolateCameraUrl(profile.streams.snapshotUrl, host, credentials),
        nonce,
      );
      candidates.push({
        id: 'configured-snapshot',
        label: 'Configured high-resolution snapshot',
        url: configuredUrl,
        redactedUrl: redactCameraUrl(configuredUrl),
        ...(credentials
          ? { headers: { Authorization: basicAuthorizationHeader(credentials) } }
          : {}),
      });
    }

    const apiBase = `http://${host}/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=${nonce}`;
    if (credentials) {
      // Query authentication is required by common RLC-520A firmware. Keep it as a
      // just-in-time candidate and expose only redactedUrl to diagnostics.
      const queryAuthenticated = `${apiBase}&user=${encodeURIComponent(
        credentials.username,
      )}&password=${encodeURIComponent(credentials.password)}`;
      candidates.push({
        id: 'reolink-snapshot-query-auth',
        label: 'Reolink native high-resolution snapshot',
        url: queryAuthenticated,
        redactedUrl: redactCameraUrl(queryAuthenticated),
      });
      candidates.push({
        id: 'reolink-snapshot-basic-auth',
        label: 'Reolink native snapshot (HTTP authentication)',
        url: apiBase,
        redactedUrl: redactCameraUrl(apiBase),
        headers: { Authorization: basicAuthorizationHeader(credentials) },
      });
    } else {
      candidates.push({
        id: 'reolink-snapshot',
        label: 'Reolink native high-resolution snapshot',
        url: apiBase,
        redactedUrl: redactCameraUrl(apiBase),
      });
    }

    return deduplicateByUrl(candidates);
  }

  private rtspCandidate(
    id: string,
    label: string,
    quality: 'main' | 'sub',
    template: string,
    context: CameraEndpointContext,
  ): RtspStreamCandidate {
    const url = interpolateCameraUrl(template, context.profile.host, context.credentials);
    return { id, label, quality, url, redactedUrl: redactCameraUrl(url) };
  }

  private withCacheBuster(url: string, nonce: string): string {
    if (/[?&]rs=/i.test(url)) {
      return url;
    }
    return `${url}${url.includes('?') ? '&' : '?'}rs=${nonce}`;
  }
}
