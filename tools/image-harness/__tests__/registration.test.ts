import { describe, expect, it } from 'vitest';

import { applyIntegerTranslation, registerSmallTranslation } from '../registration';
import { addDarkImpact, makeTarget, shiftImage } from './helpers';

describe('small-translation registration', () => {
  it('recovers camera motion despite a localized new impact', () => {
    const reference = makeTarget(128, 96);
    const moving = addDarkImpact(shiftImage(reference, 5, -3), 87, 49, 3);

    const registration = registerSmallTranslation(reference, moving, { maxShift: 8 });

    expect(registration.offsetX).toBe(5);
    expect(registration.offsetY).toBe(-3);
    expect(registration.overlapRatio).toBeGreaterThan(0.9);
    expect(registration.meanAbsoluteError).toBeLessThan(3);
  });

  it('returns a validity mask for pixels introduced at an image boundary', () => {
    const image = makeTarget(20, 12);
    const translated = applyIntegerTranslation(image, 2, -1);

    expect(translated.validMask.data[0]).toBe(0);
    expect(translated.validMask.data[1 * image.width + 0]).toBe(1);
    expect(
      translated.validMask.data.reduce((sum, value) => sum + value, 0),
    ).toBe((image.width - 2) * (image.height - 1));
  });

  it('uses a locked target ROI when unrelated motion exists outside it', () => {
    const reference = makeTarget(128, 96);
    const targetRoi = { x: 32, y: 24, width: 64, height: 48 };
    const moving = shiftImage(reference, 4, -3);

    // A large moving artifact outside the locked target would otherwise
    // dominate simple whole-frame alignment.
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        moving.data[y * moving.width + x] = 255;
      }
    }

    const registration = registerSmallTranslation(reference, moving, {
      maxShift: 8,
      roi: targetRoi,
    });

    expect(registration.offsetX).toBe(4);
    expect(registration.offsetY).toBe(-3);
  });
});
