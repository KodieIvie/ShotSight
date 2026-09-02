import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../cli';

describe('image harness CLI', () => {
  it('accepts positional paths and tuning options', () => {
    const parsed = parseCliArgs([
      'baseline.jpg',
      'shot1.jpg',
      '--sensitivity',
      'high',
      '--roi',
      '10,20,300,250',
      '--max-shift',
      '12',
    ]);

    expect(parsed).not.toBe('help');
    if (parsed !== 'help') {
      expect(parsed.baselinePath).toBe('baseline.jpg');
      expect(parsed.currentPath).toBe('shot1.jpg');
      expect(parsed.sensitivity).toBe('high');
      expect(parsed.roi).toEqual({ x: 10, y: 20, width: 300, height: 250 });
      expect(parsed.maxShift).toBe(12);
    }
  });

  it('rejects unknown sensitivity levels', () => {
    expect(() =>
      parseCliArgs(['baseline.jpg', 'shot1.jpg', '--sensitivity', 'extreme']),
    ).toThrow(/low, medium, or high/);
  });
});

