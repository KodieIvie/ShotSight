import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeFrames, analyzeImageFiles } from '../pipeline';
import { addDarkImpact, applyExposure, makeTarget, shiftImage } from './helpers';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'shotsight-image-harness-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writePng(filePath: string, image: ReturnType<typeof makeTarget>): Promise<void> {
  const bytes = Buffer.from(
    Uint8Array.from(image.data, (value) => Math.round(Math.min(255, Math.max(0, value)))),
  );
  await sharp(bytes, {
    raw: { width: image.width, height: image.height, channels: 1 },
  })
    .png()
    .toFile(filePath);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('impact detection pipeline', () => {
  it('normalizes exposure, registers motion, and locates a new dark impact', () => {
    const reference = makeTarget();
    const registeredImpact = { x: 112, y: 73 };
    const offset = { x: 4, y: -2 };
    let current = shiftImage(reference, offset.x, offset.y);
    current = addDarkImpact(
      current,
      registeredImpact.x + offset.x,
      registeredImpact.y + offset.y,
      4,
    );
    current = applyExposure(current, 1.08, 7);

    const result = analyzeFrames(reference, current, {
      maxShift: 8,
      sensitivity: 'medium',
    });

    expect(result.registration.offsetX).toBe(offset.x);
    expect(result.registration.offsetY).toBe(offset.y);
    const candidate = result.candidates.find(
      (item) => Math.hypot(item.x - registeredImpact.x, item.y - registeredImpact.y) < 5,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.polarity).toBe('darkening');
    expect(candidate?.confidence).toBeGreaterThan(0.35);
  });

  it('accepts image paths and writes all optional debug artifacts', async () => {
    const directory = await createTemporaryDirectory();
    const baselinePath = path.join(directory, 'baseline.png');
    const currentPath = path.join(directory, 'shot1.png');
    const debugDirectory = path.join(directory, 'debug');
    const reference = makeTarget(128, 96);
    const current = addDarkImpact(reference, 94, 51, 4);
    await Promise.all([writePng(baselinePath, reference), writePng(currentPath, current)]);

    const result = await analyzeImageFiles(baselinePath, currentPath, {
      debugDirectory,
      maxDimension: 0,
    });

    expect(result.candidateCount).toBeGreaterThan(0);
    expect(result.candidates.some((item) => Math.hypot(item.x - 94, item.y - 51) < 5)).toBe(true);
    expect(result.debugImages).toBeDefined();
    await expect(readFile(result.debugImages!.registered)).resolves.not.toHaveLength(0);
    await expect(readFile(result.debugImages!.difference)).resolves.not.toHaveLength(0);
    await expect(readFile(result.debugImages!.mask)).resolves.not.toHaveLength(0);
  });
});

