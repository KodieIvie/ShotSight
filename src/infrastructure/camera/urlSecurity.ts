import type { CameraCredentials } from './CameraAdapter';

const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'auth',
  'key',
  'password',
  'passwd',
  'pwd',
  'token',
  'user',
  'username',
]);

export function normalizeCameraHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    throw new Error('A camera host or local IP address is required.');
  }

  const withoutScheme = trimmed.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
  const withoutPath = withoutScheme.split(/[/?#]/, 1)[0];
  if (!withoutPath) {
    throw new Error('The camera host is not valid.');
  }

  // Keep a bracketed IPv6 literal intact; otherwise remove user info and a supplied port.
  if (withoutPath.startsWith('[')) {
    const closingBracket = withoutPath.indexOf(']');
    if (closingBracket < 0) {
      throw new Error('The camera IPv6 address is not valid.');
    }
    return withoutPath.slice(0, closingBracket + 1);
  }

  const hostOnly = withoutPath.slice(withoutPath.lastIndexOf('@') + 1).split(':', 1)[0];
  if (!hostOnly) {
    throw new Error('The camera host is not valid.');
  }
  return hostOnly;
}

export function interpolateCameraUrl(
  template: string,
  host: string,
  credentials?: CameraCredentials,
): string {
  const substitutions: Readonly<Record<string, string>> = {
    host: normalizeCameraHost(host),
    password: encodeURIComponent(credentials?.password ?? ''),
    username: encodeURIComponent(credentials?.username ?? ''),
  };

  return template.trim().replace(/\{(host|username|password)\}/gi, (_match, key: string) => {
    return substitutions[key.toLowerCase()];
  });
}

export function injectRtspCredentials(url: string, credentials?: CameraCredentials): string {
  if (!credentials || !credentials.username || /:\/\/[^/@]+@/.test(url)) {
    return url;
  }

  return url.replace(
    /^([a-z][a-z\d+.-]*:\/\/)/i,
    `$1${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@`,
  );
}

/** Remove user info and well-known secret query values before reporting an endpoint. */
export function redactCameraUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = 'redacted';
      parsed.password = 'redacted';
    }
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, 'redacted');
      }
    }
    return parsed.toString();
  } catch {
    return value
      .replace(/:\/\/[^/@\s]+@/g, '://redacted:redacted@')
      .replace(
        /([?&](?:access_token|auth|key|password|passwd|pwd|token|user|username)=)[^&#\s]*/gi,
        '$1redacted',
      );
  }
}

export function redactSensitiveText(value: unknown, secrets: readonly string[] = []): string {
  let output = value instanceof Error ? value.message : String(value);
  for (const secret of secrets) {
    if (secret) {
      output = output.split(secret).join('[redacted]');
    }
  }
  output = output.replace(/:\/\/[^/@\s]+@/g, '://redacted:redacted@');
  output = output.replace(
    /([?&](?:access_token|auth|key|password|passwd|pwd|token|user|username)=)[^&#\s]*/gi,
    '$1redacted',
  );
  return output;
}

/** Portable UTF-8 Basic authentication encoder (does not rely on Node's Buffer). */
export function basicAuthorizationHeader(credentials: CameraCredentials): string {
  const bytes = utf8Bytes(`${credentials.username}:${credentials.password}`);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';

  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset];
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(combined >>> 18) & 63];
    encoded += alphabet[(combined >>> 12) & 63];
    encoded += second === undefined ? '=' : alphabet[(combined >>> 6) & 63];
    encoded += third === undefined ? '=' : alphabet[combined & 63];
  }

  return `Basic ${encoded}`;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

export function deduplicateByUrl<T extends { readonly url: string }>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.url)) {
      return false;
    }
    seen.add(value.url);
    return true;
  });
}
