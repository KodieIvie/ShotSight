import { describe, expect, it } from 'vitest';

import {
  calculateScopeClickAdjustment,
  createCustomScopeClickValue,
  SCOPE_CLICK_PRESETS,
} from '../index';

describe('scope click adjustment', () => {
  it('converts signed MOA corrections into nearest 1/4-MOA clicks', () => {
    const result = calculateScopeClickAdjustment({
      horizontalMoa: -1.24,
      verticalMoa: 0.62,
      horizontalMil: -0.36,
      verticalMil: 0.18,
    }, SCOPE_CLICK_PRESETS['quarter-moa']);

    expect(result.click).toEqual(SCOPE_CLICK_PRESETS['quarter-moa']);
    expect(result.horizontal.exactClicks).toBeCloseTo(-4.96, 12);
    expect(result.horizontal.recommendedClicks).toBe(-5);
    expect(result.horizontal.residual).toBeCloseTo(0.01, 12);
    expect(result.vertical.exactClicks).toBeCloseTo(2.48, 12);
    expect(result.vertical.recommendedClicks).toBe(2);
    expect(result.vertical.residual).toBeCloseTo(0.12, 12);
  });

  it('uses MIL values for a 0.1-MIL turret', () => {
    const result = calculateScopeClickAdjustment({
      horizontalMoa: 0.5,
      verticalMoa: -0.5,
      horizontalMil: 0.27,
      verticalMil: -0.34,
    }, SCOPE_CLICK_PRESETS['tenth-mil']);

    expect(result.horizontal.recommendedClicks).toBe(3);
    expect(result.horizontal.residual).toBeCloseTo(-0.03, 12);
    expect(result.vertical.recommendedClicks).toBe(-3);
    expect(result.vertical.residual).toBeCloseTo(-0.04, 12);
  });

  it('supports validated custom click values and nearest-click rounding', () => {
    const custom = createCustomScopeClickValue(0.2, 'moa');
    const result = calculateScopeClickAdjustment({
      horizontalMoa: 0.1,
      verticalMoa: -0.09,
      horizontalMil: 0.03,
      verticalMil: -0.02,
    }, custom);

    expect(custom).toEqual({
      id: 'custom',
      label: '0.2 MOA',
      unit: 'moa',
      amount: 0.2,
    });
    // At an exact half click, Math.round selects the positive whole click.
    expect(result.horizontal.recommendedClicks).toBe(1);
    expect(result.vertical.recommendedClicks).toBe(0);
    expect(Object.is(result.vertical.recommendedClicks, -0)).toBe(false);
  });

  it('rejects invalid custom increments and non-finite corrections', () => {
    expect(() => createCustomScopeClickValue(0, 'moa')).toThrow('positive finite');
    expect(() => createCustomScopeClickValue(Number.NaN, 'mil')).toThrow('positive finite');
    expect(() => calculateScopeClickAdjustment({
      horizontalMoa: Number.POSITIVE_INFINITY,
      verticalMoa: 0,
      horizontalMil: 0,
      verticalMil: 0,
    }, SCOPE_CLICK_PRESETS['quarter-moa'])).toThrow('finite');
  });
});
