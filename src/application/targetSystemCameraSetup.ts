import {
  validateOfflineTargetSystemPairingPayload,
  type OfflineTargetSystemPairingPayload,
  type TargetSystemCameraPairing,
} from '../domain';

/**
 * The credential-free subset of the camera form that can be populated by an
 * offline target-system QR code. Login details remain intentionally absent so
 * the setup screen can collect them into the platform credential vault.
 */
export interface TargetSystemCameraSetupSeed {
  readonly kind: 'reolink-rlc-520a' | 'generic-rtsp';
  readonly name: string;
  readonly host: string;
  readonly mainRtspUrl?: string;
  readonly subRtspUrl?: string;
  readonly snapshotUrl?: string;
  readonly onvifEnabled: boolean;
  readonly onvifPort?: number;
}

const DEFAULT_RTSP_PORT = 554;
const REOLINK_RLC_520A_ONVIF_PORT = 8000;
const REOLINK_RLC_520A_MAIN_PATH = '/Preview_01_main';
const REOLINK_RLC_520A_SUB_PATH = '/Preview_01_sub';
const REOLINK_RLC_520A_SNAPSHOT_PATH = '/cgi-bin/api.cgi?cmd=Snap&channel=0';

/**
 * Produces a safe, credential-free camera form seed from a validated pairing
 * payload. The payload is validated again at this boundary so a caller cannot
 * smuggle an untrusted cast into a camera configuration.
 *
 * Generic camera URLs are only created when their matching QR path exists;
 * unknown paths are never guessed. A positively identified RLC-520A gets its
 * documented local endpoint paths when they are absent, while any supplied
 * safe path and non-default RTSP port takes precedence.
 */
export function createTargetSystemCameraSetupSeed(
  pairingInput: OfflineTargetSystemPairingPayload,
): TargetSystemCameraSetupSeed {
  const pairing = validateOfflineTargetSystemPairingPayload(pairingInput);
  const { camera } = pairing;
  const isReolinkRlc520a = isConfirmedReolinkRlc520a(camera);
  const rtspPort = camera.rtspPort ?? DEFAULT_RTSP_PORT;

  const mainRtspPath = camera.mainRtspPath
    ?? (isReolinkRlc520a ? REOLINK_RLC_520A_MAIN_PATH : undefined);
  const subRtspPath = camera.subRtspPath
    ?? (isReolinkRlc520a ? REOLINK_RLC_520A_SUB_PATH : undefined);
  const snapshotPath = camera.snapshotPath
    ?? (isReolinkRlc520a ? REOLINK_RLC_520A_SNAPSHOT_PATH : undefined);
  const onvifPort = camera.onvifPort
    ?? (isReolinkRlc520a ? REOLINK_RLC_520A_ONVIF_PORT : undefined);

  return Object.freeze({
    kind: isReolinkRlc520a ? 'reolink-rlc-520a' : 'generic-rtsp',
    name: pairing.label,
    host: camera.host,
    ...(mainRtspPath
      ? { mainRtspUrl: localEndpointUrl('rtsp', camera.host, mainRtspPath, rtspPort) }
      : {}),
    ...(subRtspPath
      ? { subRtspUrl: localEndpointUrl('rtsp', camera.host, subRtspPath, rtspPort) }
      : {}),
    ...(snapshotPath
      ? { snapshotUrl: localEndpointUrl('http', camera.host, snapshotPath) }
      : {}),
    onvifEnabled: onvifPort !== undefined,
    ...(onvifPort !== undefined ? { onvifPort } : {}),
  });
}

function isConfirmedReolinkRlc520a(camera: TargetSystemCameraPairing): boolean {
  return (
    normalizeManufacturer(camera.manufacturer) === 'reolink'
    && normalizeModel(camera.model) === 'rlc520a'
  );
}

function normalizeManufacturer(value: string | undefined): string | undefined {
  return value?.trim().toLocaleLowerCase();
}

function normalizeModel(value: string | undefined): string | undefined {
  return value?.trim().toLocaleLowerCase().replace(/[\s-]/g, '');
}

function localEndpointUrl(
  scheme: 'rtsp' | 'http',
  host: string,
  path: string,
  port?: number,
): string {
  return `${scheme}://${host}${port === undefined ? '' : `:${port}`}${path}`;
}
