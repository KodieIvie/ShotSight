import type { AngularOffset } from './measurement';

/** The angular unit expressed by one scope-turret click. */
export type ScopeClickUnit = 'moa' | 'mil';

export type ScopeClickPresetId =
  | 'quarter-moa'
  | 'eighth-moa'
  | 'tenth-mil'
  | 'custom';

/**
 * A turret's adjustment increment. `amount` is the angular amount moved by
 * one click, not the total desired correction.
 */
export interface ScopeClickValue {
  readonly id: ScopeClickPresetId;
  readonly label: string;
  readonly unit: ScopeClickUnit;
  readonly amount: number;
}

export const SCOPE_CLICK_PRESETS: Readonly<Record<Exclude<ScopeClickPresetId, 'custom'>, ScopeClickValue>> =
  Object.freeze({
    'quarter-moa': Object.freeze({
      id: 'quarter-moa',
      label: '1/4 MOA',
      unit: 'moa',
      amount: 0.25,
    }),
    'eighth-moa': Object.freeze({
      id: 'eighth-moa',
      label: '1/8 MOA',
      unit: 'moa',
      amount: 0.125,
    }),
    'tenth-mil': Object.freeze({
      id: 'tenth-mil',
      label: '0.1 MIL',
      unit: 'mil',
      amount: 0.1,
    }),
  });

export interface ScopeClickAxisAdjustment {
  /** The desired correction in the selected click unit. Positive is right/up. */
  readonly correction: number;
  /** Unrounded signed number of clicks. */
  readonly exactClicks: number;
  /** Nearest signed whole-click recommendation. Positive is right/up. */
  readonly recommendedClicks: number;
  /** Correction remaining after the whole-click recommendation. */
  readonly residual: number;
}

export interface ScopeClickAdjustment {
  readonly click: ScopeClickValue;
  readonly horizontal: ScopeClickAxisAdjustment;
  readonly vertical: ScopeClickAxisAdjustment;
}

type AngularCorrection = Pick<
  AngularOffset,
  'horizontalMoa' | 'verticalMoa' | 'horizontalMil' | 'verticalMil'
>;

/**
 * Creates and validates a user-defined turret increment. This deliberately
 * does not persist a scope profile yet; callers can safely use it for an
 * immediate zeroing calculation.
 */
export function createCustomScopeClickValue(
  amount: number,
  unit: ScopeClickUnit,
): ScopeClickValue {
  assertClickAmount(amount);
  return Object.freeze({
    id: 'custom',
    label: `${trimmedNumber(amount)} ${unit.toUpperCase()}`,
    unit,
    amount,
  });
}

/**
 * Calculates nearest-whole-click turret instructions from a signed POI
 * correction. It assumes the turret markings describe the direction the POI
 * moves: positive horizontal is right and positive vertical is up.
 */
export function calculateScopeClickAdjustment(
  correction: AngularCorrection,
  click: ScopeClickValue,
): ScopeClickAdjustment {
  assertClickValue(click);
  const horizontal = click.unit === 'moa'
    ? correction.horizontalMoa
    : correction.horizontalMil;
  const vertical = click.unit === 'moa'
    ? correction.verticalMoa
    : correction.verticalMil;

  return Object.freeze({
    click: Object.freeze({ ...click }),
    horizontal: calculateAxisAdjustment(horizontal, click.amount),
    vertical: calculateAxisAdjustment(vertical, click.amount),
  });
}

function calculateAxisAdjustment(
  correction: number,
  clickAmount: number,
): ScopeClickAxisAdjustment {
  if (!Number.isFinite(correction)) {
    throw new RangeError('Angular correction values must be finite');
  }
  const exactClicks = correction / clickAmount;
  const rounded = Math.round(exactClicks);
  // Math.round can produce -0, which is not useful in a user-facing result.
  const recommendedClicks = rounded === 0 ? 0 : rounded;
  return Object.freeze({
    correction,
    exactClicks,
    recommendedClicks,
    residual: correction - recommendedClicks * clickAmount,
  });
}

function assertClickValue(click: ScopeClickValue): void {
  if (!click || !click.label.trim()) {
    throw new RangeError('A scope click label is required');
  }
  if (click.id !== 'quarter-moa' && click.id !== 'eighth-moa' && click.id !== 'tenth-mil' && click.id !== 'custom') {
    throw new RangeError('Unknown scope click preset');
  }
  if (click.unit !== 'moa' && click.unit !== 'mil') {
    throw new RangeError('Scope click unit must be MOA or MIL');
  }
  assertClickAmount(click.amount);
}

function assertClickAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RangeError('Scope click amount must be a positive finite number');
  }
}

function trimmedNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}
