/**
 * Engine behaviour — ports of the Python engine test suite
 * (tiers, turbulensi, dryrun, voltage, PTS RPM, threshold-from-ruledef,
 * effective refs, cross-pump isolation, trigger counters).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { RulesEngine, RULES_FILE } from "../../src/engine/engine.ts";
import type { EffectiveRefs } from "../../src/engine/configuration-resolver.ts";
import { getProfileCapacity } from "../../src/engine/profiles.ts";
import { freqEq2dp, getTAParams } from "../../src/engine/support.ts";
import { resolveEffectiveSetpoint } from "../../src/engine/setpoints.ts";
import { TroubleType, type ClassificationResult } from "../../src/engine/models.ts";
import { BASE_TS_MS, reading } from "./helpers.ts";

function newEngine(): RulesEngine {
  return new RulesEngine(RULES_FILE);
}
const PUMP_5000 = { pump_id: 5000, capacity_lps: 5000 };
const SP_40 = { frequency: 40.0, rpm: 990, torque: 90 };

function steady(base: number, n: number, current = 850.0, freq = 35.0, power = 405.0, torque = 95.0) {
  return Array.from({ length: n }, (_v, i) =>
    reading(base + i * 1000, {
      motor_current: current,
      output_frequency: freq,
      output_power: power,
      motor_torque: torque,
    }),
  );
}

function evalOf(result: ClassificationResult, trouble: string): string | null {
  return result.rule_evaluations.find((ev) => ev.trouble_type === trouble)?.evaluation ?? null;
}

// ------------------------------------------------------------------ dry run
test("freq_eq_2dp boundaries (ROUND_HALF_UP)", () => {
  assert.equal(freqEq2dp(40.004, 40.0), true);
  assert.equal(freqEq2dp(40.005, 40.0), false);
  assert.equal(freqEq2dp(null, 40.0), false);
  assert.equal(freqEq2dp(40.0, 0), false);
  assert.equal(freqEq2dp(40.0, null), false);
});

test("dry run full match / freq off kills match", () => {
  const eng = newEngine();
  const r = reading(BASE_TS_MS, {
    output_frequency: 40.0,
    output_power: 111.0,
    motor_current: 246.0,
    motor_torque: 40.0,
  });
  assert.equal(eng.classify([r], PUMP_5000, SP_40, "test:dry-ok").trouble_type, TroubleType.DRY_RUN);
  const off = { ...r, output_frequency: 40.01 } as typeof r;
  assert.notEqual(
    eng.classify([off], PUMP_5000, SP_40, "test:dry-freq").trouble_type,
    TroubleType.DRY_RUN,
  );
});

// ------------------------------------------------------------------ voltage
function classifyVoltage(eng: RulesEngine, volts: number | null) {
  const r = reading(BASE_TS_MS, {
    input_voltage: volts,
    motor_current: 100.0,
    output_frequency: 40.0,
    output_power: 300.0,
    motor_torque: 80.0,
  });
  return eng.classify([r], PUMP_5000, SP_40, "test:voltage");
}

test("voltage boundaries are exclusive", () => {
  const eng = newEngine();
  assert.equal(classifyVoltage(eng, 355).trouble_type, TroubleType.UNDERVOLTAGE);
  assert.equal(classifyVoltage(eng, 359.99).trouble_type, TroubleType.UNDERVOLTAGE);
  assert.notEqual(classifyVoltage(eng, 360).trouble_type, TroubleType.UNDERVOLTAGE);
  assert.equal(classifyVoltage(eng, 420).trouble_type, TroubleType.OVERVOLTAGE);
  assert.equal(classifyVoltage(eng, 410.01).trouble_type, TroubleType.OVERVOLTAGE);
  assert.notEqual(classifyVoltage(eng, 410).trouble_type, TroubleType.OVERVOLTAGE);
  const none = classifyVoltage(eng, null);
  assert.notEqual(none.trouble_type, TroubleType.UNDERVOLTAGE);
  assert.notEqual(none.trouble_type, TroubleType.OVERVOLTAGE);
});

// --------------------------------------------------------------- turbulensi
test("turbulensi MA30 with 31 contiguous readings", () => {
  const eng = newEngine();
  const readings = steady(BASE_TS_MS, 30);
  readings.push(reading(BASE_TS_MS + 30000, { motor_current: 865.0, output_frequency: 35.0, output_power: 405.0, motor_torque: 95.0 }));
  assert.equal(eng.classify(readings, PUMP_5000, SP_40, "test:turb-ok").trouble_type, TroubleType.TURBULENSI);
});

test("turbulensi CMA29 / CMA5 / CMA1 match, CMA boundary", () => {
  const eng = newEngine();
  for (const n of [29, 5, 1]) {
    const readings = steady(BASE_TS_MS, n);
    readings.push(reading(BASE_TS_MS + n * 1000, { motor_current: 865.0, output_frequency: 35.0, output_power: 405.0, motor_torque: 95.0 }));
    const res = eng.classify(readings, PUMP_5000, SP_40, `test:turb-cma${n}`);
    assert.equal(res.trouble_type, TroubleType.TURBULENSI);
    assert.ok(
      res.matched_rules.some((r) => r.matched_conditions.some((m) => m.includes(`CMA${n}`))),
      `expected CMA${n} in matched_conditions`,
    );
  }
  const at = steady(BASE_TS_MS, 5);
  at.push(reading(BASE_TS_MS + 5000, { motor_current: 860.0, output_frequency: 35.0, output_power: 405.0, motor_torque: 95.0 }));
  assert.equal(eng.classify(at, PUMP_5000, SP_40, "test:turb-cma10").trouble_type, TroubleType.TURBULENSI);
  const below = steady(BASE_TS_MS, 5);
  below.push(reading(BASE_TS_MS + 5000, { motor_current: 859.9, output_frequency: 35.0, output_power: 405.0, motor_torque: 95.0 }));
  assert.notEqual(eng.classify(below, PUMP_5000, SP_40, "test:turb-cma99").trouble_type, TroubleType.TURBULENSI);
});

test("turbulensi insufficient with zero history", () => {
  const eng = newEngine();
  const readings = [reading(BASE_TS_MS, { motor_current: 865.0, output_frequency: 35.0, output_power: 405.0, motor_torque: 95.0 })];
  const res = eng.classify(readings, PUMP_5000, SP_40, "test:turb-zero");
  assert.notEqual(res.trouble_type, TroubleType.TURBULENSI);
  assert.ok(res.limitations.some((l) => l.includes("need_30_got_0")));
});

// ------------------------------------------------------------------- tiers
const TIERS = ["500_lps", "3000_lps"] as const;

function tierRefs(profile_id: string) {
  const capacity = getProfileCapacity(profile_id);
  const rules = JSON.parse(readFileSync(RULES_FILE, "utf-8")) as {
    tiers: Record<string, { rules: Record<string, { conditions: Record<string, unknown>[] }> }>;
  };
  const tier_rules = rules.tiers[String(capacity)]!.rules;
  const pompa = tier_rules.POMPA_TERSANGKUT_SAMPAH!.conditions;
  const kw_ref = Number(pompa.find((c) => c.field === "output_power")!.value);
  const amp_ref = Number(pompa.find((c) => c.field === "motor_current")!.value);
  const turb = tier_rules.TURBULENSI!.conditions;
  const t_kw = Number(turb.find((c) => String(c.note ?? "").startsWith("T_KW"))!.value);
  const [window, threshold] = getTAParams({ conditions: turb });
  const sp = resolveEffectiveSetpoint(profile_id);
  return {
    capacity,
    sp_freq: Number(sp.frequency),
    dr_kw: kw_ref * 0.667,
    dr_amp: amp_ref * 0.64,
    t_kw,
    t_window: window,
    t_threshold: threshold,
  };
}

for (const profile_id of TIERS) {
  test(`tier ${profile_id}: voltage boundaries`, () => {
    const refs = tierRefs(profile_id);
    const eng = newEngine();
    const pc = { pump_id: refs.capacity, capacity_lps: refs.capacity };
    const sp = resolveEffectiveSetpoint(profile_id);
    const run = (volts: number) =>
      eng.classify(
        [reading(BASE_TS_MS, { input_voltage: volts, motor_current: 100.0, output_frequency: refs.sp_freq, output_power: 300.0, motor_torque: 80.0 })],
        pc,
        sp,
        `test:tier-v:${profile_id}`,
      );
    assert.equal(run(355).trouble_type, TroubleType.UNDERVOLTAGE);
    assert.notEqual(run(360).trouble_type, TroubleType.UNDERVOLTAGE);
    assert.equal(run(420).trouble_type, TroubleType.OVERVOLTAGE);
    assert.notEqual(run(410).trouble_type, TroubleType.OVERVOLTAGE);
  });

  test(`tier ${profile_id}: dry run match + freq gate`, () => {
    const refs = tierRefs(profile_id);
    const eng = newEngine();
    const pc = { pump_id: refs.capacity, capacity_lps: refs.capacity };
    const sp = resolveEffectiveSetpoint(profile_id);
    const run = (freq: number) =>
      eng.classify(
        [reading(BASE_TS_MS, { output_frequency: freq, output_power: refs.dr_kw * 0.9, motor_current: refs.dr_amp * 0.9, motor_torque: 40.0 })],
        pc,
        sp,
        `test:tier-dry:${profile_id}`,
      );
    assert.equal(run(refs.sp_freq).trouble_type, TroubleType.DRY_RUN);
    assert.notEqual(run(Math.round((refs.sp_freq + 0.01) * 100) / 100).trouble_type, TroubleType.DRY_RUN);
  });

  test(`tier ${profile_id}: turbulensi match`, () => {
    const refs = tierRefs(profile_id);
    const eng = newEngine();
    const pc = { pump_id: refs.capacity, capacity_lps: refs.capacity };
    const sp = resolveEffectiveSetpoint(profile_id);
    const readings = steady(BASE_TS_MS, refs.t_window, 500.0, refs.sp_freq - 5.0, refs.t_kw + 5.0, 95.0);
    readings.push(
      reading(BASE_TS_MS + refs.t_window * 1000, {
        motor_current: 500.0 + refs.t_threshold + 5.0,
        output_frequency: refs.sp_freq - 5.0,
        output_power: refs.t_kw + 5.0,
        motor_torque: 95.0,
      }),
    );
    assert.equal(eng.classify(readings, pc, sp, `test:tier-turb:${profile_id}`).trouble_type, TroubleType.TURBULENSI);
  });
}

// ---------------------------------------------------------------- PTS / RPM
function ptsEval(rpm: number, namespace: string): string | null {
  const eng = newEngine();
  const sp = resolveEffectiveSetpoint("5000_lps");
  const r = reading(BASE_TS_MS, {
    motor_speed: rpm,
    output_frequency: 5.0,
    output_power: 500.0,
    motor_current: 900.0,
    motor_torque: 100.0,
  });
  const res = eng.classify([r], PUMP_5000, sp, namespace);
  return evalOf(res, TroubleType.POMPA_TERSANGKUT_SAMPAH);
}

test("PTS RPM threshold 100 vs 99", () => {
  assert.equal(ptsEval(100.0, "test:pts-rpm:100"), "MATCH");
  assert.equal(ptsEval(99.0, "test:pts-rpm:99"), "NO_MATCH");
});

function engineWithPts(opts: { torque?: number; rpm?: number }): RulesEngine {
  const rules = JSON.parse(readFileSync(RULES_FILE, "utf-8")) as {
    tiers: Record<string, { rules: Record<string, { conditions: Record<string, unknown>[] }> }>;
  };
  for (const tier of ["500", "3000", "5000"]) {
    for (const cond of rules.tiers[tier]!.rules.POMPA_TERSANGKUT_SAMPAH!.conditions) {
      if (opts.torque !== undefined && cond.field === "motor_torque") cond.value = opts.torque;
      if (opts.rpm !== undefined && cond.field === "motor_speed") cond.value = opts.rpm;
    }
  }
  const eng = new RulesEngine(RULES_FILE);
  (eng as unknown as { _rules: unknown })._rules = rules;
  return eng;
}

function ptsEvalWith(eng: RulesEngine, rpm: number): string | null {
  const sp = resolveEffectiveSetpoint("5000_lps");
  const r = reading(BASE_TS_MS, {
    motor_speed: rpm,
    output_frequency: 5.0,
    output_power: 500.0,
    motor_current: 900.0,
    motor_torque: 100.0,
  });
  return evalOf(eng.classify([r], PUMP_5000, sp, "test:thr"), TroubleType.POMPA_TERSANGKUT_SAMPAH);
}

test("PTS torque/rpm thresholds come from rule_def", () => {
  assert.equal(ptsEvalWith(engineWithPts({ torque: 90 }), 50.0), "MATCH");
  assert.equal(ptsEvalWith(engineWithPts({ torque: 110 }), 50.0), "NO_MATCH");
  assert.equal(ptsEvalWith(engineWithPts({ rpm: 100 }), 100.0), "MATCH");
  assert.equal(ptsEvalWith(engineWithPts({ rpm: 101 }), 100.0), "NO_MATCH");
});

// ---------------------------------------------------------- effective refs
function classify3000(eng: RulesEngine, readings: ReturnType<typeof reading>[], rule_config: EffectiveRefs | null, namespace: string) {
  const sp = resolveEffectiveSetpoint("3000_lps");
  return eng.classify(readings, { pump_id: 3000, capacity_lps: 3000 }, sp, namespace, rule_config);
}

test("effective refs applied to all families", () => {
  const eng = newEngine();
  const readings = steady(BASE_TS_MS, 31, 520.0, 5.0, 260.0, 95.0);
  const old = classify3000(eng, readings, null, "test:refs:old");
  const newer = classify3000(eng, readings, { power_kw: 270.0, current_a: null }, "test:refs:new");
  assert.equal(evalOf(old, TroubleType.POMPA_TERSANGKUT_SAMPAH), "MATCH");
  assert.equal(evalOf(newer, TroubleType.POMPA_TERSANGKUT_SAMPAH), "NO_MATCH");
  assert.equal(evalOf(old, TroubleType.BANYAK_SAMPAH), "MATCH");
  assert.equal(evalOf(newer, TroubleType.BANYAK_SAMPAH), "NO_MATCH");
});

test("effective refs in turbulensi + dry run (power and current)", () => {
  const eng = newEngine();
  const turb = steady(BASE_TS_MS, 31, 500.0, 30.0, 260.0, 95.0);
  turb[30] = reading(BASE_TS_MS + 30000, {
    motor_current: 520.0,
    output_frequency: 30.0,
    output_power: 260.0,
    motor_torque: 95.0,
  });
  assert.equal(evalOf(classify3000(eng, turb, null, "test:turb:old"), TroubleType.TURBULENSI), "MATCH");
  assert.equal(evalOf(classify3000(eng, turb, { power_kw: 270.0, current_a: null }, "test:turb:new"), TroubleType.TURBULENSI), "NO_MATCH");

  const dry = [reading(BASE_TS_MS, { output_frequency: 38.0, output_power: 175.0, motor_current: 300.0, motor_torque: 60.0 })];
  assert.equal(evalOf(classify3000(eng, dry, null, "test:drykw:old"), TroubleType.DRY_RUN), "NO_MATCH");
  assert.equal(evalOf(classify3000(eng, dry, { power_kw: 270.0, current_a: null }, "test:drykw:new"), TroubleType.DRY_RUN), "MATCH");

  const dryA = [reading(BASE_TS_MS, { output_frequency: 38.0, output_power: 150.0, motor_current: 300.0, motor_torque: 60.0 })];
  assert.equal(evalOf(classify3000(eng, dryA, null, "test:drya:old"), TroubleType.DRY_RUN), "MATCH");
  assert.equal(evalOf(classify3000(eng, dryA, { power_kw: null, current_a: 400.0 }, "test:drya:new"), TroubleType.DRY_RUN), "NO_MATCH");
});

test("rule_config null keeps legacy behaviour and does not mutate global rules", () => {
  const eng = newEngine();
  const snapshot = JSON.parse(readFileSync(RULES_FILE, "utf-8"));
  const readings = [reading(BASE_TS_MS, { output_frequency: 5.0, output_power: 500.0 })];
  classify3000(eng, readings, { power_kw: 999.0, current_a: null }, "test:nomut");
  assert.deepStrictEqual((eng as unknown as { _rules: unknown })._rules, snapshot);
});

// ------------------------------------------------------ cross-pump isolation
test("config does not leak across namespaces", () => {
  const eng = newEngine();
  const sp = resolveEffectiveSetpoint("5000_lps");
  const run = (rule_config: EffectiveRefs | null, namespace: string) =>
    eng.classify(
      [reading(BASE_TS_MS, { motor_speed: 990.0, output_frequency: 5.0, output_power: 500.0, motor_current: 900.0, motor_torque: 100.0 })],
      PUMP_5000,
      sp,
      namespace,
      rule_config,
    );
  assert.equal(evalOf(run({ power_kw: 600.0, current_a: null }, "test:iso:A"), TroubleType.POMPA_TERSANGKUT_SAMPAH), "NO_MATCH");
  assert.equal(evalOf(run(null, "test:iso:B"), TroubleType.POMPA_TERSANGKUT_SAMPAH), "MATCH");
  assert.equal(evalOf(run(null, "test:iso:B"), TroubleType.POMPA_TERSANGKUT_SAMPAH), "MATCH");
});

// --------------------------------------------------------- trigger counters
test("trigger counters are namespace-isolated and reset on NO_MATCH", () => {
  const eng = newEngine();
  const ct = 5;
  for (let i = 0; i < 3; i++) eng.updateTriggerCounter(5000, "TURBULENSI", true, ct, "site:0");
  for (let i = 0; i < 2; i++) eng.updateTriggerCounter(5000, "TURBULENSI", true, ct, "site:1");
  assert.equal(eng.getTriggerCounter(5000, "TURBULENSI", "site:0"), 3);
  assert.equal(eng.getTriggerCounter(5000, "TURBULENSI", "site:1"), 2);
  assert.equal(eng.getTriggerCounter(5000, "TURBULENSI", "site:2"), 0);
  assert.equal(eng.getTriggerCounter(5000, "TURBULENSI"), 0);
  eng.updateTriggerCounter(5000, "DRY_RUN", true, 5, "site:A");
  eng.updateTriggerCounter(5000, "DRY_RUN", false, 5, "site:A");
  assert.equal(eng.getTriggerCounter(5000, "DRY_RUN", "site:A"), 0);
});

test("concurrent-classify style interleaving keeps namespaces isolated", async () => {
  const eng = newEngine();
  const sp = resolveEffectiveSetpoint("5000_lps");
  const work = async (ns: string) => {
    for (let i = 0; i < 20; i++) {
      eng.classify(
        [reading(BASE_TS_MS + i * 1000, { motor_current: 100.0, output_frequency: 40.0, output_power: 300.0, motor_torque: 80.0 })],
        PUMP_5000,
        sp,
        ns,
      );
      await Promise.resolve();
    }
  };
  await Promise.all(["site:A", "site:B", "site:C", "site:D"].map((ns) => work(ns)));
  assert.equal(eng.getTriggerCounter(5000, "BANYAK_SAMPAH", "site:A"), 0);
});
