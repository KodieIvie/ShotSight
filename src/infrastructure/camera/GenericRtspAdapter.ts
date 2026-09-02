import type {
  CameraAdapter,
  CameraEndpointContext,
  HttpSnapshotCandidate,
  RtspStreamCandidate,
} from './CameraAdapter';
import {
  basicAuthorizationHeader,
  deduplicateByUrl,
  injectRtspCredentials,
  interpolateCameraUrl,
  redactCameraUrl,
} from './urlSecurity';

export const GENERIC_RTSP_ADAPTER_ID = 'generic-rtsp';

/** Adapter for manually configured, standards-based RTSP cameras. */
export class GenericRtspAdapter implements CameraAdapter {
  readonly id = GENERIC_RTSP_ADAPTER_ID;
  readonly displayName = 'Generic RTSP camera';

  matches(): boolean {
    return true;
  }

  getRtspStreamCandidates(context: CameraEndpointContext): readonly RtspStreamCandidate[] {
    const { profile, credentials } = context;
    const configured = [
      {
        id: 'configured-main',
        label: 'Configured main stream',
        quality: 'main' as const,
        template: profile.streams.mainRtspUrl,
      },
      ...(profile.streams.subRtspUrl
        ? [
            {
              id: 'configured-sub',
              label: 'Configured preview stream',
              quality: 'sub' as const,
              template: profile.streams.subRtspUrl,
            },
          ]
        : []),
    ];

    return deduplicateByUrl(
      configured
        .filter(({ template }) => Boolean(template?.trim()))
        .map(({ template, ...candidate }) => {
          const interpolated = interpolateCameraUrl(template, profile.host, credentials);
          const url = injectRtspCredentials(interpolated, credentials);
          return { ...candidate, url, redactedUrl: redactCameraUrl(url) };
        }),
    );
  }

  getSnapshotCandidates(context: CameraEndpointContext): readonly HttpSnapshotCandidate[] {
    const { profile, credentials } = context;
    if (!profile.streams.snapshotUrl?.trim()) {
      return [];
    }

    const url = interpolateCameraUrl(profile.streams.snapshotUrl, profile.host, credentials);
    return [
      {
        id: 'configured-snapshot',
        label: 'Configured high-resolution snapshot',
        url,
        redactedUrl: redactCameraUrl(url),
        ...(credentials
          ? { headers: { Authorization: basicAuthorizationHeader(credentials) } }
          : {}),
      },
    ];
  }
}
