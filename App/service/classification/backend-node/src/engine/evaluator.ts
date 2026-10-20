/**
 * Rule evaluators — 1:1 port of ``app/classification/evaluator.py``.
 * Equations unchanged; the only engine coupling is the two stateful
 * methods (``_matchRule``, ``_updateTriggerCounter``) passed as ``engine``.
 */

import { fixed, general, plusFixed, numRepr, reprFloat } from "../util/pyformat.ts";
import {
  computeTA,
  freqEq2dp,
  getCountTrigger,
  getTAParams,
  resolveOperatingSetpoint,
} from "./support.ts";
import type {
  MatchedRule,
  OperatingSetpoint,
  PumpConfig,
  RuleEvaluation,
  SensorReading,
} from "./models.ts";
import { RuleNameToTroubleType, TroubleType } from "./models.ts";

interface Condition {
  field?: string;
  op?: string;
  value?: unknown;
  ref?: string;
  window?: unknown;
  threshold?: unknown;
  center?: unknown;
  tolerance_pct?: unknown;
  note?: string;
  [key: string]: unknown;
}

export interface RuleDef {
  conditions?: Condition[];
  logic?: string;
  count_trigger?: unknown;
  freq_sustain?: unknown;
  [key: string]: unknown;
}

interface TierRules {
  rules?: Record<string, RuleDef>;
  [key: string]: unknown;
}

export interface EngineHooks {
  updateTriggerCounter(
    pump_id: number,
    trouble_name: string,
    matched: boolean,
    count_trigger: number,
    namespace: string,
  ): [boolean, number];
  checkFluctuation(
    readings: SensorReading[],
    field: string,
    threshold: number,
    center: number | null,
  ): boolean;
  matchRule(
    readings: SensorReading[],
    agg: Record<string, number>,
    rule_def: RuleDef,
    setpoints: OperatingSetpoint,
  ): [boolean, string[], number, boolean];
  resolveOperatingSetpoint(
    setpoints: OperatingSetpoint,
    ref_field: string | undefined,
  ): number | null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function getField(reading: SensorReading | undefined, field: string): number | null {
  if (!reading) return null;
  const v = (reading as unknown as Record<string, unknown>)[field];
  return v === null || v === undefined ? null : (v as number);
}

export function evaluateTierRules(
  engine: EngineHooks,
  readings: SensorReading[],
  agg: Record<string, number>,
  tier_rules: TierRules,
  pump_config: PumpConfig,
  operating_setpoint: OperatingSetpoint,
  trigger_namespace: string,
  rules_match: MatchedRule[],
  rule_evaluations: RuleEvaluation[],
  limitations: string[],
): void {
  const rules = tier_rules.rules ?? {};
  for (const [trouble_name, rule_def] of Object.entries(rules)) {
    const trouble_type = RuleNameToTroubleType[trouble_name];
    if (trouble_type === undefined) continue;

    let matched: boolean;
    let matched_conds: string[];
    let total: number;
    let _missing_setpoint: boolean;

    if (trouble_name === "POMPA_TERSANGKUT_SAMPAH") {
      const last = readings.length > 0 ? readings[readings.length - 1] : undefined;
      let kw_ref: number | null = null;
      let amp_ref: number | null = null;
      let ref_torque = 110.0;
      let ref_rpm = 100.0;
      let ref_freq = 10.0;
      for (const c of rule_def.conditions ?? []) {
        if (c.field === "output_power") {
          kw_ref = toNumber(c.value);
        } else if (c.field === "motor_current") {
          amp_ref = toNumber(c.value);
        } else {
          const override = toNumber(c.value);
          if (override === null) continue;
          if (c.field === "motor_torque") ref_torque = override;
          else if (c.field === "motor_speed") ref_rpm = override;
          else if (c.field === "output_frequency") ref_freq = override;
        }
      }
      if (kw_ref === null) kw_ref = 75;
      if (amp_ref === null) amp_ref = 157;
      const freq = getField(last, "output_frequency");
      const kw = getField(last, "output_power");
      const amp = getField(last, "motor_current");
      const torque = getField(last, "motor_torque");
      const rpm = getField(last, "motor_speed");
      const pts_f = freq !== null && freq <= ref_freq;
      const pts_kw = kw !== null && kw >= (kw_ref as number);
      const pts_a = amp !== null && amp >= (amp_ref as number);
      const pts_t = torque !== null && torque >= ref_torque;
      const pts_rpm = rpm !== null && rpm >= ref_rpm;
      const pts_count =
        (pts_kw ? 1 : 0) + (pts_a ? 1 : 0) + (pts_t ? 1 : 0) + (pts_rpm ? 1 : 0);
      matched = Boolean(pts_f && pts_count >= 3);
      matched_conds = [];
      if (pts_f) matched_conds.push(`freq=${fixed(freq as number, 1)} <=${general(ref_freq)}`);
      if (pts_kw) matched_conds.push(`power=${fixed(kw as number, 1)} >= ${numRepr(kw_ref as number)}`);
      if (pts_a) matched_conds.push(`current=${fixed(amp as number, 1)} >= ${numRepr(amp_ref as number)}`);
      if (pts_t) matched_conds.push(`torque=${fixed(torque as number, 1)} >= ${general(ref_torque)}%`);
      if (pts_rpm) matched_conds.push(`speed=${fixed(rpm as number, 1)} >= ${general(ref_rpm)}`);
      total = 5;
      _missing_setpoint = false;
    } else if (trouble_name === "LOW_WATER_MENYALA" || trouble_name === "DRY_RUN") {
      const pompa_rule = rules["POMPA_TERSANGKUT_SAMPAH"] ?? {};
      let kw_ref: number | null = null;
      let amp_ref: number | null = null;
      for (const c of pompa_rule.conditions ?? []) {
        if (c.field === "output_power") kw_ref = toNumber(c.value);
        else if (c.field === "motor_current") amp_ref = toNumber(c.value);
      }
      if (kw_ref === null) {
        const c = (rule_def.conditions ?? []).find((x) => x.field === "output_power");
        kw_ref = c ? toNumber(c.value) : 0;
      }
      if (amp_ref === null) {
        const c = (rule_def.conditions ?? []).find((x) => x.field === "motor_current");
        amp_ref = c ? toNumber(c.value) : 0;
      }
      let dr_kw = 0;
      let dr_amp = 0;
      try {
        dr_kw = kw_ref !== null ? Number(kw_ref) * 0.667 : 0;
        dr_amp = amp_ref !== null ? Number(amp_ref) * 0.64 : 0;
      } catch {
        dr_kw = 0;
        dr_amp = 0;
      }
      let dr_t = 70.0;
      for (const c of rule_def.conditions ?? []) {
        if (c.field === "motor_torque") {
          const t = toNumber(c.value);
          if (t !== null) dr_t = t;
          break;
        }
      }
      const last = readings.length > 0 ? readings[readings.length - 1] : undefined;
      const actual_freq = getField(last, "output_frequency");
      const sp_freq = resolveOperatingSetpoint(operating_setpoint, "setpoint_freq");
      const actual_kw = getField(last, "output_power");
      const actual_amp = getField(last, "motor_current");
      const actual_torque = getField(last, "motor_torque");
      const dr_f_raw = freqEq2dp(actual_freq, sp_freq);
      let freq_sustain = Math.trunc(Number(rule_def.freq_sustain ?? 1));
      if (!Number.isFinite(freq_sustain) || freq_sustain < 1) freq_sustain = 1;
      const [dr_f_armed, dr_f_cur] = engine.updateTriggerCounter(
        pump_config.pump_id,
        "DRY_RUN_DR_F",
        dr_f_raw,
        freq_sustain,
        trigger_namespace,
      );
      matched_conds = [];
      if (dr_f_raw) {
        matched_conds.push(
          `DR_F: output_frequency=${fixed(actual_freq as number, 2)} == setpoint ${fixed(sp_freq as number, 2)}`,
        );
      }
      if (actual_kw !== null && actual_kw <= dr_kw) {
        matched_conds.push(
          `DR_C: output_power=${fixed(actual_kw, 1)} <= DR_kW ${fixed(dr_kw, 1)} (0.667*${numRepr(kw_ref as number)})`,
        );
      }
      if (actual_amp !== null && actual_amp <= dr_amp) {
        matched_conds.push(
          `DR_C: motor_current=${fixed(actual_amp, 1)} <= DR_A ${fixed(dr_amp, 1)} (0.64*${numRepr(amp_ref as number)})`,
        );
      }
      if (actual_torque !== null && actual_torque < dr_t) {
        matched_conds.push(`DR_C: motor_torque=${fixed(actual_torque, 1)} < ${general(dr_t)}`);
      }
      total = 4;
      matched = Boolean(dr_f_armed && matched_conds.length === 4);
      _missing_setpoint = false;
      if (dr_f_raw && !dr_f_armed) {
        limitations.push(
          `DRY_RUN DR_F arming ${dr_f_cur}/${freq_sustain}: freq at setpoint, sustain ${dr_f_cur} < ${freq_sustain}`,
        );
      }
    } else if (trouble_name === "TURBULENSI") {
      const last = readings.length > 0 ? readings[readings.length - 1] : undefined;
      let kw_ref: number | null = null;
      let torque_ref = 90.0;
      for (const c of rule_def.conditions ?? []) {
        if (c.field === "output_power") kw_ref = toNumber(c.value);
        else if (c.field === "motor_torque") {
          const t = toNumber(c.value ?? 90.0);
          if (t !== null) torque_ref = t;
        }
      }
      if (kw_ref === null) kw_ref = 250.0;
      const [window, threshold] = getTAParams(rule_def);
      const freq = getField(last, "output_frequency");
      const kw = getField(last, "output_power");
      const torque = getField(last, "motor_torque");
      const sp_freq = resolveOperatingSetpoint(operating_setpoint, "setpoint_freq");
      const t_freq =
        freq !== null && sp_freq !== null && sp_freq > 0 && freq < sp_freq;
      const t_kw = kw !== null && kw >= (kw_ref as number);
      const t_t = torque !== null && torque >= torque_ref;
      const t_a_res = computeTA(readings, window, threshold);
      const t_a = Boolean(t_a_res.T_A);
      matched_conds = [];
      if (t_freq) matched_conds.push(`freq=${fixed(freq as number, 1)} < setpoint ${reprFloat(sp_freq as number)}`);
      if (t_kw) matched_conds.push(`power=${fixed(kw as number, 1)} >= ${general(kw_ref as number)}`);
      if (t_a) {
        const n_ref = t_a_res.window;
        const ref_label = t_a_res.ref_kind === "CMA" ? `CMA${n_ref}` : `MA${n_ref}`;
        matched_conds.push(
          `current=${fixed(t_a_res.A as number, 1)} vs ${ref_label}${fixed(t_a_res.MA_A as number, 1)} ` +
            `Δ${plusFixed(t_a_res.Delta_A as number, 1)} |Δ|${fixed(t_a_res.Abs_Delta_A as number, 1)}>=${general(t_a_res.threshold as number)}`,
        );
      }
      if (t_t) matched_conds.push(`torque=${fixed(torque as number, 1)} >= ${general(torque_ref)}%`);
      total = 4;
      matched = Boolean(t_freq && t_kw && t_a && t_t);
      _missing_setpoint = false;
      if (t_a_res.insufficient) {
        const aStr =
          t_a_res.A === null || t_a_res.A === undefined
            ? "None"
            : reprFloat(t_a_res.A);
        limitations.push(
          `TURBULENSI T_A insufficient_history: ${t_a_res.reason} ` +
            `(need ${t_a_res.need ?? window} prev, A=${aStr})`,
        );
      }
    } else {
      [matched, matched_conds, total, _missing_setpoint] = engine.matchRule(
        readings,
        agg,
        rule_def,
        operating_setpoint,
      );
    }

    rule_evaluations.push({
      trouble_type,
      capability_status: "READY",
      evaluation: matched ? "MATCH" : "NO_MATCH",
      missing_requirements: [],
      matched_conditions: matched_conds,
      total_conditions: total,
    });

    if (trouble_name === "POMPA_TERSANGKUT_SAMPAH") {
      if (matched) {
        rules_match.push({
          trouble_type,
          matched_conditions: matched_conds,
          total_conditions: total,
        });
      }
    } else {
      const count_trigger = getCountTrigger(rule_def);
      if (matched) {
        const [should_emit, cur] = engine.updateTriggerCounter(
          pump_config.pump_id,
          trouble_name,
          true,
          count_trigger,
          trigger_namespace,
        );
        if (should_emit) {
          rules_match.push({
            trouble_type,
            matched_conditions: matched_conds,
            total_conditions: total,
          });
        } else if (count_trigger > 1) {
          limitations.push(
            `${trouble_name} pending ${cur}/${count_trigger}: consecutive match ${cur} < trigger ${count_trigger}`,
          );
        }
      } else {
        engine.updateTriggerCounter(
          pump_config.pump_id,
          trouble_name,
          false,
          count_trigger,
          trigger_namespace,
        );
      }
    }
  }
}

export function evaluatePanel(
  readings: SensorReading[],
  panel_rules: Record<string, RuleDef>,
  rules_match: MatchedRule[],
  rule_evaluations: RuleEvaluation[],
): void {
  for (const [trouble_name, rule_def] of Object.entries(panel_rules)) {
    const trouble_type = RuleNameToTroubleType[trouble_name];
    if (trouble_type === undefined) continue;

    const last = readings.length > 0 ? readings[readings.length - 1] : undefined;
    let matched = false;
    const matched_conds: string[] = [];
    const total = (rule_def.conditions ?? []).length;
    if (last !== undefined) {
      for (const cond of rule_def.conditions ?? []) {
        const field = cond.field;
        const op = cond.op;
        const value = cond.value as number;
        const actual = field ? getField(last, field) : null;
        if (actual === null) continue;
        else if (op === ">" && actual > value) {
          matched = true;
          matched_conds.push(`${field}=${fixed(actual, 1)} > ${numRepr(value)}`);
        } else if (op === ">=" && actual >= value) {
          matched = true;
          matched_conds.push(`${field}=${fixed(actual, 1)} >= ${numRepr(value)}`);
        } else if (op === "<" && actual < value) {
          matched = true;
          matched_conds.push(`${field}=${fixed(actual, 1)} < ${numRepr(value)}`);
        }
      }
    }

    if (matched) {
      rule_evaluations.push({
        trouble_type,
        capability_status: "READY",
        evaluation: "MATCH",
        missing_requirements: [],
        matched_conditions: matched_conds,
        total_conditions: total,
      });
      rules_match.push({
        trouble_type,
        matched_conditions: matched_conds,
        total_conditions: total,
      });
    } else {
      rule_evaluations.push({
        trouble_type,
        capability_status: "READY",
        evaluation: "NO_MATCH",
        missing_requirements: [],
        matched_conditions: [],
        total_conditions: total,
      });
    }
  }
}

export function evaluateUnbalance(
  readings: SensorReading[],
  unbalance_rule: Record<string, unknown>,
  rules_match: MatchedRule[],
  rule_evaluations: RuleEvaluation[],
  limitations: string[],
): void {
  const unbalance_threshold = unbalance_rule.threshold_pct;
  const unbalance_operator = unbalance_rule.operator;

  if (
    typeof unbalance_threshold !== "number" ||
    unbalance_operator !== ">="
  ) {
    rule_evaluations.push({
      trouble_type: TroubleType.UNBALANCE,
      capability_status: "UNSUPPORTED",
      evaluation: null,
      missing_requirements: ["unbalance_rule_config"],
      matched_conditions: [],
      total_conditions: 0,
    });
    limitations.push(
      "UNBALANCE not evaluated: valid threshold/operator configuration unavailable",
    );
    return;
  }

  const last = readings.length > 0 ? readings[readings.length - 1] : undefined;
  if (last === undefined) {
    rule_evaluations.push({
      trouble_type: TroubleType.UNBALANCE,
      capability_status: "READY",
      evaluation: "NO_MATCH",
      missing_requirements: [],
      matched_conditions: [],
      total_conditions: 1,
    });
    return;
  }

  const u = last.arus_rms_u;
  const v = last.arus_rms_v;
  const w = last.arus_rms_w;
  if (u === null || v === null || w === null) {
    rule_evaluations.push({
      trouble_type: TroubleType.UNBALANCE,
      capability_status: "READY",
      evaluation: "NO_MATCH",
      missing_requirements: [],
      matched_conditions: [],
      total_conditions: 1,
    });
    return;
  }

  const ri = (u + v + w) / 3.0;
  const eu = u !== 0 ? ((ri - u) / u) * 100 : null;
  const ev = v !== 0 ? ((ri - v) / v) * 100 : null;
  const ew = w !== 0 ? ((ri - w) / w) * 100 : null;
  if (eu === null || ev === null || ew === null) {
    rule_evaluations.push({
      trouble_type: TroubleType.UNBALANCE,
      capability_status: "READY",
      evaluation: "NO_MATCH",
      missing_requirements: [],
      matched_conditions: [],
      total_conditions: 1,
    });
    return;
  }

  const limit = Number(unbalance_threshold);
  const eu_ok = Math.abs(eu) >= limit;
  const ev_ok = Math.abs(ev) >= limit;
  const ew_ok = Math.abs(ew) >= limit;
  const matched = eu_ok || ev_ok || ew_ok;
  const matched_conditions = matched
    ? [
        `unbalance OR: Eu ${fixed(eu, 2)}% ${eu_ok ? "TRUE" : "FALSE"}, ` +
          `Ev ${fixed(ev, 2)}% ${ev_ok ? "TRUE" : "FALSE"}, ` +
          `Ew ${fixed(ew, 2)}% ${ew_ok ? "TRUE" : "FALSE"} >= ${fixed(limit, 2)}% (Ri ${fixed(ri, 2)})`,
      ]
    : [];
  rule_evaluations.push({
    trouble_type: TroubleType.UNBALANCE,
    capability_status: "READY",
    evaluation: matched ? "MATCH" : "NO_MATCH",
    missing_requirements: [],
    matched_conditions,
    total_conditions: 1,
  });
  if (matched) {
    rules_match.push({
      trouble_type: TroubleType.UNBALANCE,
      matched_conditions,
      total_conditions: 1,
    });
  }
}

export function evaluateVoltage(
  agg: Record<string, number>,
  capability_rules: Record<string, Record<string, unknown>>,
  rules_match: MatchedRule[],
  rule_evaluations: RuleEvaluation[],
  limitations: string[],
): void {
  const voltage_capabilities: [string, TroubleType, string][] = [
    ["UNDERVOLTAGE", TroubleType.UNDERVOLTAGE, "<"],
    ["OVERVOLTAGE", TroubleType.OVERVOLTAGE, ">"],
  ];

  for (const [trouble_name, trouble_type, expected_operator] of voltage_capabilities) {
    const voltage_rule = capability_rules[trouble_name] ?? {};
    const field = (voltage_rule.field ?? voltage_rule.source_field) as
      | string
      | undefined;
    const operator = voltage_rule.operator as string | undefined;
    const threshold_v = voltage_rule.threshold_v;

    const valid_config =
      field === "input_voltage" &&
      operator === expected_operator &&
      typeof threshold_v === "number";

    if (!valid_config) {
      rule_evaluations.push({
        trouble_type,
        capability_status: "UNSUPPORTED",
        evaluation: null,
        missing_requirements: [`${trouble_name.toLowerCase()}_rule_config`],
        matched_conditions: [],
        total_conditions: 1,
      });
      limitations.push(
        `${trouble_name} not evaluated: valid voltage rule configuration unavailable`,
      );
      continue;
    }

    const input_voltage = agg.input_voltage;
    if (input_voltage === undefined || input_voltage === null) {
      rule_evaluations.push({
        trouble_type,
        capability_status: "READY",
        evaluation: "NO_MATCH",
        missing_requirements: [],
        matched_conditions: [],
        total_conditions: 1,
      });
      continue;
    }

    const threshold = Number(threshold_v);
    const matched =
      operator === "<" ? Number(input_voltage) < threshold : Number(input_voltage) > threshold;

    const matched_conditions = matched
      ? [`input_voltage ${fixed(Number(input_voltage), 2)} ${operator} ${fixed(threshold, 2)}`]
      : [];

    rule_evaluations.push({
      trouble_type,
      capability_status: "READY",
      evaluation: matched ? "MATCH" : "NO_MATCH",
      missing_requirements: [],
      matched_conditions,
      total_conditions: 1,
    });
    if (matched) {
      rules_match.push({
        trouble_type,
        matched_conditions,
        total_conditions: 1,
      });
    }
  }
}

export { resolveOperatingSetpoint };
