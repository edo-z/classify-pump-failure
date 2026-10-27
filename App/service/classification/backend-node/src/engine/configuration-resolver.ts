/**
 * Configuration resolver — maps equipment identity to typed ClassificationConfig.
 *
 * Priority per field: override -> flowhead -> profile default.
 * Pure functions: no DB, no state. DB queries happen in middleware, not here.
 */

import type { ClassificationConfig, FlowheadConfig, VfdConfig, EquipmentIdentity } from "./models.ts";
import { validateClassificationConfig } from "./configuration.ts";

export interface EffectiveRefs {
  power_kw: number | null;
  current_a: number | null;
}

export function cleanPositive(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Return the first valid level (override -> flowhead -> profile). */
export function resolveLayeredValue(...levels: unknown[]): number | null {
  for (const level of levels) {
    const cleaned = cleanPositive(level);
    if (cleaned !== null) return cleaned;
  }
  return null;
}

export function resolveEffectiveRefs(
  profile_power_kw: unknown,
  profile_current_a: unknown,
  flowhead_power_kw: unknown = null,
  flowhead_current_a: unknown = null,
  override_power_kw: unknown = null,
  override_current_a: unknown = null,
): EffectiveRefs {
  return {
    power_kw: resolveLayeredValue(
      override_power_kw,
      flowhead_power_kw,
      profile_power_kw,
    ),
    current_a: resolveLayeredValue(
      override_current_a,
      flowhead_current_a,
      profile_current_a,
    ),
  };
}

const REF_FIELDS: Record<string, keyof EffectiveRefs> = {
  output_power: "power_kw",
  motor_current: "current_a",
};

/**
 * Apply effective refs to a COPY of the tier rules (never mutates the input).
 * Thresholds, operators and logic are untouched; a ``null`` ref leaves the condition value as-is.
 */
export function applyEffectiveRefs(
  tier_rules: { rules?: Record<string, { conditions?: Array<{ field?: string; value?: unknown }> }> },
  refs: EffectiveRefs,
): { rules?: Record<string, { conditions?: Array<{ field?: string; value?: unknown }> }> } {
  const effective = structuredClone(tier_rules);
  const overrides: Record<string, number | null> = {
    output_power: refs.power_kw,
    motor_current: refs.current_a,
  };
  const rules = effective.rules ?? {};
  for (const rule_def of Object.values(rules)) {
    const conditions = rule_def.conditions ?? [];
    for (const cond of conditions) {
      const replacement = overrides[cond.field ?? ""];
      if (replacement !== undefined && replacement !== null) {
        cond.value = replacement;
      }
    }
  }
  return effective;
}

/**
 * Resolve operating setpoint value by reference field name.
 * Maps ref_field to OperatingSetpoint keys.
 */
export function resolveOperatingSetpoint(
  setpoints: { frequency?: number | null; rpm?: number | null; torque?: number | null },
  ref_field: string | undefined,
): number | null {
  const field_map: Record<string, keyof typeof setpoints> = {
    setpoint_freq: "frequency",
    setpoint_rpm: "rpm",
    setpoint_torque: "torque",
  };
  const field = field_map[ref_field ?? ""];
  if (field === undefined) return null;
  const value = setpoints[field];
  return value === undefined ? null : value;
}

/** Re-export validation for external use. */
export { validateClassificationConfig } from "./configuration.ts";

/** Default ConfigurationProvider instance for testing and frozen cases. */
export { getDefaultConfigurationProvider, resetDefaultConfigurationProvider } from "./configuration-provider.ts";