/**
 * Stateless helpers — 1:1 port of ``app/classification/engine_support.py``.
 * Pure functions only; the RulesEngine delegates here. Equations unchanged.
 */

import { Decimal } from "decimal.js";

import type { OperatingSetpoint, SensorReading } from "./models.ts";

export interface TAResult {
  A?: number | null;
  MA_A?: number;
  Delta_A?: number;
  Abs_Delta_A?: number;
  threshold?: number;
  window?: number;
  ref_kind?: string;
  collected?: number;
  T_A: boolean;
  insufficient: boolean;
  reason?: string;
  need?: number;
}

interface Condition {
  field?: string;
  op?: string;
  value?: unknown;
  ref?: string;
  window?: unknown;
  threshold?: unknown;
  center?: unknown;
  tolerance_pct?: unknown;
  [key: string]: unknown;
}

interface RuleDef {
  conditions?: Condition[];
  count_trigger?: unknown;
  [key: string]: unknown;
}

export function getCountTrigger(rule_def: RuleDef): number {
  try {
    const v = rule_def.count_trigger ?? 1;
    const iv = Math.trunc(Number(v));
    return Number.isFinite(iv) && iv >= 1 ? iv : 1;
  } catch {
    return 1;
  }
}

/**
 * DR_F: raw 2-decimal equality, no normalisation.
 * ``Decimal(str(x))`` + ROUND_HALF_UP so it is deterministic and avoids
 * binary float banker's rounding. None / sp<=0 -> false.
 */
export function freqEq2dp(actual: number | null | undefined, sp: number | null | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (sp === null || sp === undefined) return false;
  try {
    if (Number(sp) <= 0) return false;
    const a = new Decimal(String(actual)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const s = new Decimal(String(sp)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return a.equals(s);
  } catch {
    return false;
  }
}

/** (window, threshold) for T_A, default (30, 10.0). */
export function getTAParams(rule_def: RuleDef): [number, number] {
  let window = 30;
  let threshold = 10.0;
  for (const c of rule_def.conditions ?? []) {
    if (c.field === "motor_current" && c.op === "deviation_from_ma") {
      const w = Math.trunc(Number(c.window ?? 30));
      if (Number.isFinite(w) && w >= 1) window = w;
      const t = Number(c.threshold ?? 10.0);
      if (Number.isFinite(t) && t > 0) threshold = t;
      break;
    }
  }
  return [window, threshold];
}

/**
 * Adaptive current reference T_A: |A_i - A_ref| >= threshold.
 * A_ref = CMA_n when 1 <= n < window, else the full trailing MA of
 * ``window`` samples (current excluded). n = 0 / A_i None -> insufficient.
 */
export function computeTA(
  readings: SensorReading[],
  window = 30,
  threshold = 10.0,
): TAResult {
  if (readings.length === 0) {
    return { T_A: false, insufficient: true, reason: "no_readings" };
  }
  const current_reading = readings[readings.length - 1] as SensorReading;
  const current = current_reading.motor_current;
  if (current === null || current === undefined) {
    return { A: null, T_A: false, insufficient: true, reason: "current_none" };
  }
  const prev_values: number[] = [];
  for (let i = readings.length - 2; i >= 0; i--) {
    const v = (readings[i] as SensorReading).motor_current;
    if (v !== null && v !== undefined) {
      prev_values.push(Number(v));
      if (prev_values.length >= window) break;
    }
  }
  if (prev_values.length < 1) {
    return {
      A: Number(current),
      collected: 0,
      need: window,
      T_A: false,
      insufficient: true,
      reason: `need_${window}_got_0`,
    };
  }
  const n = Math.min(prev_values.length, window);
  const ref_kind = prev_values.length >= window ? "MA30" : "CMA";
  let sum = 0;
  for (let i = 0; i < n; i++) sum += prev_values[i] as number;
  const ma = sum / n;
  const delta = Number(current) - ma;
  const t_a = Math.abs(delta) >= threshold;
  return {
    A: Number(current),
    MA_A: ma,
    Delta_A: delta,
    Abs_Delta_A: Math.abs(delta),
    threshold,
    window: n,
    ref_kind,
    collected: prev_values.length,
    T_A: Boolean(t_a),
    insufficient: false,
  };
}

export function getMissingRequirements(
  readings: SensorReading[],
  agg: Record<string, unknown>,
  rule_def: RuleDef,
  operating_setpoint: OperatingSetpoint,
): string[] {
  const missing: string[] = [];
  const setpoint_ops = new Set([
    "reaching_setpoint",
    "not_reaching_setpoint",
    "not_exceeding_setpoint",
    "near_setpoint",
  ]);
  for (const condition of rule_def.conditions ?? []) {
    const field = condition.field;
    const op = condition.op;
    if (field && agg[field] === undefined) {
      missing.push(field);
    }
    if (op === "fluctuating") {
      const key = field as string;
      const values = readings
        .filter((r) => (r as unknown as Record<string, unknown>)[key] !== undefined)
        .map((r) => (r as unknown as Record<string, unknown>)[key] as number);
      if (values.length < 4) missing.push(`${field}:minimum_4_samples`);
    }
    if (op !== undefined && setpoint_ops.has(op)) {
      const ref_field = condition.ref;
      const setpoint = resolveOperatingSetpoint(operating_setpoint, ref_field);
      if (setpoint === null || setpoint === undefined || setpoint <= 0) {
        missing.push(ref_field ?? "operating_setpoint");
      }
    }
  }
  return [...new Set(missing)];
}

export function getMissingOrRequirements(
  agg: Record<string, unknown>,
  rule_def: RuleDef,
): string[] {
  const missing: string[] = [];
  for (const condition of rule_def.conditions ?? []) {
    const field = condition.field;
    if (field && agg[field] === undefined) missing.push(field);
  }
  return [...new Set(missing)];
}

export function getTierKey(
  rules: { tiers?: Record<string, { rules?: Record<string, unknown> }> },
  capacity_lps: number,
): string | null {
  const tier_key = String(capacity_lps);
  const tier = rules.tiers?.[tier_key] ?? {};
  if (tier.rules && Object.keys(tier.rules).length > 0) {
    return tier_key;
  }
  return null;
}

const NUMERIC_FIELDS: (keyof SensorReading)[] = [
  "output_frequency",
  "output_power",
  "motor_current",
  "motor_torque",
  "motor_speed",
  "ambient_temperature",
  "control_board_temperature",
  "inverter_temperature",
  "motor_estimated_temperature",
  "input_voltage",
  "flux_actual",
];

export function aggregateReadings(
  readings: SensorReading[],
): Record<string, number> {
  if (readings.length === 0) return {};
  const last = readings[readings.length - 1] as SensorReading;
  const agg: Record<string, number> = {};
  for (const field of NUMERIC_FIELDS) {
    const value = last[field];
    if (value !== null && value !== undefined) {
      agg[field] = value as number;
    }
  }
  return agg;
}

export function resolveOperatingSetpoint(
  setpoints: OperatingSetpoint,
  ref_field: string | undefined,
): number | null {
  const field_map: Record<string, keyof OperatingSetpoint> = {
    setpoint_freq: "frequency",
    setpoint_rpm: "rpm",
    setpoint_torque: "torque",
  };
  const field = field_map[ref_field ?? ""];
  if (field === undefined) return null;
  const value = setpoints[field];
  return value === undefined ? null : value;
}

/**
 * Fluctuating check (currently unreachable from the shipped rules.json,
 * ported for behavioral completeness). Returns true when the series shows
 * >= 3 significant moves with >= 2 reversals; optional band centre.
 */
export function checkFluctuation(
  readings: SensorReading[],
  field: string,
  threshold: number,
  center: number | null = null,
): boolean {
  const values: number[] = [];
  for (const reading of readings) {
    const value = (reading as unknown as Record<string, unknown>)[field];
    if (value !== null && value !== undefined) values.push(value as number);
  }
  if (values.length < 4) return false;
  if (center !== null) {
    const c = Number(center);
    const t = Number(threshold);
    if (!values.every((v) => c - t <= v && v <= c + t)) return false;
  }
  const directions: number[] = [];
  for (let i = 0; i + 1 < values.length; i++) {
    const delta = (values[i + 1] as number) - (values[i] as number);
    if (delta >= threshold) directions.push(1);
    else if (delta <= -threshold) directions.push(-1);
  }
  if (directions.length < 3) return false;
  let reversals = 0;
  for (let i = 0; i + 1 < directions.length; i++) {
    if (directions[i] !== directions[i + 1]) reversals++;
  }
  return reversals >= 2;
}
