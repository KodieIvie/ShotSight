import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type {
  CameraAdapter,
  CameraEndpointContext,
  HttpSnapshotCandidate,
} from '../camera';
import { redactSensitiveText } from '../camera';

export type SnapshotProbeOutcome =
  | 'available'
  | 'authentication-required'
  | 'unavailable'
  | 'inconclusive';

export interface SnapshotProbeAttempt {
  readonly candidateId: string;
  readonly endpoint: string;
  readonly stage: 'head' | 'range-get';
  readonly outcome: SnapshotProbeOutcome;
  readonly status?: number;
  readonly latencyMs: number;
  readonly mimeType?: string;
  readonly message?: string;
}

export interface SnapshotProbeReport {
  readonly available: boolean;
  readonly selectedCandidateId?: string;
  readonly attempts: readonly SnapshotProbeAttempt[];
}

export interface SnapshotProbeOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SnapshotCaptureOptions {
  readonly sessionId: string;
  readonly captureId: string;
  readonly previewMaxDimension?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly candidateId: string;
    readonly bytesWritten: number;
    readonly totalBytes: number;
  }) => void;
}

export interface SnapshotCaptureAttempt {
  readonly candidateId: string;
  readonly endpoint: string;
  readonly latencyMs: number;
  readonly message: string;
}

export interface CapturedSnapshotFile {
  readonly originalImageUri: string;
  readonly previewImageUri?: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly latencyMs: number;
  readonly candidateId: string;
  readonly endpoint: string;
  readonly previewWarning?: string;
  readonly failedAttempts: readonly SnapshotCaptureAttempt[];
}

export class SnapshotCaptureError extends Error {
  constructor(readonly attempts: readonly SnapshotCaptureAttempt[]) {
    super(
      attempts.length
        ? `No high-resolution snapshot endpoint succeeded: ${attempts
            .map((attempt) => `${attempt.candidateId}: ${attempt.message}`)
            .join('; ')}`
        : 'This camera profile does not provide an HTTP snapshot endpoint.',
    );
    this.name = 'SnapshotCaptureError';
  }
}

/**
 * Probes and captures native HTTP stills on the local LAN. Originals are never
 * resized or recompressed; a separate UI preview is generated off the JS thread.
 */
export class HttpSnapshotService {
  constructor(
    private readonly capturesRoot: Directory = new Directory(
      Paths.document,
      'shotsight',
      'captures',
    ),
  ) {}

  async probe(
    adapter: CameraAdapter,
    context: CameraEndpointContext,
    options: SnapshotProbeOptions = {},
  ): Promise<SnapshotProbeReport> {
    const candidates = adapter.getSnapshotCandidates(context);
    const attempts: SnapshotProbeAttempt[] = [];
    for (const candidate of candidates) {
      const head = await this.probeCandidate(candidate, 'head', context, options);
      attempts.push(head);
      if (head.outcome === 'available') {
        return {
          available: true,
          selectedCandidateId: candidate.id,
          attempts: Object.freeze(attempts),
        };
      }
      if (head.outcome === 'authentication-required') {
        continue;
      }

      // Many embedded cameras reject HEAD. A one-byte range request verifies
      // the actual image endpoint without intentionally decoding the full still.
      const range = await this.probeCandidate(candidate, 'range-get', context, options);
      attempts.push(range);
      if (range.outcome === 'available') {
        return {
          available: true,
          selectedCandidateId: candidate.id,
          attempts: Object.freeze(attempts),
        };
      }
    }
    return { available: false, attempts: Object.freeze(attempts) };
  }

  async capture(
    adapter: CameraAdapter,
    context: CameraEndpointContext,
    options: SnapshotCaptureOptions,
  ): Promise<CapturedSnapshotFile> {
    const candidates = adapter.getSnapshotCandidates({
      ...context,
      nonce: context.nonce ?? `${Date.now()}`,
    });
    const failures: SnapshotCaptureAttempt[] = [];
    this.capturesRoot.create({ intermediates: true, idempotent: true });
    const sessionDirectory = new Directory(
      this.capturesRoot,
      safeFileSegment(options.sessionId),
    );
    sessionDirectory.create({ intermediates: true, idempotent: true });

    for (const candidate of candidates) {
      const temporary = new File(
        sessionDirectory,
        `${safeFileSegment(options.captureId)}-original.part`,
      );
      let finalized: File | undefined;
      const startedAt = Date.now();
      const abort = linkedAbortController(options.signal, options.timeoutMs ?? 20_000);
      try {
        const downloaded = await File.downloadFileAsync(candidate.url, temporary, {
          headers: { Accept: 'image/jpeg,image/png,image/webp,*/*', ...candidate.headers },
          idempotent: true,
          signal: abort.controller.signal,
          onProgress: ({ bytesWritten, totalBytes }) =>
            options.onProgress?.({
              candidateId: candidate.id,
              bytesWritten,
              totalBytes,
            }),
        });
        const detected = inspectImageFile(downloaded);
        finalized = new File(
          sessionDirectory,
          `${safeFileSegment(options.captureId)}-original.${extensionForMime(detected.mimeType)}`,
        );
        await downloaded.move(finalized, { overwrite: true });
        const dimensions = await imageDimensions(finalized.uri);
        const preview = await this.createPreview(
          finalized,
          sessionDirectory,
          options.captureId,
          dimensions,
          options.previewMaxDimension ?? 1_600,
        );
        return Object.freeze({
          originalImageUri: finalized.uri,
          previewImageUri: preview.uri,
          widthPixels: dimensions.width,
          heightPixels: dimensions.height,
          mimeType: detected.mimeType,
          byteLength: finalized.size,
          latencyMs: Date.now() - startedAt,
          candidateId: candidate.id,
          endpoint: candidate.redactedUrl,
          previewWarning: preview.warning,
          failedAttempts: Object.freeze(failures),
        });
      } catch (error) {
        if (temporary.exists) {
          temporary.delete();
        }
        if (finalized?.exists) {
          finalized.delete();
        }
        failures.push({
          candidateId: candidate.id,
          endpoint: candidate.redactedUrl,
          latencyMs: Date.now() - startedAt,
          message: safeError(error, context),
        });
      } finally {
        abort.dispose();
      }
    }
    throw new SnapshotCaptureError(Object.freeze(failures));
  }

  private async probeCandidate(
    candidate: HttpSnapshotCandidate,
    stage: SnapshotProbeAttempt['stage'],
    context: CameraEndpointContext,
    options: SnapshotProbeOptions,
  ): Promise<SnapshotProbeAttempt> {
    const startedAt = Date.now();
    const abort = linkedAbortController(options.signal, options.timeoutMs ?? 4_000);
    try {
      const response = await fetch(candidate.url, {
        method: stage === 'head' ? 'HEAD' : 'GET',
        headers: {
          Accept: 'image/jpeg,image/png,image/webp,*/*',
          ...(stage === 'range-get' ? { Range: 'bytes=0-0' } : {}),
          ...candidate.headers,
        },
        signal: abort.controller.signal,
      });
      const mimeType = response.headers.get('content-type')?.split(';', 1)[0];
      if (stage === 'range-get') {
        void response.body?.cancel().catch(() => undefined);
      }
      const outcome = probeOutcome(response.status, mimeType);
      return {
        candidateId: candidate.id,
        endpoint: candidate.redactedUrl,
        stage,
        outcome,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        mimeType,
      };
    } catch (error) {
      return {
        candidateId: candidate.id,
        endpoint: candidate.redactedUrl,
        stage,
        outcome: 'inconclusive',
        latencyMs: Date.now() - startedAt,
        message: safeError(error, context),
      };
    } finally {
      abort.dispose();
    }
  }

  private async createPreview(
    original: File,
    directory: Directory,
    captureId: string,
    dimensions: { readonly width: number; readonly height: number },
    maxDimension: number,
  ): Promise<{ readonly uri?: string; readonly warning?: string }> {
    try {
      const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height));
      const context = ImageManipulator.manipulate(original.uri);
      context.resize({
        width: Math.max(1, Math.round(dimensions.width * scale)),
        height: Math.max(1, Math.round(dimensions.height * scale)),
      });
      const rendered = await context.renderAsync();
      const temporary = await rendered.saveAsync({
        compress: 0.82,
        format: SaveFormat.JPEG,
      });
      const preview = new File(
        directory,
        `${safeFileSegment(captureId)}-preview.jpg`,
      );
      await new File(temporary.uri).move(preview, { overwrite: true });
      return { uri: preview.uri };
    } catch (error) {
      // Capturing the irreplaceable original succeeded. Keep it and allow the UI
      // to fall back while reporting that the disposable preview can be retried.
      return { warning: `Preview generation failed: ${redactSensitiveText(error)}` };
    }
  }
}

function inspectImageFile(file: File): { readonly mimeType: string } {
  if (!file.exists || file.size < 16) {
    throw new Error('The camera returned an empty snapshot.');
  }
  const handle = file.open(FileMode.ReadOnly);
  let bytes: Uint8Array;
  try {
    bytes = handle.readBytes(16);
  } finally {
    handle.close();
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg' };
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mimeType: 'image/png' };
  }
  if (
    String.fromCharCode(...Array.from(bytes.slice(0, 4))) === 'RIFF' &&
    String.fromCharCode(...Array.from(bytes.slice(8, 12))) === 'WEBP'
  ) {
    return { mimeType: 'image/webp' };
  }
  throw new Error('The camera response is not a supported image (it may be an API error).');
}

function extensionForMime(mimeType: string): 'jpg' | 'png' | 'webp' {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

async function imageDimensions(uri: string): Promise<{ readonly width: number; readonly height: number }> {
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  if (rendered.width < 1 || rendered.height < 1) {
    throw new Error('The snapshot dimensions are invalid.');
  }
  return { width: rendered.width, height: rendered.height };
}

function probeOutcome(status: number, mimeType?: string): SnapshotProbeOutcome {
  if (status === 401 || status === 403) {
    return 'authentication-required';
  }
  if (status >= 200 && status < 300 && mimeType?.toLowerCase().startsWith('image/')) {
    return 'available';
  }
  if (status === 404 || status >= 500) {
    return 'unavailable';
  }
  return 'inconclusive';
}

function safeFileSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('A valid session and capture ID is required.');
  }
  return safe;
}

function safeError(error: unknown, context: CameraEndpointContext): string {
  return redactSensitiveText(error, [
    context.credentials?.username ?? '',
    context.credentials?.password ?? '',
  ]);
}

function linkedAbortController(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly controller: AbortController;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('Local camera request timed out.')), timeoutMs);
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}
