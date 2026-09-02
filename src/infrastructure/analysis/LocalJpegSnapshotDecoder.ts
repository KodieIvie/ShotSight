import { File } from 'expo-file-system';
import { decode } from 'jpeg-js';

import type { AnalysisImage } from '../../domain';
import { rgbaToGray, type GrayFrame } from './localPipeline';

export interface DecodedLocalImage {
  readonly image: AnalysisImage;
  readonly frame: GrayFrame;
}

export interface LocalImageDecoder {
  decode(image: AnalysisImage): Promise<DecodedLocalImage>;
}

/** A small seam so decoder tests and future native decoders do not need Expo I/O. */
export interface LocalImageByteReader {
  read(uri: string): Promise<Uint8Array>;
}

export class LocalJpegDecodeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LocalJpegDecodeError';
  }
}

/** Reads only device-local URI schemes; no image bytes are sent over a network. */
export class ExpoLocalImageByteReader implements LocalImageByteReader {
  async read(uri: string): Promise<Uint8Array> {
    if (!isDeviceLocalUri(uri)) {
      throw new LocalJpegDecodeError('Image analysis accepts saved file:// or content:// snapshots only.');
    }
    try {
      return await new File(uri).bytes();
    } catch (error) {
      throw new LocalJpegDecodeError(`Unable to read the saved snapshot: ${messageFor(error)}`, error);
    }
  }
}

export interface JpegSnapshotDecoderOptions {
  /** Guardrail against malformed camera responses exhausting a device's memory. */
  readonly maxResolutionMegapixels?: number;
  readonly maxMemoryMegabytes?: number;
}

/**
 * A pure-JS JPEG decoder fronted by Expo's modern File.bytes() API. jpeg-js is
 * asked for Uint8Array output so Hermes does not need a global Node Buffer.
 */
export class JpegSnapshotDecoder implements LocalImageDecoder {
  private readonly reader: LocalImageByteReader;
  private readonly maxResolutionMegapixels: number;
  private readonly maxMemoryMegabytes: number;

  constructor(
    reader: LocalImageByteReader = new ExpoLocalImageByteReader(),
    options: JpegSnapshotDecoderOptions = {},
  ) {
    this.reader = reader;
    this.maxResolutionMegapixels = positiveFinite(options.maxResolutionMegapixels ?? 12, 'maxResolutionMegapixels');
    this.maxMemoryMegabytes = positiveFinite(options.maxMemoryMegabytes ?? 96, 'maxMemoryMegabytes');
  }

  async decode(image: AnalysisImage): Promise<DecodedLocalImage> {
    const bytes = await this.reader.read(image.uri);
    const frame = decodeJpegBytes(bytes, {
      maxResolutionMegapixels: this.maxResolutionMegapixels,
      maxMemoryMegabytes: this.maxMemoryMegabytes,
    });
    if (frame.width !== image.widthPixels || frame.height !== image.heightPixels) {
      throw new LocalJpegDecodeError(
        `Decoded JPEG dimensions (${frame.width}x${frame.height}) do not match the capture metadata (${image.widthPixels}x${image.heightPixels}).`,
      );
    }
    return Object.freeze({ image, frame });
  }
}

export function decodeJpegBytes(
  bytes: Uint8Array,
  options: JpegSnapshotDecoderOptions = {},
): GrayFrame {
  if (!isJpeg(bytes)) {
    throw new LocalJpegDecodeError('The saved snapshot is not a JPEG image. PNG and WebP decoding can be added behind this same adapter later.');
  }
  try {
    const decoded = decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: positiveFinite(options.maxResolutionMegapixels ?? 12, 'maxResolutionMegapixels'),
      maxMemoryUsageInMB: positiveFinite(options.maxMemoryMegabytes ?? 96, 'maxMemoryMegabytes'),
    });
    if (decoded.width < 1 || decoded.height < 1 || decoded.data.length !== decoded.width * decoded.height * 4) {
      throw new LocalJpegDecodeError('The JPEG decoder returned invalid pixel data.');
    }
    return rgbaToGray(decoded.data, decoded.width, decoded.height);
  } catch (error) {
    if (error instanceof LocalJpegDecodeError) throw error;
    throw new LocalJpegDecodeError(`Unable to decode JPEG snapshot: ${messageFor(error)}`, error);
  }
}

export function isDeviceLocalUri(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('content://');
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
