/**
 * configuration-resolver — 1:1 port of
 * ``app/classification/configuration_resolver.py``.
 *
 * Reference & Setpoint are user-changeable configuration; the equations and
 * classification logic stay with the engine. This module is pure: no DB,
 * no state. Priority per column: override -> flowhead -> profile default.
 */

export interface EffectiveRefs {
  power_kw: number | null;
  current_a: number | null;
}

export function cleanPositive(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

/** Return the first valid level (override -> ... -> default). */
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

const _REF_FIELDS: Record<string, keyof EffectiveRefs> = {
  output_power: "power_kw",
  motor_current: "current_a",
};

interface Condition {
  field?: string;
  value?: unknown;
  [key: string]: unknown;
}

interface RuleDef {
  conditions?: Condition[];
  [key: string]: unknown;
}

interface TierRules {
  rules?: Record<string, RuleDef>;
  [key: string]: unknown;
}

/**
 * Apply effective refs to a COPY of the tier rules (never mutates the
 * input). Thresholds, operators and logic are untouched; a ``null`` ref
 * leaves the corresponding condition value as-is.
 */
export function applyEffectiveRefs(
  tier_rules: TierRules,
  refs: EffectiveRefs,
): TierRules {
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

export { _REF_FIELDS };
