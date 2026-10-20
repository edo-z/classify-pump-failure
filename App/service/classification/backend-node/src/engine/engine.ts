/**
 * RulesEngine — 1:1 port of ``app/classification/engine.py``.
 *
 * Loads thresholds from rules.json and classifies sensor readings.
 * First-match wins; a stateful per-namespace count_trigger buffer is kept
 * in memory. Gap handling is the caller's job (evidence is trimmed before
 * the engine sees it; the engine assumes contiguous event-time readings).
 */

import { readFileSync } from "node:fs";

import { applyEffectiveRefs } from "./configuration-resolver.ts";
import type { EffectiveRefs } from "./configuration-resolver.ts";
import {
  evaluatePanel,
  evaluateTierRules,
  evaluateUnbalance,
  evaluateVoltage,
  type EngineHooks,
  type RuleDef,
} from "./evaluator.ts";
import {
  aggregateReadings,
  getCountTrigger,
  getTierKey,
  resolveOperatingSetpoint,
  checkFluctuation,
} from "./support.ts";
import type {
  ClassificationResult,
  MatchedRule,
  OperatingSetpoint,
  PumpConfig,
  RuleEvaluation,
  SensorReading,
} from "./models.ts";
import {
  TroubleType,
  UnsupportedPumpConfigurationError,
} from "./models.ts";
import { fixed, general, numRepr, reprFloat } from "../util/pyformat.ts";

export const RULES_FILE = new URL("./rules.json", import.meta.url);

interface RulesDoc {
  tiers?: Record<string, { rules?: Record<string, RuleDef> }>;
  capability_rules?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export class RulesEngine implements EngineHooks {
  private _rules_path: URL;
  private _rules: RulesDoc = {};
  private _trigger_counters = new Map<string, number>();

  constructor(rules_path: URL | string) {
    this._rules_path = rules_path instanceof URL ? rules_path : new URL(`file://${rules_path}`);
    this._loadRules();
  }

  private _loadRules(): void {
    try {
      this._rules = JSON.parse(readFileSync(this._rules_path, "utf-8")) as RulesDoc;
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`rules.json not found at ${this._rules_path}`);
      }
      throw new Error(`Corrupt rules.json: ${(exc as Error).message}`);
    }
    if (typeof this._rules !== "object" || this._rules === null || !("tiers" in this._rules)) {
      throw new Error(
        `Invalid rules.json schema: missing 'tiers' at ${this._rules_path}`,
      );
    }
  }

  reload(): void {
    this._loadRules();
    this._trigger_counters.clear();
  }

  clearTriggerCounters(): void {
    this._trigger_counters.clear();
  }

  getTriggerCounter(
    pump_id: number,
    trouble_name: string,
    namespace = "",
  ): number {
    const key = namespace
      ? `${namespace}:${pump_id}:${trouble_name}`
      : `${pump_id}:${trouble_name}`;
    return this._trigger_counters.get(key) ?? 0;
  }

  updateTriggerCounter(
    pump_id: number,
    trouble_name: string,
    matched: boolean,
    count_trigger: number,
    namespace = "",
  ): [boolean, number] {
    if (count_trigger <= 1) {
      return [matched, matched ? 1 : 0];
    }
    const key = namespace
      ? `${namespace}:${pump_id}:${trouble_name}`
      : `${pump_id}:${trouble_name}`;
    let cur = this._trigger_counters.get(key) ?? 0;
    if (!matched) {
      if (cur !== 0) this._trigger_counters.set(key, 0);
      return [false, 0];
    }
    cur += 1;
    if (cur >= count_trigger) {
      this._trigger_counters.set(key, count_trigger);
      return [true, cur];
    }
    this._trigger_counters.set(key, cur);
    return [false, cur];
  }

  checkFluctuation(
    readings: SensorReading[],
    field: string,
    threshold: number,
    center: number | null = null,
  ): boolean {
    return checkFluctuation(readings, field, threshold, center);
  }

  resolveOperatingSetpoint(
    setpoints: OperatingSetpoint,
    ref_field: string | undefined,
  ): number | null {
    return resolveOperatingSetpoint(setpoints, ref_field);
  }

  matchRule(
    readings: SensorReading[],
    agg: Record<string, number>,
    rule_def: RuleDef,
    setpoints: OperatingSetpoint,
  ): [boolean, string[], number, boolean] {
    const conditions = rule_def.conditions ?? [];
    const logic = rule_def.logic ?? "AND";
    const matched_conds: string[] = [];

    const config_refs = new Set([
      "setpoint_freq",
      "setpoint_rpm",
      "setpoint_torque",
    ]);
    const required_refs = new Set<string>();
    for (const cond of conditions) {
      if (cond.ref !== undefined && config_refs.has(cond.ref)) {
        required_refs.add(cond.ref);
      }
    }
    let missing_setpoint = false;
    for (const ref of required_refs) {
      const value = this.resolveOperatingSetpoint(setpoints, ref);
      if (value === null || value <= 0) {
        missing_setpoint = true;
        break;
      }
    }

    for (const cond of conditions) {
      const field = cond.field as string;
      const op = cond.op as string;
      const actual = agg[field];
      if (actual === undefined) continue;

      if (op === "reaching_setpoint") {
        const sp = this.resolveOperatingSetpoint(setpoints, cond.ref ?? "");
        if (sp !== null && sp > 0 && actual >= sp) {
          matched_conds.push(`${field}=${fixed(actual, 1)} reaches setpoint ${reprFloat(sp)}`);
        }
      } else if (op === "not_reaching_setpoint") {
        const sp = this.resolveOperatingSetpoint(setpoints, cond.ref ?? "");
        if (sp !== null && sp > 0 && actual < sp) {
          matched_conds.push(`${field}=${fixed(actual, 1)} < setpoint ${reprFloat(sp)}`);
        }
      } else if (op === "not_exceeding_setpoint") {
        const sp = this.resolveOperatingSetpoint(setpoints, cond.ref ?? "");
        if (sp !== null && sp > 0 && actual <= sp) {
          matched_conds.push(`${field}=${fixed(actual, 1)} <= setpoint ${reprFloat(sp)}`);
        }
      } else if (op === "near_setpoint") {
        const sp = this.resolveOperatingSetpoint(setpoints, cond.ref ?? "");
        const tol = Number(cond.tolerance_pct ?? 10) / 100;
        if (sp !== null && sp > 0 && Math.abs(actual - sp) <= sp * tol) {
          matched_conds.push(
            `${field}=${fixed(actual, 1)} near setpoint ${reprFloat(sp)} (+/-${fixed(tol * 100, 0)}%)`,
          );
        }
      } else if (op === "fluctuating") {
        const threshold = Number(cond.value);
        const center = cond.center === undefined || cond.center === null ? null : Number(cond.center);
        const is_fluct = this.checkFluctuation(readings, field, threshold, center);
        if (is_fluct) {
          if (center !== null) {
            matched_conds.push(
              `${field} fluctuates +/-${numRepr(threshold)} inside [${fixed(center - threshold, 0)},${fixed(center + threshold, 0)}]`,
            );
          } else {
            matched_conds.push(`${field} fluctuates +/-${numRepr(threshold)}`);
          }
        }
      } else if (op === ">") {
        const value = Number(cond.value);
        if (actual > value) matched_conds.push(`${field}=${fixed(actual, 1)} > ${numRepr(value)}`);
      } else if (op === ">=") {
        const value = Number(cond.value);
        if (actual >= value) matched_conds.push(`${field}=${fixed(actual, 1)} >= ${numRepr(value)}`);
      } else if (op === "<") {
        const value = Number(cond.value);
        if (actual < value) matched_conds.push(`${field}=${fixed(actual, 1)} < ${numRepr(value)}`);
      } else if (op === "==") {
        const value = Number(cond.value);
        if (Math.abs(actual - value) < 0.01) {
          matched_conds.push(`${field}=${fixed(actual, 1)} == ${numRepr(value)}`);
        }
      }
    }

    const total = conditions.length;
    const matched_count = matched_conds.length;
    let matched: boolean;
    if (logic === "AND") {
      if (total === 5) matched = matched_count >= 4;
      else if (total === 6) matched = matched_count >= 5;
      else matched = matched_count === total;
    } else {
      matched = matched_count > 0;
    }
    return [matched, matched_conds, total, missing_setpoint];
  }

  classify(
    readings: SensorReading[],
    pump_config: PumpConfig,
    operating_setpoint: OperatingSetpoint | null = null,
    trigger_namespace = "",
    rule_config: EffectiveRefs | null = null,
  ): ClassificationResult {
    if (readings.length === 0) {
      throw new Error("Classification requires at least one reading");
    }

    const last_reading = readings[readings.length - 1] as SensorReading;
    const setpoints: OperatingSetpoint = operating_setpoint ?? {};
    const agg = aggregateReadings(readings);
    const tier_key = getTierKey(this._rules, pump_config.capacity_lps);
    let tier_rules = this._rules.tiers?.[tier_key ?? ""] ?? {};

    if (rule_config !== null && Object.keys(tier_rules).length > 0) {
      tier_rules = applyEffectiveRefs(tier_rules, rule_config);
    }

    const rules_match: MatchedRule[] = [];
    const rule_evaluations: RuleEvaluation[] = [];
    const limitations: string[] = [];

    evaluateTierRules(
      this,
      readings,
      agg,
      tier_rules,
      pump_config,
      setpoints,
      trigger_namespace,
      rules_match,
      rule_evaluations,
      limitations,
    );

    const panel_rules = this._rules.tiers?.panel_overheat?.rules ?? {};
    evaluatePanel(readings, panel_rules, rules_match, rule_evaluations);

    const unbalance_rule = this._rules.capability_rules?.UNBALANCE ?? {};
    evaluateUnbalance(
      readings,
      unbalance_rule,
      rules_match,
      rule_evaluations,
      limitations,
    );

    const capability_rules = this._rules.capability_rules ?? {};
    evaluateVoltage(
      agg,
      capability_rules,
      rules_match,
      rule_evaluations,
      limitations,
    );

    const supported_evaluations = rule_evaluations.filter(
      (ev) => ev.capability_status !== "UNSUPPORTED",
    );
    const ready_count = supported_evaluations.filter(
      (ev) => ev.capability_status === "READY",
    ).length;
    const evaluation_status = ready_count === 0 ? "INSUFFICIENT_DATA" : "FULL";

    if (rules_match.length === 0 && tier_key === null) {
      throw new UnsupportedPumpConfigurationError(
        `Unsupported pump configuration for current PoC rules: ` +
          `pump_id=${pump_config.pump_id}, ` +
          `flowhead_id=${pump_config.flowhead_id ?? null}, ` +
          `capacity_lps=${pump_config.capacity_lps}`,
      );
    }

    if (rules_match.length === 0) {
      return {
        pump_id: pump_config.pump_id,
        timestamp: last_reading.timestamp,
        trouble_type: TroubleType.NORMAL,
        matched_rules: [],
        sensor_snapshot: agg,
        readings_count: readings.length,
        limitations,
        evaluation_status,
        rule_evaluations,
      };
    }

    const best = rules_match[0] as MatchedRule;
    return {
      pump_id: pump_config.pump_id,
      timestamp: last_reading.timestamp,
      trouble_type: best.trouble_type,
      matched_rules: rules_match,
      sensor_snapshot: agg,
      readings_count: readings.length,
      limitations,
      evaluation_status,
      rule_evaluations,
    };
  }
}

// Keep parity with the Python module surface (legacy underscore helpers).
export { getCountTrigger, resolveOperatingSetpoint };
export type { RuleDef };
export { general };
