import type { IsoTimestamp, PhysicalSizeInches } from "./common";

export type PreferredCameraStream = "main" | "sub";
export type PreferredStillSource = "http-snapshot" | "main-stream-frame";

export interface CameraStreams {
  /** URL without embedded credentials; credentials are resolved from credentialRef. */
  readonly mainRtspUrl: string;
  /** URL without embedded credentials; credentials are resolved from credentialRef. */
  readonly subRtspUrl?: string;
  /** URL without query-string secrets or embedded credentials. */
  readonly snapshotUrl?: string;
}

export interface OnvifConfiguration {
  readonly enabled: boolean;
  readonly port?: number;
  /** Protocol used for the device-service request; absent profiles remain compatible. */
  readonly protocol?: "http" | "https";
}

export interface CameraCapabilities {
  readonly rtsp: boolean;
  readonly httpSnapshot: boolean;
  readonly onvif: boolean;
}

/**
 * A saved, local-network camera configuration.
 *
 * Passwords never belong in this object. `credentialRef` is an opaque key for a
 * platform secure-storage adapter. Stream URLs must likewise omit credentials.
 */
export interface CameraProfile {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly presetId?: string;
  readonly username?: string;
  readonly credentialRef?: string;
  readonly streams: CameraStreams;
  readonly onvif: OnvifConfiguration;
  readonly preferredStream: PreferredCameraStream;
  readonly preferredStillSource: PreferredStillSource;
  readonly targetDistanceYards?: number;
  readonly cameraToTargetDistanceYards?: number;
  readonly physicalTargetDimensionsInches?: PhysicalSizeInches;
  readonly capabilities: CameraCapabilities;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export type NewCameraProfile = Omit<CameraProfile, "createdAt" | "updatedAt"> & {
  readonly createdAt?: IsoTimestamp;
  readonly updatedAt?: IsoTimestamp;
};

export type CameraConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unreachable"
  | "authentication-failed"
  | "stream-error";

export interface CameraStatus {
  readonly profileId: string;
  readonly state: CameraConnectionState;
  readonly checkedAt: IsoTimestamp;
  readonly latencyMs?: number;
  readonly bitrateKbps?: number;
  readonly droppedFrames?: number;
  readonly message?: string;
}

export class InvalidCameraProfileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidCameraProfileError";
  }
}

const EMBEDDED_USER_INFO = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i;
const SECRET_QUERY_KEY_WORDS = new Set([
  "auth",
  "authentication",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "jwt",
  "key",
  "password",
  "passwd",
  "pwd",
  "secret",
  "session",
  "sid",
  "sig",
  "signature",
  "token",
]);
const SECRET_QUERY_COMPOUND_KEYS = new Set([
  "accesskey",
  "accesskeyid",
  "accesstoken",
  "apikey",
  "apikeyid",
  "apisecret",
  "awsaccesskeyid",
  "bearertoken",
  "clientkey",
  "clientsecret",
  "clienttoken",
  "idtoken",
  "keyid",
  "privatekey",
  "publickey",
  "refreshtoken",
  "secretkey",
  "sessionid",
  "sessionkey",
  "sessiontoken",
  "sharedkey",
  "signingkey",
]);
const MAX_QUERY_PERCENT_DECODING_PASSES = 3;

function assertCredentialSafeUrl(url: string, field: string): void {
  if (!url.trim()) {
    throw new InvalidCameraProfileError(`${field} cannot be empty`);
  }
  if (EMBEDDED_USER_INFO.test(url)) {
    throw new InvalidCameraProfileError(
      `${field} must not contain embedded credentials; use credentialRef`,
    );
  }
  if (hasSecretQueryParameter(url)) {
    throw new InvalidCameraProfileError(
      `${field} must not contain a plaintext secret in its query string`,
    );
  }
}

/**
 * Reject credential-like query keys without inspecting values. Camera vendors
 * commonly require benign keys such as `cmd` and `channel`; values such as
 * `cmd=GetToken` are therefore not treated as credentials. Query keys are
 * decoded repeatedly to prevent percent-encoding from hiding a secret.
 */
function hasSecretQueryParameter(url: string): boolean {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    return false;
  }

  let query = url.slice(queryStart + 1);
  for (let pass = 0; pass <= MAX_QUERY_PERCENT_DECODING_PASSES; pass += 1) {
    if (query.split(/[&;]/).some((segment) => isSecretQueryKey(queryKey(segment)))) {
      return true;
    }

    if (
      pass === MAX_QUERY_PERCENT_DECODING_PASSES ||
      (!query.includes("%") && !query.includes("+"))
    ) {
      return false;
    }

    try {
      const decoded = decodeURIComponent(query.replace(/\+/g, "%20"));
      if (decoded === query) {
        return false;
      }
      query = decoded;
    } catch {
      // Invalid escaping prevents us from proving a key is non-secret, so do
      // not admit a potentially credential-bearing endpoint.
      return true;
    }
  }

  return false;
}

function queryKey(segment: string): string {
  const separator = segment.indexOf("=");
  return separator === -1 ? segment : segment.slice(0, separator);
}

function isSecretQueryKey(key: string): boolean {
  const words = key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);
  const compact = words.join("");

  return (
    words.some((word) => SECRET_QUERY_KEY_WORDS.has(word)) ||
    SECRET_QUERY_COMPOUND_KEYS.has(compact) ||
    /^sigv\d*$/.test(compact)
  );
}

function assertPositive(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new InvalidCameraProfileError(`${field} must be a positive number`);
  }
}

/** Validates security and unit invariants at the domain boundary. */
export function validateCameraProfile(profile: CameraProfile): void {
  if (
    Object.prototype.hasOwnProperty.call(profile, "password") ||
    Object.prototype.hasOwnProperty.call(profile, "passwd")
  ) {
    throw new InvalidCameraProfileError(
      "Camera profiles must never contain plaintext password fields",
    );
  }
  if (!profile.id.trim() || !profile.name.trim() || !profile.host.trim()) {
    throw new InvalidCameraProfileError("id, name, and host are required");
  }
  if (profile.username && !profile.credentialRef) {
    throw new InvalidCameraProfileError(
      "credentialRef is required when a username is configured",
    );
  }
  if (profile.credentialRef !== undefined && !profile.credentialRef.trim()) {
    throw new InvalidCameraProfileError("credentialRef cannot be empty");
  }
  assertCredentialSafeUrl(profile.streams.mainRtspUrl, "mainRtspUrl");
  if (profile.streams.subRtspUrl) {
    assertCredentialSafeUrl(profile.streams.subRtspUrl, "subRtspUrl");
  }
  if (profile.streams.snapshotUrl) {
    assertCredentialSafeUrl(profile.streams.snapshotUrl, "snapshotUrl");
  }
  if (
    profile.onvif.port !== undefined &&
    (!Number.isInteger(profile.onvif.port) ||
      profile.onvif.port < 1 ||
      profile.onvif.port > 65_535)
  ) {
    throw new InvalidCameraProfileError("ONVIF port must be between 1 and 65535");
  }
  if (
    profile.onvif.protocol !== undefined &&
    profile.onvif.protocol !== "http" &&
    profile.onvif.protocol !== "https"
  ) {
    throw new InvalidCameraProfileError("ONVIF protocol must be http or https");
  }
  assertPositive(profile.targetDistanceYards, "targetDistanceYards");
  assertPositive(
    profile.cameraToTargetDistanceYards,
    "cameraToTargetDistanceYards",
  );
  assertPositive(
    profile.physicalTargetDimensionsInches?.width,
    "physicalTargetDimensionsInches.width",
  );
  assertPositive(
    profile.physicalTargetDimensionsInches?.height,
    "physicalTargetDimensionsInches.height",
  );
}

/** Creates an immutable profile after validating that it contains no secret. */
export function createCameraProfile(
  input: NewCameraProfile,
  now: IsoTimestamp = new Date().toISOString(),
): CameraProfile {
  const profile: CameraProfile = {
    ...input,
    streams: Object.freeze({ ...input.streams }),
    onvif: Object.freeze({ ...input.onvif }),
    capabilities: Object.freeze({ ...input.capabilities }),
    physicalTargetDimensionsInches: input.physicalTargetDimensionsInches
      ? Object.freeze({ ...input.physicalTargetDimensionsInches })
      : undefined,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  validateCameraProfile(profile);
  return Object.freeze(profile);
}
