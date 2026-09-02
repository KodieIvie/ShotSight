import type { IsoTimestamp } from "./common";

/**
 * Versioned URI prefix encoded into an offline QR code. The URI contains only
 * local endpoint metadata; authentication is collected after pairing and kept
 * in the platform credential vault.
 */
export const OFFLINE_TARGET_SYSTEM_PAIRING_PREFIX = "shotsight:pair:v1:";
export const OFFLINE_TARGET_SYSTEM_PAIRING_VERSION = 1;

export type TargetSystemRadioTransport = "ble" | "lora" | "wifi" | "serial";

/**
 * Camera endpoint metadata that is safe to put in an offline QR code.
 *
 * Paths may contain non-secret query parameters required by a camera, such as
 * Reolink's `cmd=Snap`. They never contain an authority, username, password,
 * token, or other secret.
 */
export interface TargetSystemCameraPairing {
  readonly host: string;
  readonly rtspPort?: number;
  readonly onvifPort?: number;
  readonly mainRtspPath?: string;
  readonly subRtspPath?: string;
  readonly snapshotPath?: string;
  readonly manufacturer?: string;
  readonly model?: string;
}

/** Optional telemetry-radio metadata. It is an identifier, never a key or credential. */
export interface TargetSystemRadioPairing {
  readonly transport: TargetSystemRadioTransport;
  readonly deviceId?: string;
  readonly serviceUuid?: string;
}

/** The only currently supported offline target-system pairing schema. */
export interface OfflineTargetSystemPairingPayloadV1 {
  readonly kind: "target-system";
  readonly version: typeof OFFLINE_TARGET_SYSTEM_PAIRING_VERSION;
  readonly systemId: string;
  readonly label: string;
  readonly camera: TargetSystemCameraPairing;
  readonly radio?: TargetSystemRadioPairing;
}

export type OfflineTargetSystemPairingPayload =
  OfflineTargetSystemPairingPayloadV1;

/** States intentionally distinguish an absent gateway from a failed camera probe. */
export type TargetSystemGatewayState = "available" | "unavailable";

export interface TargetSystemGatewayAvailability {
  readonly state: TargetSystemGatewayState;
  readonly checkedAt: IsoTimestamp;
  readonly message?: string;
}

export type TargetSystemCameraState =
  | "not-probed"
  | "connecting"
  | "connected"
  | "unreachable"
  | "authentication-required"
  | "stream-error";

/** Safe operational status; it deliberately contains no endpoint or credential data. */
export interface TargetSystemCameraHardwareStatus {
  readonly state: TargetSystemCameraState;
  readonly observedAt: IsoTimestamp;
  readonly latencyMs?: number;
  readonly snapshotAvailable?: boolean;
  readonly streamAvailable?: boolean;
  readonly message?: string;
}

export type TargetSystemRadioState =
  | "not-probed"
  | "scanning"
  | "paired"
  | "connected"
  | "unreachable"
  | "unsupported";

export interface TargetSystemRadioHardwareStatus {
  readonly transport: TargetSystemRadioTransport;
  readonly state: TargetSystemRadioState;
  readonly observedAt: IsoTimestamp;
  readonly signalStrengthDbm?: number;
  readonly packetLossPercent?: number;
  readonly lastMessageAt?: IsoTimestamp;
  readonly firmwareVersion?: string;
  readonly message?: string;
}

export type TargetSystemBatteryState =
  | "unknown"
  | "charging"
  | "discharging"
  | "full"
  | "low"
  | "critical"
  | "external-power";

export interface TargetSystemBatteryStatus {
  readonly state: TargetSystemBatteryState;
  readonly observedAt: IsoTimestamp;
  readonly chargePercent?: number;
  readonly voltage?: number;
  readonly isCharging?: boolean;
  readonly externalPower?: boolean;
  readonly message?: string;
}

/** One atomic status reading from a future hardware gateway. */
export interface TargetSystemStatusSnapshot {
  readonly systemId: string;
  readonly observedAt: IsoTimestamp;
  readonly gateway: TargetSystemGatewayAvailability;
  readonly camera: TargetSystemCameraHardwareStatus;
  readonly radio?: TargetSystemRadioHardwareStatus;
  readonly battery?: TargetSystemBatteryStatus;
}

export class TargetSystemPairingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TargetSystemPairingError";
  }
}

export class UnsupportedTargetSystemPairingVersionError extends TargetSystemPairingError {
  public constructor(version: unknown) {
    super(`Offline target-system pairing version ${String(version)} is not supported.`);
    this.name = "UnsupportedTargetSystemPairingVersionError";
  }
}

const MAX_QR_PAYLOAD_LENGTH = 4_096;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._()\-]{0,79}$/u;
const SAFE_METADATA = /^[\p{L}\p{N}][\p{L}\p{N} ._()\-/]{0,127}$/u;
const SAFE_DEVICE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4_SEGMENT = /^(?:0|[1-9][0-9]{0,2})$/;
const IPV6_HEXTET = /^[A-Fa-f0-9]{1,4}$/;
const CREDENTIAL_WORDS = new Set([
  "auth",
  "authentication",
  "authorization",
  "cookie",
  "credential",
  "credentials",
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
  "user",
  "username",
]);
const COMPOUND_CREDENTIAL_KEYS = new Set([
  "accesskey",
  "accesskeyid",
  "accesstoken",
  "apikey",
  "awsaccesskeyid",
  "bearertoken",
  "clientkey",
  "clientsecret",
  "encryptionkey",
  "idtoken",
  "keyid",
  "privatekey",
  "publickey",
  "refreshtoken",
  "secretkey",
  "sessionid",
  "sessiontoken",
  "sharedkey",
  "signingkey",
]);

type UnknownRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TargetSystemPairingError(`${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function rejectCredentialFields(value: unknown, field: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectCredentialFields(entry, `${field}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isCredentialBearingKey(key)) {
      throw new TargetSystemPairingError(
        `${field}.${key} is not permitted in an offline pairing payload. Credentials belong in secure storage.`,
      );
    }
    rejectCredentialFields(entry, `${field}.${key}`);
  }
}

function assertOnlyKeys(
  record: UnknownRecord,
  field: string,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new TargetSystemPairingError(`${field}.${key} is not supported by this pairing version.`);
    }
  }
}

function requiredString(record: UnknownRecord, key: string, field: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new TargetSystemPairingError(`${field}.${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(record: UnknownRecord, key: string, field: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new TargetSystemPairingError(`${field}.${key} must be a non-empty string when supplied.`);
  }
  return value.trim();
}

function optionalPort(record: UnknownRecord, key: string, field: string): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new TargetSystemPairingError(`${field}.${key} must be an integer from 1 through 65535.`);
  }
  return value;
}

function assertMatches(value: string, pattern: RegExp, field: string, description: string): void {
  if (!pattern.test(value)) {
    throw new TargetSystemPairingError(`${field} must be ${description}.`);
  }
}

function assertSafeHost(host: string): void {
  if (
    host.length > 253 ||
    /[\s/@?#]/.test(host) ||
    host.includes("://") ||
    host.includes("..")
  ) {
    throw new TargetSystemPairingError("camera.host must be a hostname or IP address without a port or credentials.");
  }

  if (host.startsWith("[") || host.endsWith("]")) {
    assertLocalIpv6Host(host);
    return;
  }

  const ipv4 = parseIpv4Address(host);
  if (ipv4) {
    if (!isLocalIpv4Address(ipv4)) {
      throw new TargetSystemPairingError("camera.host must be a private, loopback, or link-local IP address.");
    }
    return;
  }

  if (looksLikeIpv4Address(host)) {
    throw new TargetSystemPairingError("camera.host must contain a valid local IPv4 address.");
  }

  if (!isValidHostname(host)) {
    throw new TargetSystemPairingError("camera.host must be a hostname or IP address without a port or credentials.");
  }

  const normalizedHost = host.toLowerCase();
  if (
    normalizedHost === "localhost" ||
    !normalizedHost.includes(".") ||
    normalizedHost.endsWith(".local") ||
    normalizedHost.endsWith(".home.arpa")
  ) {
    return;
  }

  throw new TargetSystemPairingError(
    "camera.host must be a local hostname (.local or .home.arpa), bare LAN label, or local IP address.",
  );
}

function decodeQueryKey(rawKey: string, field: string): string {
  try {
    let decoded = rawKey.replace(/\+/g, "%20");
    // Decode a few times so a secret query-key cannot evade validation through
    // common double-encoding tricks. More layers are never useful to a camera
    // endpoint and remain rejected by the final percent check below.
    for (let attempt = 0; attempt < 3 && decoded.includes("%"); attempt += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    }
    if (decoded.includes("%")) {
      throw new Error("unresolved percent encoding");
    }
    return decoded;
  } catch {
    throw new TargetSystemPairingError(`${field} has an invalid percent-encoded query parameter.`);
  }
}

function assertSafeEndpointPath(path: string, field: string): void {
  if (
    path.length > 512 ||
    !path.startsWith("/") ||
    /[\s#@]/.test(path) ||
    path.includes("://")
  ) {
    throw new TargetSystemPairingError(
      `${field} must be an absolute local path without embedded credentials.`,
    );
  }
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) {
    return;
  }
  const query = path.slice(queryIndex + 1);
  for (const segment of query.split(/[&;]/)) {
    const key = decodeQueryKey(segment.split("=", 1)[0] ?? "", field);
    if (isCredentialBearingKey(key)) {
      throw new TargetSystemPairingError(
        `${field} must not include secret query parameters in an offline pairing payload.`,
      );
    }
  }
}

function isCredentialBearingKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const normalized = words.join("");

  return (
    words.some((word) => CREDENTIAL_WORDS.has(word) || /^sigv[0-9]+$/.test(word)) ||
    CREDENTIAL_WORDS.has(normalized) ||
    COMPOUND_CREDENTIAL_KEYS.has(normalized)
  );
}

function isValidHostname(host: string): boolean {
  const labels = host.split(".");
  return labels.every((label) => HOST_LABEL.test(label));
}

function looksLikeIpv4Address(host: string): boolean {
  return host.split(".").length === 4 && host.split(".").every((part) => /^\d+$/.test(part));
}

function parseIpv4Address(host: string): readonly number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => IPV4_SEGMENT.test(part))) {
    return undefined;
  }
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function isLocalIpv4Address([first, second]: readonly number[]): boolean {
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function assertLocalIpv6Host(host: string): void {
  const literal = host.slice(1, -1).toLowerCase();
  const hextets = parseIpv6Hextets(literal);
  if (!hextets) {
    throw new TargetSystemPairingError("camera.host must contain a valid bracketed IPv6 literal.");
  }

  const firstHextet = hextets[0] ?? 0;
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;
  const isUniqueLocal = firstHextet >= 0xfc00 && firstHextet <= 0xfdff;
  const isLinkLocal = firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
  if (!isLoopback && !isUniqueLocal && !isLinkLocal) {
    throw new TargetSystemPairingError("camera.host must be a ULA, loopback, or link-local IPv6 address.");
  }
}

function parseIpv6Hextets(literal: string): readonly number[] | undefined {
  if (!literal || literal.includes(".")) {
    return undefined;
  }
  const compressionIndex = literal.indexOf("::");
  const hasCompression = compressionIndex !== -1;
  if (hasCompression && literal.indexOf("::", compressionIndex + 2) !== -1) {
    return undefined;
  }
  const groups = hasCompression
    ? [literal.slice(0, compressionIndex), literal.slice(compressionIndex + 2)]
    : [literal];
  const hextetStrings = groups.flatMap((group) => (group ? group.split(":") : []));
  if (!hextetStrings.every((hextet) => IPV6_HEXTET.test(hextet))) {
    return undefined;
  }
  if (hasCompression) {
    if (hextetStrings.length >= 8) {
      return undefined;
    }
    return [
      ...hextetStrings.slice(0, groups[0] ? groups[0].split(":").length : 0).map((hextet) => Number.parseInt(hextet, 16)),
      ...Array.from({ length: 8 - hextetStrings.length }, () => 0),
      ...hextetStrings.slice(groups[0] ? groups[0].split(":").length : 0).map((hextet) => Number.parseInt(hextet, 16)),
    ];
  }
  return hextetStrings.length === 8
    ? hextetStrings.map((hextet) => Number.parseInt(hextet, 16))
    : undefined;
}

function buildCameraPairing(value: unknown): TargetSystemCameraPairing {
  const record = asRecord(value, "camera");
  assertOnlyKeys(record, "camera", [
    "host",
    "rtspPort",
    "onvifPort",
    "mainRtspPath",
    "subRtspPath",
    "snapshotPath",
    "manufacturer",
    "model",
  ]);
  const host = requiredString(record, "host", "camera");
  assertSafeHost(host);

  const mainRtspPath = optionalString(record, "mainRtspPath", "camera");
  const subRtspPath = optionalString(record, "subRtspPath", "camera");
  const snapshotPath = optionalString(record, "snapshotPath", "camera");
  const rtspPort = optionalPort(record, "rtspPort", "camera");
  const onvifPort = optionalPort(record, "onvifPort", "camera");
  mainRtspPath && assertSafeEndpointPath(mainRtspPath, "camera.mainRtspPath");
  subRtspPath && assertSafeEndpointPath(subRtspPath, "camera.subRtspPath");
  snapshotPath && assertSafeEndpointPath(snapshotPath, "camera.snapshotPath");

  const manufacturer = optionalString(record, "manufacturer", "camera");
  const model = optionalString(record, "model", "camera");
  manufacturer && assertMatches(manufacturer, SAFE_METADATA, "camera.manufacturer", "safe camera metadata");
  model && assertMatches(model, SAFE_METADATA, "camera.model", "safe camera metadata");

  return Object.freeze({
    host,
    ...(rtspPort !== undefined
      ? { rtspPort }
      : {}),
    ...(onvifPort !== undefined
      ? { onvifPort }
      : {}),
    ...(mainRtspPath ? { mainRtspPath } : {}),
    ...(subRtspPath ? { subRtspPath } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
  });
}

function buildRadioPairing(value: unknown): TargetSystemRadioPairing {
  const record = asRecord(value, "radio");
  assertOnlyKeys(record, "radio", ["transport", "deviceId", "serviceUuid"]);
  const transport = requiredString(record, "transport", "radio");
  if (!(["ble", "lora", "wifi", "serial"] as const).includes(transport as TargetSystemRadioTransport)) {
    throw new TargetSystemPairingError("radio.transport must be ble, lora, wifi, or serial.");
  }
  const deviceId = optionalString(record, "deviceId", "radio");
  const serviceUuid = optionalString(record, "serviceUuid", "radio");
  deviceId && assertMatches(deviceId, SAFE_DEVICE_IDENTIFIER, "radio.deviceId", "a safe device identifier");
  serviceUuid && assertMatches(serviceUuid, SAFE_DEVICE_IDENTIFIER, "radio.serviceUuid", "a safe service UUID");
  return Object.freeze({
    transport: transport as TargetSystemRadioTransport,
    ...(deviceId ? { deviceId } : {}),
    ...(serviceUuid ? { serviceUuid } : {}),
  });
}

/**
 * Validates and canonicalizes untrusted QR data. Unknown keys are rejected so
 * future credential-bearing fields cannot silently enter the app.
 */
export function validateOfflineTargetSystemPairingPayload(
  value: unknown,
): OfflineTargetSystemPairingPayload {
  rejectCredentialFields(value, "pairing");
  const record = asRecord(value, "pairing");
  assertOnlyKeys(record, "pairing", ["kind", "version", "systemId", "label", "camera", "radio"]);

  if (record.kind !== "target-system") {
    throw new TargetSystemPairingError("pairing.kind must be target-system.");
  }
  if (record.version !== OFFLINE_TARGET_SYSTEM_PAIRING_VERSION) {
    throw new UnsupportedTargetSystemPairingVersionError(record.version);
  }

  const systemId = requiredString(record, "systemId", "pairing");
  const label = requiredString(record, "label", "pairing");
  assertMatches(systemId, IDENTIFIER, "pairing.systemId", "a safe target-system identifier");
  assertMatches(label, LABEL, "pairing.label", "a short display label without credentials");
  const camera = buildCameraPairing(record.camera);
  const radio = record.radio === undefined ? undefined : buildRadioPairing(record.radio);

  return Object.freeze({
    kind: "target-system",
    version: OFFLINE_TARGET_SYSTEM_PAIRING_VERSION,
    systemId,
    label,
    camera,
    ...(radio ? { radio } : {}),
  });
}

/** Produces a compact canonical QR payload for offline setup. */
export function encodeOfflineTargetSystemPairingPayload(
  value: OfflineTargetSystemPairingPayload,
): string {
  const pairing = validateOfflineTargetSystemPairingPayload(value);
  return `${OFFLINE_TARGET_SYSTEM_PAIRING_PREFIX}${encodeURIComponent(JSON.stringify(pairing))}`;
}

/** Parses only the current offline QR format and refuses unknown future versions. */
export function parseOfflineTargetSystemPairingPayload(rawValue: string): OfflineTargetSystemPairingPayload {
  const raw = rawValue.trim();
  if (raw.length > MAX_QR_PAYLOAD_LENGTH) {
    throw new TargetSystemPairingError("Offline target-system pairing payload is too large.");
  }

  const versionMatch = /^shotsight:pair:v(\d+):/i.exec(raw);
  if (!versionMatch) {
    throw new TargetSystemPairingError("This is not a ShotSight offline target-system pairing QR code.");
  }
  const declaredVersion = Number(versionMatch[1]);
  if (declaredVersion !== OFFLINE_TARGET_SYSTEM_PAIRING_VERSION) {
    throw new UnsupportedTargetSystemPairingVersionError(declaredVersion);
  }

  const encodedJson = raw.slice(versionMatch[0].length);
  if (!encodedJson) {
    throw new TargetSystemPairingError("Offline target-system pairing payload is empty.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(encodedJson));
  } catch {
    throw new TargetSystemPairingError("Offline target-system pairing QR code is malformed.");
  }
  return validateOfflineTargetSystemPairingPayload(parsed);
}
