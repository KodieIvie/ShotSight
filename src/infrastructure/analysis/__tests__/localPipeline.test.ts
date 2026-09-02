import { describe, expect, it, vi } from 'vitest';
import { encode } from 'jpeg-js';

vi.mock('expo-file-system', () => ({ File: class File {} }));

import {
  analyzeLocalFrames,
  rgbaToGray,
  resizeGrayFrame,
  type GrayFrame,
} from '../localPipeline';
import { LocalImageAnalysisService } from '../LocalImageAnalysisService';
import { decodeJpegBytes } from '../LocalJpegSnapshotDecoder';
import type { AnalysisImage, ImageAnalysisRequest } from '../../../domain';

function makeTarget(width = 160, height = 120): GrayFrame {
  const data = new Float32Array(width * height);
  const centerX = width / 2;
  const centerY = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      let value = 178 + ((x * 13 + y * 7) % 11) - 5;
      if (Math.abs(distance - 34) < 1.5 || Math.abs(distance - 18) < 1.5) value = 70;
      if (Math.abs(x - centerX) < 1 || Math.abs(y - centerY) < 1) value = Math.min(value, 105);
      if ((x > 12 && x < 26 && y > 13 && y < 17) || (x > 126 && x < 140 && y > 92 && y < 97)) value = 115;
      data[y * width + x] = value;
    }
  }
  return { width, height, data };
}

function shiftImage(reference: GrayFrame, offsetX: number, offsetY: number, fill = 178): GrayFrame {
  const data = new Float32Array(reference.data.length);
  data.fill(fill);
  for (let y = 0; y < reference.height; y += 1) {
    for (let x = 0; x < reference.width; x += 1) {
      const destinationX = x + offsetX;
      const destinationY = y + offsetY;
      if (destinationX >= 0 && destinationY >= 0 && destinationX < reference.width && destinationY < reference.height) {
        data[destinationY * reference.width + destinationX] = reference.data[y * reference.width + x];
      }
    }
  }
  return { width: reference.width, height: reference.height, data };
}

function addDarkImpact(image: GrayFrame, x: number, y: number, radius = 4): GrayFrame {
  const data = new Float32Array(image.data);
  for (let sampleY = Math.floor(y - radius); sampleY <= Math.ceil(y + radius); sampleY += 1) {
    for (let sampleX = Math.floor(x - radius); sampleX <= Math.ceil(x + radius); sampleX += 1) {
      if (sampleX >= 0 && sampleY >= 0 && sampleX < image.width && sampleY < image.height && Math.hypot(sampleX - x, sampleY - y) <= radius) {
        data[sampleY * image.width + sampleX] = 24;
      }
    }
  }
  return { width: image.width, height: image.height, data };
}

describe('device-local analysis pipeline', () => {
  it('converts JPEG-style RGBA pixels to stable luminance', () => {
    const frame = rgbaToGray(new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]), 2, 1);

    expect(frame.data[0]).toBeCloseTo(54.213, 2);
    expect(frame.data[1]).toBeCloseTo(182.376, 2);
  });

  it('decodes a local JPEG byte buffer without a Node Buffer requirement in the adapter', () => {
    const source = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    const encoded = encode({ width: 2, height: 2, data: source }, 95);
    const frame = decodeJpegBytes(new Uint8Array(encoded.data));

    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    expect(frame.data).toHaveLength(4);
    expect(frame.data.every(Number.isFinite)).toBe(true);
  });

  it('keeps pixel centers stable when it bounds a decoded frame', () => {
    const frame: GrayFrame = {
      width: 2,
      height: 2,
      data: new Float32Array([0, 100, 200, 255]),
    };
    const resized = resizeGrayFrame(frame, 4, 4);

    expect(resized.width).toBe(4);
    expect(resized.height).toBe(4);
    expect(resized.data[0]).toBe(0);
    expect(resized.data[15]).toBe(255);
    expect(resized.data[5]).toBeGreaterThan(0);
    expect(resized.data[5]).toBeLessThan(100);
  });

  it('registers a shifted capture and finds its new dark impact', () => {
    const reference = makeTarget();
    const impact = { x: 112, y: 73 };
    const offset = { x: 4, y: -2 };
    const current = addDarkImpact(
      shiftImage(reference, offset.x, offset.y),
      impact.x + offset.x,
      impact.y + offset.y,
    );

    const result = analyzeLocalFrames(reference, current, { maxShift: 8, sensitivity: 'medium' });

    expect(result.registration.offsetX).toBe(offset.x);
    expect(result.registration.offsetY).toBe(offset.y);
    expect(result.candidates.some((candidate) => Math.hypot(candidate.x - impact.x, candidate.y - impact.y) < 5)).toBe(true);
  });

  it('keeps candidate search inside the locked target ROI', () => {
    const reference = makeTarget();
    const inside = { x: 100, y: 70 };
    const outside = { x: 34, y: 82 };
    let current = addDarkImpact(reference, inside.x, inside.y, 4);
    current = addDarkImpact(current, outside.x, outside.y, 4);

    const result = analyzeLocalFrames(reference, current, {
      sensitivity: 'medium',
      roi: { x: 72, y: 42, width: 56, height: 48 },
    });

    expect(result.candidates.some((candidate) => Math.hypot(candidate.x - inside.x, candidate.y - inside.y) < 5)).toBe(true);
    expect(result.candidates.some((candidate) => Math.hypot(candidate.x - outside.x, candidate.y - outside.y) < 5)).toBe(false);
  });

  it('maps bounded processing coordinates and registration back to the original capture', async () => {
    const referenceFrame = makeTarget();
    const impact = { x: 110, y: 72 };
    const currentFrame = addDarkImpact(shiftImage(referenceFrame, 4, -2), impact.x + 4, impact.y - 2);
    const reference: AnalysisImage = { uri: 'file://baseline.jpg', widthPixels: 160, heightPixels: 120, captureId: 'baseline' };
    const current: AnalysisImage = { uri: 'file://current.jpg', widthPixels: 160, heightPixels: 120, captureId: 'current' };
    const frames = new Map<string, GrayFrame>([
      [reference.uri, referenceFrame],
      [current.uri, currentFrame],
    ]);
    const service = new LocalImageAnalysisService({
      maxProcessingDimension: 80,
      maxShiftPixels: 8,
      decoder: {
        async decode(image) {
          const frame = frames.get(image.uri);
          if (!frame) throw new Error('missing test frame');
          return { image, frame };
        },
      },
    });
    const request: ImageAnalysisRequest = {
      sessionId: 'session',
      targetId: 'target',
      baselineRevision: 1,
      targetType: 'paper',
      referenceMode: 'clean-baseline',
      cleanBaseline: reference,
      current,
      lockedRoi: { kind: 'rectangle', rect: { x: 0, y: 0, width: 160, height: 120 } },
      sensitivity: {
        preset: 'medium',
        minimumDifference: 8,
        minimumAreaPixels: 3,
        maximumAreaPixels: 1_000,
        deduplicationRadiusPixels: 3,
      },
    };

    const result = await service.analyze(request);
    const candidate = result.candidates.find((item) => Math.hypot(item.position.x - impact.x, item.position.y - impact.y) < 8);

    expect(candidate).toBeDefined();
    expect(result.registration.currentToReference.matrix[2]).toBeCloseTo(-4, 0);
    expect(result.registration.currentToReference.matrix[5]).toBeCloseTo(2, 0);
    expect(result.registration.currentToReference.confidence).toBeGreaterThan(0);
  });
});
