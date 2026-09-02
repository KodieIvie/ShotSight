import { describe, expect, it } from 'vitest';

import { connectedComponents, robustThreshold } from '../segmentation';
import type { BinaryImage, GrayImage } from '../types';

describe('robust segmentation', () => {
  it('uses MAD to reject broad low-amplitude noise while retaining a change', () => {
    const width = 40;
    const height = 30;
    const data = Float32Array.from({ length: width * height }, (_, index) => index % 5);
    for (let y = 12; y <= 15; y += 1) {
      for (let x = 19; x <= 23; x += 1) {
        data[y * width + x] = 45;
      }
    }
    const result = robustThreshold({ width, height, data }, undefined, {
      minimumThreshold: 10,
      zScore: 6,
    });

    expect(result.threshold).toBeGreaterThanOrEqual(10);
    expect(result.mask.data[13 * width + 21]).toBe(1);
    expect(result.mask.data[2 * width + 2]).toBe(0);
  });

  it('extracts weighted centroids and change polarity', () => {
    const width = 12;
    const height = 10;
    const maskData = new Uint8Array(width * height);
    const differenceData = new Float32Array(width * height);
    const signedData = new Float32Array(width * height);
    for (let y = 3; y <= 5; y += 1) {
      for (let x = 6; x <= 8; x += 1) {
        const index = y * width + x;
        maskData[index] = 1;
        differenceData[index] = x === 8 ? 50 : 25;
        signedData[index] = -differenceData[index];
      }
    }
    const mask: BinaryImage = { width, height, data: maskData };
    const difference: GrayImage = { width, height, data: differenceData };
    const signed: GrayImage = { width, height, data: signedData };

    const components = connectedComponents(mask, difference, signed);

    expect(components).toHaveLength(1);
    expect(components[0].area).toBe(9);
    expect(components[0].weightedCentroid.x).toBeGreaterThan(7);
    expect(components[0].polarity).toBe('darkening');
  });
});

