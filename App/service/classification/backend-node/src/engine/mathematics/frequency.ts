/**
 * Frequency comparison with 2-decimal ROUND_HALF_UP equality.
 * Used for Dry Run DR_F condition.
 */

import { Decimal } from "decimal.js";

/**
 * Compare actual frequency to setpoint with 2dp ROUND_HALF_UP rounding.
 * Returns true if both round to same 2dp value.
 * null/undefined or non-positive setpoint returns false.
 */
export function freqEq2dp(actual: number | null | undefined, setpoint: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  if (setpoint <= 0) return false;

  try {
    const a = new Decimal(String(actual)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const s = new Decimal(String(setpoint)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return a.equals(s);
  } catch {
    return false;
  }
}

/**
 * Compare actual to setpoint with exact equality (no rounding).
 * Used for non-DR_F frequency comparisons.
 */
export function freqEqExact(actual: number | null | undefined, setpoint: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  return actual === setpoint;
}

/**
 * Check if frequency is below setpoint (strict).
 * Used for Turbulensi T_Freq.
 */
export function freqBelowSetpoint(actual: number | null | undefined, setpoint: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  if (setpoint <= 0) return false;
  return actual < setpoint;
}

/**
 * Check if frequency is at or below setpoint.
 * Used for Banyak Sampah BS_F.
 */
export function freqAtOrBelowSetpoint(actual: number | null | undefined, setpoint: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  if (setpoint <= 0) return false;
  return actual <= setpoint;
}

/**
 * Check if frequency has reached setpoint (>=).
 * Used for reaching_setpoint operator.
 */
export function freqReachedSetpoint(actual: number | null | undefined, setpoint: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  if (setpoint <= 0) return false;
  return actual >= setpoint;
}

/**
 * Check if frequency has NOT reached setpoint (<).
 * Used for not_reaching_setpoint operator.
 */
export function freqNotReachedSetpoint(actual: number | null | undefined, setpoint: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  if (setpoint <= 0) return false;
  return actual < setpoint;
}

/**
 * Check if frequency is near setpoint within tolerance percentage.
 * Used for near_setpoint operator.
 */
export function freqNearSetpoint(
  actual: number | null | undefined,
  setpoint: number | null | undefined,
  tolerancePct: number = 10
): boolean {
  if (actual === null || actual === undefined) return false;
  if (setpoint === null || setpoint === undefined) return false;
  if (setpoint <= 0) return false;
  const tolerance = Math.abs(setpoint) * (tolerancePct / 100);
  return Math.abs(actual - setpoint) <= tolerance;
}