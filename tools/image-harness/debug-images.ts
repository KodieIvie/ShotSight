import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { BinaryImage, GrayImage } from './types';

export interface DebugImageSet {
  readonly registered: string;
  readonly difference: string;
  readonly mask: string;
}

function clampByte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

function grayBuffer(image: GrayImage, scale = 1): Buffer {
  const output = Buffer.allocUnsafe(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    output[index] = clampByte(image.data[index] * scale);
  }
  return output;
}

function maskBuffer(mask: BinaryImage): Buffer {
  const output = Buffer.allocUnsafe(mask.data.length);
  for (let index = 0; index < mask.data.length; index += 1) {
    output[index] = mask.data[index] === 0 ? 0 : 255;
  }
  return output;
}

function robustDisplayScale(image: GrayImage): number {
  const histogram = new Uint32Array(256);
  for (const value of image.data) {
    histogram[clampByte(value)] += 1;
  }
  const rank = Math.floor(image.data.length * 0.995);
  let cumulative = 0;
  let percentile = 1;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= rank) {
      percentile = Math.max(1, value);
      break;
    }
  }
  return 255 / percentile;
}

export async function writeDebugImages(
  outputDirectory: string,
  registered: GrayImage,
  difference: GrayImage,
  mask: BinaryImage,
): Promise<DebugImageSet> {
  await mkdir(outputDirectory, { recursive: true });
  const paths: DebugImageSet = {
    registered: path.resolve(outputDirectory, 'registered.png'),
    difference: path.resolve(outputDirectory, 'difference.png'),
    mask: path.resolve(outputDirectory, 'mask.png'),
  };

  await Promise.all([
    sharp(grayBuffer(registered), {
      raw: { width: registered.width, height: registered.height, channels: 1 },
    })
      .png()
      .toFile(paths.registered),
    sharp(grayBuffer(difference, robustDisplayScale(difference)), {
      raw: { width: difference.width, height: difference.height, channels: 1 },
    })
      .png()
      .toFile(paths.difference),
    sharp(maskBuffer(mask), {
      raw: { width: mask.width, height: mask.height, channels: 1 },
    })
      .png()
      .toFile(paths.mask),
  ]);

  return paths;
}

