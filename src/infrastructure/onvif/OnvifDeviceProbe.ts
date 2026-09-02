import { basicAuthorizationHeader, redactCameraUrl, redactSensitiveText } from '../camera';
import type { CameraCredentials } from '../camera';

/**
 * This module is intentionally limited to the ONVIF Device service on the
 * local LAN. It does not perform WS-Discovery, use a vendor cloud, follow a
 * camera-supplied remote URL, or persist credentials. Discovery and profile
 * configuration can be layered on top of this small, testable boundary later.
 *
 * ONVIF implementations in the field vary widely. The probe uses SOAP 1.2
 * Device-service requests with HTTP Basic authentication when credentials are
 * supplied. Digest authentication and WS-Security UsernameToken are not yet
 * implemented; callers should surface an authentication result rather than
 * trying to place credentials in a URL.
 *
 * HTTP Basic over plain HTTP is appropriate only for the isolated range LAN
 * threat model. Prefer `protocol: 'https'` when the camera has a trusted local
 * TLS configuration; certificate-pinning policy belongs in a native transport.
 */

export type OnvifProtocol = 'http' | 'https';

export interface OnvifDeviceServiceEndpointInput {
  /** A LAN IPv4/IPv6 address, .local/home.arpa name, or single-label LAN host. */
  readonly host: string;
  /** Defaults to the selected protocol's conventional port (80 or 443). */
  readonly port?: number;
  readonly protocol?: OnvifProtocol;
  /** Defaults to the ONVIF Device service path. Query strings are forbidden. */
  readonly path?: string;
}

/**
 * `url` is safe to send to the camera because endpoint construction forbids
 * user info and query strings. It must still not be emitted by diagnostics
 * outside the local-device context; use `redactedUrl` for that purpose.
 */
export interface OnvifDeviceServiceEndpoint {
  readonly url: string;
  readonly redactedUrl: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: OnvifProtocol;
  readonly path: string;
}

export interface OnvifSafeEndpoint {
  readonly endpoint: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: OnvifProtocol;
  readonly path: string;
}

/** Alias kept separate from stored camera profiles; no credential is persisted here. */
export type OnvifCredentials = CameraCredentials;

export type OnvifProbeOperation = 'GetDeviceInformation' | 'GetCapabilities';

export type OnvifProbeStatus =
  | 'available'
  | 'authentication-required'
  | 'authentication-failed'
  | 'unsupported-service'
  | 'unreachable'
  | 'timeout'
  | 'malformed-response'
  | 'soap-fault'
  | 'transport-error'
  | 'invalid-endpoint';

export interface OnvifSoapFault {
  readonly code?: string;
  readonly subcode?: string;
  readonly reason?: string;
  readonly detail?: string;
}

export interface OnvifProbeAttempt {
  readonly operation: OnvifProbeOperation;
  /** Always redacted; it never contains a username, password, or query secret. */
  readonly endpoint: string;
  readonly latencyMs: number;
  readonly status?: number;
  readonly outcome: 'success' | 'failed';
  readonly failureKind?: Exclude<OnvifProbeStatus, 'available' | 'invalid-endpoint'>;
  /** Sanitized, short SOAP fault information suitable for local diagnostics. */
  readonly fault?: OnvifSoapFault;
  /** Sanitized transport/parsing message. Never includes request headers or raw XML. */
  readonly message?: string;
}

export interface OnvifDeviceInformation {
  readonly manufacturer?: string;
  readonly model?: string;
  readonly firmwareVersion?: string;
  readonly serialNumber?: string;
  readonly hardwareId?: string;
}

/**
 * These service URLs are accepted only when they remain on the local network.
 * `media` means ONVIF Media control is advertised; it does not prove a usable
 * RTSP stream or snapshot URI. Those still require later profile probing.
 */
export interface OnvifDeviceCapabilities {
  readonly device: boolean;
  readonly media: boolean;
  readonly events: boolean;
  readonly imaging: boolean;
  readonly ptz: boolean;
  readonly analytics: boolean;
  readonly deviceServiceUrl?: string;
  readonly mediaServiceUrl?: string;
  readonly eventsServiceUrl?: string;
  readonly imagingServiceUrl?: string;
  readonly ptzServiceUrl?: string;
  readonly analyticsServiceUrl?: string;
}

/**
 * Deliberately diagnostic-safe output. It excludes SOAP bodies, Authorization
 * headers, credentials, and untrusted non-local capability URLs.
 */
export interface OnvifProbeReport {
  readonly status: OnvifProbeStatus;
  readonly endpoint?: OnvifSafeEndpoint;
  readonly deviceInformation?: OnvifDeviceInformation;
  readonly capabilities?: OnvifDeviceCapabilities;
  readonly attempts: readonly OnvifProbeAttempt[];
  readonly message: string;
}

export interface OnvifProbeRequest {
  readonly endpoint: OnvifDeviceServiceEndpointInput;
  readonly credentials?: OnvifCredentials;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** A narrow injectable transport makes this local protocol code device-testable. */
export interface OnvifTransportRequest {
  readonly method: 'POST';
  /** Never contains credentials; auth is supplied only in the in-memory header map. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface OnvifTransportResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

export interface OnvifTransport {
  request(request: OnvifTransportRequest): Promise<OnvifTransportResponse>;
}

/** Default React Native/web transport. It intentionally asks fetch not to follow redirects. */
export class FetchOnvifTransport implements OnvifTransport {
  async request(request: OnvifTransportRequest): Promise<OnvifTransportResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      // A redirect could leave the target's local address. Treat it as a failed probe.
      redirect: 'manual',
    });
    return {
      status: response.status,
      body: await response.text(),
      headers: Object.freeze({
        'content-type': response.headers.get('content-type') ?? undefined,
        'www-authenticate': response.headers.get('www-authenticate') ?? undefined,
      }),
    };
  }
}

export class OnvifEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnvifEndpointError';
  }
}

const DEFAULT_DEVICE_SERVICE_PATH = '/onvif/device_service';
const DEVICE_SERVICE_NAMESPACE = 'http://www.onvif.org/ver10/device/wsdl';
const SOAP_NAMESPACE = 'http://www.w3.org/2003/05/soap-envelope';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARACTERS = 512_000;
const MAX_DIAGNOSTIC_CHARACTERS = 280;

/**
 * Constructs one explicit Device-service endpoint instead of probing vendor
 * cloud or P2P APIs. Only local network hosts are accepted. Hostnames cannot
 * be DNS-verified in portable JS, so the native platform must still enforce
 * its normal local-network permissions and users should prefer a LAN IP.
 */
export function buildOnvifDeviceServiceEndpoint(
  input: OnvifDeviceServiceEndpointInput,
): OnvifDeviceServiceEndpoint {
  const parsedHost = parseHostInput(input.host, input.protocol);
  const protocol = input.protocol ?? parsedHost.protocol ?? 'http';
  if (parsedHost.protocol && parsedHost.protocol !== protocol) {
    throw new OnvifEndpointError('The ONVIF protocol conflicts with the endpoint host.');
  }

  const port = input.port ?? parsedHost.port ?? defaultPort(protocol);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new OnvifEndpointError('The ONVIF port must be between 1 and 65535.');
  }
  if (parsedHost.port !== undefined && input.port !== undefined && parsedHost.port !== input.port) {
    throw new OnvifEndpointError('The ONVIF port conflicts with the endpoint host.');
  }

  const host = normalizeHost(parsedHost.hostname);
  assertLocalNetworkHost(host);
  const path = normalizeDeviceServicePath(input.path ?? DEFAULT_DEVICE_SERVICE_PATH);
  const authority = host.includes(':') ? `[${host}]` : host;
  const visiblePort = port === defaultPort(protocol) ? '' : `:${port}`;
  const url = `${protocol}://${authority}${visiblePort}${path}`;

  return Object.freeze({
    url,
    redactedUrl: redactCameraUrl(url),
    host,
    port,
    protocol,
    path,
  });
}

/** SOAP 1.2 envelope builder for the two standard ONVIF Device operations. */
export function buildOnvifSoapRequest(operation: OnvifProbeOperation): string {
  const body =
    operation === 'GetDeviceInformation'
      ? '<tds:GetDeviceInformation />'
      : '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<s:Envelope xmlns:s="${SOAP_NAMESPACE}" xmlns:tds="${DEVICE_SERVICE_NAMESPACE}">`,
    `<s:Body>${body}</s:Body>`,
    '</s:Envelope>',
  ].join('');
}

export function onvifSoapAction(operation: OnvifProbeOperation): string {
  return `${DEVICE_SERVICE_NAMESPACE}/${operation}`;
}

/**
 * Parses and classifies only the SOAP fault scalar fields. It deliberately
 * does not deserialize arbitrary XML objects, resolve XML entities, or retain
 * an entire camera response in memory for diagnostics.
 */
export function parseOnvifSoapFault(
  xml: string,
  secrets: readonly string[] = [],
): OnvifSoapFault | undefined {
  const faultBody = findElementBody(xml, 'Fault');
  if (faultBody === undefined) {
    return undefined;
  }
  const codeBody = findElementBody(faultBody, 'Code');
  const subcodeBody = findElementBody(faultBody, 'Subcode');
  const reasonBody = findElementBody(faultBody, 'Reason');
  const detailBody = findElementBody(faultBody, 'Detail');
  const fault = {
    code:
      textValue(codeBody ? findElementBody(codeBody, 'Value') : undefined, secrets) ??
      textValue(findElementBody(faultBody, 'faultcode'), secrets),
    subcode: textValue(
      subcodeBody ? findElementBody(subcodeBody, 'Value') : undefined,
      secrets,
    ),
    reason:
      textValue(reasonBody ? findElementBody(reasonBody, 'Text') : undefined, secrets) ??
      textValue(findElementBody(faultBody, 'faultstring'), secrets),
    detail: textValue(detailBody, secrets),
  };
  return freezeDefinedFields(fault);
}

/** Maps a SOAP fault into a user-meaningful, credential-safe probe status. */
export function classifyOnvifSoapFault(
  fault: OnvifSoapFault,
  credentialsSupplied: boolean,
): Extract<
  OnvifProbeStatus,
  'authentication-required' | 'authentication-failed' | 'unsupported-service' | 'soap-fault'
> {
  const text = [fault.code, fault.subcode, fault.reason, fault.detail]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  if (
    /not\s*authorized|notauthorized|unauthori[sz]ed|authentication|auth\s*failed/.test(text)
  ) {
    return credentialsSupplied ? 'authentication-failed' : 'authentication-required';
  }
  if (/action\s*not\s*supported|actionnotsupported|not\s*implemented|operation\s*not\s*supported/.test(text)) {
    return 'unsupported-service';
  }
  return 'soap-fault';
}

/**
 * A local-only ONVIF Device-service probe. It never saves its request data and
 * every returned diagnostic field is redacted/sanitized before it reaches UI.
 */
export class OnvifDeviceProbe {
  constructor(private readonly transport: OnvifTransport = new FetchOnvifTransport()) {}

  async probe(request: OnvifProbeRequest): Promise<OnvifProbeReport> {
    let credentials: OnvifCredentials | undefined;
    let endpoint: OnvifDeviceServiceEndpoint;
    try {
      credentials = validateCredentials(request.credentials);
      endpoint = buildOnvifDeviceServiceEndpoint(request.endpoint);
    } catch (error) {
      return Object.freeze({
        status: 'invalid-endpoint' as const,
        attempts: Object.freeze([]),
        message: safeEndpointError(error),
      });
    }

    const safeEndpoint = toSafeEndpoint(endpoint);
    const information = await this.performOperation<OnvifDeviceInformation>(
      'GetDeviceInformation',
      endpoint,
      credentials,
      request,
    );
    if (information.value === undefined) {
      return Object.freeze({
        status: information.failureKind,
        endpoint: safeEndpoint,
        attempts: Object.freeze([information.attempt]),
        message: reportMessage(information.failureKind),
      });
    }

    const capabilities = await this.performOperation<OnvifDeviceCapabilities>(
      'GetCapabilities',
      endpoint,
      credentials,
      request,
    );
    if (capabilities.value === undefined) {
      return Object.freeze({
        status: capabilities.failureKind,
        endpoint: safeEndpoint,
        deviceInformation: information.value,
        attempts: Object.freeze([information.attempt, capabilities.attempt]),
        message: reportMessage(capabilities.failureKind),
      });
    }

    return Object.freeze({
      status: 'available' as const,
      endpoint: safeEndpoint,
      deviceInformation: information.value,
      capabilities: capabilities.value,
      attempts: Object.freeze([information.attempt, capabilities.attempt]),
      message: 'The local ONVIF Device service responded to standard capability requests.',
    });
  }

  private async performOperation<T>(
    operation: OnvifProbeOperation,
    endpoint: OnvifDeviceServiceEndpoint,
    credentials: OnvifCredentials | undefined,
    options: OnvifProbeRequest,
  ): Promise<OperationResult<T>> {
    const startedAt = Date.now();
    const timeout = normalizedTimeout(options.timeoutMs);
    const abort = linkedAbortController(options.signal, timeout);
    const secretValues = credentialSecrets(credentials);
    try {
      const response = await this.transport.request({
        method: 'POST',
        url: endpoint.url,
        headers: buildRequestHeaders(operation, credentials),
        body: buildOnvifSoapRequest(operation),
        signal: abort.controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (response.body.length > MAX_RESPONSE_CHARACTERS) {
        return failureResult(
          operation,
          endpoint,
          latencyMs,
          'malformed-response',
          response.status,
          undefined,
          'The ONVIF response was too large to parse safely.',
        );
      }

      const soapFault = parseOnvifSoapFault(response.body, secretValues);
      if (response.status < 200 || response.status >= 300) {
        const failureKind = soapFault
          ? classifyOnvifSoapFault(soapFault, Boolean(credentials))
          : classifyHttpFailure(response.status, Boolean(credentials));
        return failureResult(
          operation,
          endpoint,
          latencyMs,
          failureKind,
          response.status,
          soapFault,
        );
      }
      if (soapFault) {
        return failureResult(
          operation,
          endpoint,
          latencyMs,
          classifyOnvifSoapFault(soapFault, Boolean(credentials)),
          response.status,
          soapFault,
        );
      }

      const parsed =
        operation === 'GetDeviceInformation'
          ? parseDeviceInformationResponse(response.body, secretValues)
          : parseCapabilitiesResponse(response.body, secretValues);
      if (parsed.kind === 'failure') {
        return failureResult(
          operation,
          endpoint,
          latencyMs,
          parsed.failureKind,
          response.status,
          parsed.fault,
          parsed.message,
        );
      }
      return {
        value: parsed.value as T,
        attempt: Object.freeze({
          operation,
          endpoint: endpoint.redactedUrl,
          latencyMs,
          status: response.status,
          outcome: 'success' as const,
        }),
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const failureKind: Extract<OnvifProbeStatus, 'timeout' | 'transport-error'> = abort.timedOut
        ? 'timeout'
        : 'transport-error';
      return failureResult(
        operation,
        endpoint,
        latencyMs,
        failureKind,
        undefined,
        undefined,
        safeTransportError(error, secretValues),
      );
    } finally {
      abort.dispose();
    }
  }
}

type ParsedResponse<T> =
  | { readonly kind: 'success'; readonly value: T }
  | {
      readonly kind: 'failure';
      readonly failureKind: Extract<OnvifProbeStatus, 'malformed-response' | 'soap-fault'>;
      readonly message: string;
      readonly fault?: OnvifSoapFault;
    };

type OperationResult<T> =
  | { readonly value: T; readonly attempt: OnvifProbeAttempt }
  | {
      readonly value: undefined;
      readonly failureKind: Exclude<OnvifProbeStatus, 'available' | 'invalid-endpoint'>;
      readonly attempt: OnvifProbeAttempt;
    };

function parseDeviceInformationResponse(
  xml: string,
  secrets: readonly string[],
): ParsedResponse<OnvifDeviceInformation> {
  if (!hasElement(xml, 'GetDeviceInformationResponse')) {
    return malformedResponse('The camera did not return an ONVIF GetDeviceInformation response.');
  }
  return {
    kind: 'success',
    value: freezeDefinedFields({
      manufacturer: textValue(findElementBody(xml, 'Manufacturer'), secrets),
      model: textValue(findElementBody(xml, 'Model'), secrets),
      firmwareVersion: textValue(findElementBody(xml, 'FirmwareVersion'), secrets),
      serialNumber: textValue(findElementBody(xml, 'SerialNumber'), secrets),
      hardwareId: textValue(findElementBody(xml, 'HardwareId'), secrets),
    }),
  };
}

function parseCapabilitiesResponse(
  xml: string,
  secrets: readonly string[],
): ParsedResponse<OnvifDeviceCapabilities> {
  if (!hasElement(xml, 'GetCapabilitiesResponse')) {
    return malformedResponse('The camera did not return an ONVIF GetCapabilities response.');
  }

  const deviceServiceUrl = localCapabilityUrl(xml, 'Device', secrets);
  const mediaServiceUrl = localCapabilityUrl(xml, 'Media', secrets);
  const eventsServiceUrl = localCapabilityUrl(xml, 'Events', secrets);
  const imagingServiceUrl = localCapabilityUrl(xml, 'Imaging', secrets);
  const ptzServiceUrl = localCapabilityUrl(xml, 'PTZ', secrets);
  const analyticsServiceUrl = localCapabilityUrl(xml, 'Analytics', secrets);

  return {
    kind: 'success',
    value: freezeDefinedFields({
      device: Boolean(deviceServiceUrl),
      media: Boolean(mediaServiceUrl),
      events: Boolean(eventsServiceUrl),
      imaging: Boolean(imagingServiceUrl),
      ptz: Boolean(ptzServiceUrl),
      analytics: Boolean(analyticsServiceUrl),
      deviceServiceUrl,
      mediaServiceUrl,
      eventsServiceUrl,
      imagingServiceUrl,
      ptzServiceUrl,
      analyticsServiceUrl,
    }),
  };
}

function malformedResponse(message: string): ParsedResponse<never> {
  return { kind: 'failure', failureKind: 'malformed-response', message };
}

function localCapabilityUrl(
  xml: string,
  capabilityName: string,
  secrets: readonly string[],
): string | undefined {
  const capabilityBody = findElementBody(xml, capabilityName);
  const xAddr = textValue(
    capabilityBody ? findElementBody(capabilityBody, 'XAddr') : undefined,
    secrets,
  );
  if (!xAddr) {
    return undefined;
  }
  return sanitizeLocalCapabilityUrl(xAddr);
}

function sanitizeLocalCapabilityUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const protocol = parsed.protocol.replace(':', '') as OnvifProtocol;
    if ((protocol !== 'http' && protocol !== 'https') || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return undefined;
    }
    const host = normalizeHost(parsed.hostname);
    assertLocalNetworkHost(host);
    return redactCameraUrl(parsed.toString());
  } catch {
    // A camera-advertised URL is untrusted input. Ignore it rather than making
    // a later layer accidentally use a cloud/P2P endpoint.
    return undefined;
  }
}

function failureResult(
  operation: OnvifProbeOperation,
  endpoint: OnvifDeviceServiceEndpoint,
  latencyMs: number,
  failureKind: Exclude<OnvifProbeStatus, 'available' | 'invalid-endpoint'>,
  status?: number,
  fault?: OnvifSoapFault,
  message?: string,
): OperationResult<never> {
  return {
    value: undefined,
    failureKind,
    attempt: Object.freeze({
      operation,
      endpoint: endpoint.redactedUrl,
      latencyMs,
      status,
      outcome: 'failed' as const,
      failureKind,
      fault,
      message,
    }),
  };
}

function buildRequestHeaders(
  operation: OnvifProbeOperation,
  credentials: OnvifCredentials | undefined,
): Readonly<Record<string, string>> {
  const action = onvifSoapAction(operation);
  const headers: Record<string, string> = {
    Accept: 'application/soap+xml, text/xml, application/xml',
    'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
    // Several older ONVIF devices require this compatibility header even with SOAP 1.2.
    SOAPAction: `"${action}"`,
  };
  if (credentials) {
    headers.Authorization = basicAuthorizationHeader(credentials);
  }
  return Object.freeze(headers);
}

function validateCredentials(credentials: OnvifCredentials | undefined): OnvifCredentials | undefined {
  if (!credentials) {
    return undefined;
  }
  if (!credentials.username.trim() || /[\r\n]/.test(credentials.username) || /[\r\n]/.test(credentials.password)) {
    // Do not put caller input in this error; it may contain a credential.
    throw new OnvifEndpointError('ONVIF credentials must include a valid username.');
  }
  return credentials;
}

function classifyHttpFailure(
  status: number,
  credentialsSupplied: boolean,
): Exclude<OnvifProbeStatus, 'available' | 'invalid-endpoint'> {
  if (status === 401 || status === 403) {
    return credentialsSupplied ? 'authentication-failed' : 'authentication-required';
  }
  if (status === 404 || status === 405 || status === 501 || (status >= 300 && status < 400)) {
    return 'unsupported-service';
  }
  if (status === 408 || status === 504) {
    return 'timeout';
  }
  if (status >= 500) {
    return 'unreachable';
  }
  return 'soap-fault';
}

function reportMessage(status: Exclude<OnvifProbeStatus, 'available' | 'invalid-endpoint'>): string {
  switch (status) {
    case 'authentication-required':
      return 'The local ONVIF Device service requires camera credentials.';
    case 'authentication-failed':
      return 'The local ONVIF Device service rejected the supplied camera credentials.';
    case 'unsupported-service':
      return 'No compatible ONVIF Device service responded at this local endpoint.';
    case 'unreachable':
      return 'The local camera could not complete the ONVIF request.';
    case 'timeout':
      return 'The local ONVIF request timed out.';
    case 'malformed-response':
      return 'The local camera returned a response that was not a usable ONVIF Device reply.';
    case 'soap-fault':
      return 'The local camera returned an ONVIF SOAP fault.';
    case 'transport-error':
      return 'The local ONVIF request could not be sent.';
  }
}

function safeEndpointError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The ONVIF endpoint is not valid.';
  return message.startsWith('The ONVIF') || message.startsWith('ONVIF')
    ? message
    : 'The ONVIF endpoint is not valid.';
}

function safeTransportError(error: unknown, secrets: readonly string[]): string {
  const redacted = redactSensitiveText(error, secrets)
    .replace(/(authorization\s*:\s*(?:basic|digest|bearer)\s+)[^\s;]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(redacted || 'The local ONVIF request failed.', MAX_DIAGNOSTIC_CHARACTERS);
}

function credentialSecrets(credentials: OnvifCredentials | undefined): readonly string[] {
  if (!credentials) {
    return [];
  }
  return [
    credentials.username,
    credentials.password,
    basicAuthorizationHeader(credentials),
  ];
}

function parseHostInput(
  rawHost: string,
  requestedProtocol: OnvifProtocol | undefined,
): { readonly hostname: string; readonly protocol?: OnvifProtocol; readonly port?: number } {
  const trimmed = rawHost.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new OnvifEndpointError('A local ONVIF host is required.');
  }
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(hasProtocol ? trimmed : `http://${trimmed}`);
  } catch {
    throw new OnvifEndpointError('The local ONVIF host is not valid.');
  }
  const protocol = parsed.protocol.replace(':', '').toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') {
    throw new OnvifEndpointError('ONVIF probing supports only HTTP or HTTPS local endpoints.');
  }
  if (parsed.username || parsed.password) {
    throw new OnvifEndpointError('ONVIF endpoints must not include credentials in the URL.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new OnvifEndpointError('Use the ONVIF path field instead of a path, query, or fragment in the host.');
  }
  const hostname = parsed.hostname;
  if (!hostname) {
    throw new OnvifEndpointError('The local ONVIF host is not valid.');
  }
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : undefined;
  if (requestedProtocol && requestedProtocol !== protocol && hasProtocol) {
    throw new OnvifEndpointError('The ONVIF protocol conflicts with the endpoint host.');
  }
  return { hostname, protocol: hasProtocol ? (protocol as OnvifProtocol) : undefined, port };
}

function normalizeHost(host: string): string {
  const normalized = host.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized || normalized.includes('/') || normalized.includes('@')) {
    throw new OnvifEndpointError('The local ONVIF host is not valid.');
  }
  return normalized;
}

function assertLocalNetworkHost(host: string): void {
  if (isPrivateIpv4(host) || isLocalIpv6(host) || isLocalHostname(host)) {
    return;
  }
  throw new OnvifEndpointError('ONVIF probing is limited to a local LAN address or local hostname.');
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => part > 255)) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isLocalIpv6(host: string): boolean {
  if (!host.includes(':')) {
    return false;
  }
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('fc') || normalized.startsWith('fd');
}

function isLocalHostname(host: string): boolean {
  if (host === 'localhost') {
    return true;
  }
  if (host.endsWith('.local') || host.endsWith('.home.arpa')) {
    return true;
  }
  // A bare label cannot be a public DNS name, and is common for a camera on
  // an isolated AP. Fully-qualified public names are intentionally rejected.
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host);
}

function normalizeDeviceServicePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[?#\r\n]/.test(trimmed)) {
    throw new OnvifEndpointError('The ONVIF Device service path is not valid.');
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new OnvifEndpointError('The ONVIF Device service path cannot contain traversal segments.');
  }
  return trimmed.replace(/\/{2,}/g, '/');
}

function defaultPort(protocol: OnvifProtocol): number {
  return protocol === 'https' ? 443 : 80;
}

function toSafeEndpoint(endpoint: OnvifDeviceServiceEndpoint): OnvifSafeEndpoint {
  return Object.freeze({
    endpoint: endpoint.redactedUrl,
    host: endpoint.host,
    port: endpoint.port,
    protocol: endpoint.protocol,
    path: endpoint.path,
  });
}

function hasElement(xml: string, localName: string): boolean {
  return findElementBody(xml, localName) !== undefined;
}

/**
 * Small, non-validating namespace-tolerant extractor for fixed ONVIF scalar
 * fields. It does not expand external entities or execute XML constructs.
 */
function findElementBody(xml: string, localName: string): string | undefined {
  const escaped = escapeRegExp(localName);
  const qualified = `(?:[A-Za-z_][A-Za-z0-9_.-]*:)?${escaped}`;
  const open = new RegExp(`<${qualified}(?:\\s[^>]*)?>`, 'i');
  const opening = open.exec(xml);
  if (!opening || opening.index === undefined) {
    return undefined;
  }
  const afterOpening = opening.index + opening[0].length;
  const closing = new RegExp(`</${qualified}\\s*>`, 'i').exec(xml.slice(afterOpening));
  if (!closing || closing.index === undefined) {
    return undefined;
  }
  return xml.slice(afterOpening, afterOpening + closing.index);
}

function textValue(markup: string | undefined, secrets: readonly string[]): string | undefined {
  if (markup === undefined) {
    return undefined;
  }
  const withoutMarkup = markup
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<!\[CDATA\[([^]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '');
  const decoded = decodeXmlEntities(withoutMarkup)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!decoded) {
    return undefined;
  }
  return truncate(
    redactSensitiveText(decoded, secrets)
      .replace(/(authorization\s*:\s*(?:basic|digest|bearer)\s+)[^\s;]+/gi, '$1[redacted]'),
    MAX_DIAGNOSTIC_CHARACTERS,
  );
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const name = entity.slice(1, -1).toLowerCase();
    switch (name) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const numeric = name.startsWith('#x')
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) {
          return '';
        }
        try {
          return String.fromCodePoint(numeric);
        } catch {
          return '';
        }
      }
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function freezeDefinedFields<T extends Record<string, unknown>>(value: T): T {
  const compact = Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
  return Object.freeze(compact);
}

function normalizedTimeout(requested: number | undefined): number {
  if (requested === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(requested) || requested < 1) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.round(requested), MAX_TIMEOUT_MS);
}

function linkedAbortController(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly controller: AbortController;
  readonly timedOut: boolean;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Local ONVIF request timed out.'));
  }, timeoutMs);
  return {
    controller,
    get timedOut() {
      return timedOut;
    },
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}
