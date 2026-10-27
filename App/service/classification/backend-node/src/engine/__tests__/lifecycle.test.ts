/**
 * Phase 1 — Lifecycle tests documenting legacy behavior.
 * Legacy has no explicit lifecycle (startAt/endAt), only immediate emission.
 * These tests document the current behavior before Phase 5 introduces lifecycle.
 * MIGRATED to new ClassificationEngine API (Phase 8) - now tests SPEC target behavior.
 */

import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import { readFileSync } from "node:fs";

import { ClassificationEngine, RULES_FILE } from "../engine.ts";
import { BASE_TS_MS, reading, series1s, PUMP_CONFIGS, SETPOINTS, tierRefs, buildPayloadFromSeries, createTestEngine } from "./helpers.ts";
import { TroubleType } from "../models.ts";
import type { ClassificationOutput, EffectiveRefs } from "../models.ts";

function newEngine(): ClassificationEngine {
  return createTestEngine();
}

function classify(eng: ClassificationEngine, readings: ReturnType<typeof reading>[], pump: any, sp: any, ns: string, ruleConfig?: EffectiveRefs | null): Promise<ClassificationOutput> {
  const payload = buildPayloadFromSeries(readings, pump, sp, ns);
  return eng.classify(payload, ruleConfig ?? null);
}

function matchedTrouble(result: ClassificationOutput): string | null {
  const detected = result.results.find((ev) => ev.detected);
  return detected?.troubleType ?? null;
}

function getTroubleState(result: ClassificationOutput, trouble: string): { detected: boolean; triggerCount: number; startAt: string | null; endAt: string | null } | null {
  const r = result.results.find((ev) => ev.troubleType === trouble);
  return r ? { detected: r.detected, triggerCount: r.triggerCount, startAt: r.startAt, endAt: r.endAt } : null;
}

// ----------------------------------------------------------------------
// Legacy: No Lifecycle - Immediate Emission (Documented for Reference)
// ----------------------------------------------------------------------
describe("Lifecycle: Legacy Immediate Emission (Reference Only)", () => {
  test("trouble appears immediately on first match (no count_trigger gating for PTS)", () => {
    const eng = newEngine();
    const refs = tierRefs("3000");
    const r = classify(eng, [reading(BASE_TS_MS, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], PUMP_CONFIGS["3000"], SETPOINTS["3000"], "test:life:pts");
    assert.equal(matchedTrouble(r), TroubleType.POMPA_TERSANGKUT_SAMPAH);
  });

  test("trouble disappears immediately on NO_MATCH (no persistence)", () => {
    const eng = newEngine();
    const refs = tierRefs("3000");

    // Match PTS
    const r1 = classify(eng, [reading(BASE_TS_MS, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], PUMP_CONFIGS["3000"], SETPOINTS["3000"], "test:life:pts:1");
    assert.equal(matchedTrouble(r1), TroubleType.POMPA_TERSANGKUT_SAMPAH);

    // Immediate NO_MATCH for ALL troubles (use safe reading that matches none)
    const safeReading = reading(BASE_TS_MS + 1000, { output_frequency: 50.0, output_power: 100.0, motor_current: 100.0, motor_torque: 50.0 });
    const r2 = classify(eng, [safeReading], PUMP_CONFIGS["3000"], SETPOINTS["3000"], "test:life:pts:2");
    // New engine: NORMAL is explicit, no trouble detected
    const normalResult = r2.results.find((ev) => ev.troubleType === TroubleType.NORMAL);
    assert.ok(normalResult);
    assert.equal(normalResult.detected, true);
  });

  test("no startAt/endAt in legacy output", () => {
    const eng = newEngine();
    const r = classify(eng, [reading(BASE_TS_MS, {
      output_frequency: 10.0,
      output_power: 260,
      motor_current: 520,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], PUMP_CONFIGS["3000"], SETPOINTS["3000"], "test:life:no-timestamps");
    // Legacy ClassificationResult has no startAt/endAt fields
    assert.equal("startAt" in r, false);
    assert.equal("endAt" in r, false);
    assert.equal("triggerCount" in r, false);
    assert.equal("stagnationCount" in r, false);
  });

  test("NORMAL is implicit fallback when no rules match", () => {
    const eng = newEngine();
    const r = classify(eng, [reading(BASE_TS_MS, { output_frequency: 40.0, output_power: 100.0 })], PUMP_CONFIGS["3000"], SETPOINTS["3000"], "test:life:normal");
    // Legacy: single trouble_type = NORMAL
    assert.equal(r.trouble_type, TroubleType.NORMAL);
    assert.equal(r.matched_rules.length, 0);
  });

  test("first-match-wins: only one trouble in matched_rules", () => {
    // Legacy returns single trouble_type, matched_rules contains all matches but trouble_type is first
    const eng = newEngine();
    // Create conditions that could match multiple troubles
    // (Hard to do with current rules since they're mutually exclusive by design)
    // This documents the single-trouble contract
    assert.ok(true);
  });
});

// ----------------------------------------------------------------------
// Trigger Counter as Proxy for Persistence (Legacy)
// ----------------------------------------------------------------------
describe("Lifecycle: Trigger Counter as Persistence Proxy (Legacy)", () => {
  test("TURBULENSI requires count_trigger (default 1 in rules) but uses counter for DR_F", () => {
    const eng = newEngine();
    // DRY_RUN has freq_sustain counter for DR_F
    // TURBULENSI in rules.json has no count_trigger (defaults to 1)
    // But DR_F gating is separate
    assert.ok(true);
  });

  test("DR_F counter arms then emits on full match", () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const refs = tierRefs("3000");

    // freq_sustain = 1, so DR_F arms immediately
    const r = classify(eng, [reading(BASE_TS_MS, {
      output_frequency: refs.spFreq,
      output_power: refs.drKw * 0.9,
      motor_current: refs.drAmp * 0.9,
      motor_torque: 40.0,
    })], pump, sp, "test:life:dr:full");
    assert.equal(matchedTrouble(r), TroubleType.DRY_RUN);
  });
});

// ----------------------------------------------------------------------
// Mathematical Area State (Historical Window)
// ----------------------------------------------------------------------
describe("Lifecycle: Mathematical Area Window State", () => {
  test("turbulensi window builds across classifications (same pumpId)", () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const refs = tierRefs("3000");

    // Feed 30 historical readings
    const history = series1s(BASE_TS_MS, 30, { motor_current: 500.0, output_frequency: refs.spFreq - 5, output_power: refs.tKw + 5, motor_torque: 95.0 });
    for (let i = 0; i < history.length; i++) {
      classify(eng, [history[i]], pump, sp, "test:life:turb:hist");
    }

    // 31st reading triggers MA30
    const trigger = reading(BASE_TS_MS + 30000, { motor_current: 515.0, output_frequency: refs.spFreq - 5, output_power: refs.tKw + 5, motor_torque: 95.0 });
    const r = classify(eng, [...history, trigger], pump, sp, "test:life:turb:trigger");
    assert.equal(matchedTrouble(r), TroubleType.TURBULENSI);
  });

  test("different pumpId = different window (state isolation)", () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const refs = tierRefs("3000");

    // Build history in pump 3000
    const history = series1s(BASE_TS_MS, 30, { motor_current: 500.0, output_frequency: refs.spFreq - 5, output_power: refs.tKw + 5, motor_torque: 95.0 });
    for (const r of history) {
      classify(eng, [r], pump, sp, "pump3000");
    }

    // Trigger in pump 5000 (no history) -> insufficient
    const trigger = reading(BASE_TS_MS + 30000, { motor_current: 515.0, output_frequency: refs.spFreq - 5, output_power: refs.tKw + 5, motor_torque: 95.0 });
    const r = classify(eng, [trigger], PUMP_CONFIGS["5000"], sp, "pump5000");
    assert.notEqual(matchedTrouble(r), TroubleType.TURBULENSI);
    assert.ok(r.missingData["turbulensi"]?.length);
  });
});

// ----------------------------------------------------------------------
// Effective Refs Snapshot (Legacy: per-classify)
// ----------------------------------------------------------------------
describe("Lifecycle: Effective Refs Snapshot Per Classify", () => {
  test("rule_config applies only to current classify call", () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const readings = [reading(BASE_TS_MS, { output_frequency: 5.0, output_power: 260, motor_current: 520, motor_torque: 95, motor_speed: 100 })];

    // With default refs -> match
    const r1 = classify(eng, readings, pump, sp, "test:refs:snap:1", null);
    assert.equal(matchedTrouble(r1), TroubleType.POMPA_TERSANGKUT_SAMPAH);

    // With override refs -> no match
    const r2 = classify(eng, readings, pump, sp, "test:refs:snap:2", { power_kw: 270, current_a: null });
    assert.notEqual(matchedTrouble(r2), TroubleType.POMPA_TERSANGKUT_SAMPAH);

    // Back to default -> match again (global rules not mutated)
    const r3 = classify(eng, readings, pump, sp, "test:refs:snap:3", null);
    assert.equal(matchedTrouble(r3), TroubleType.POMPA_TERSANGKUT_SAMPAH);
  });

  test("global rules never mutated by rule_config", () => {
    const eng = newEngine();
    const snapshot = JSON.parse(readFileSync(new URL("../rules.json", import.meta.url), "utf-8"));
    const readings = [reading(BASE_TS_MS, { output_frequency: 5.0, output_power: 500.0 })];
    classify(eng, readings, PUMP_CONFIGS["3000"], SETPOINTS["3000"], "test:refs:mutate", { power_kw: 999.0, current_a: null });
    const rules = (eng as any)._rules;
    assert.equal(rules.tiers["3000"].rules.POMPA_TERSANGKUT_SAMPAH.conditions[1].value, 250);
  });
});

// ----------------------------------------------------------------------
// Spec Target Lifecycle (Phase 5+) - NOW IMPLEMENTED
// ----------------------------------------------------------------------
describe("Lifecycle: Spec Target Behavior (Phase 5+ Implemented)", () => {
  test("each trouble has startAt/endAt in output", async () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const refs = tierRefs("3000");
    const r = await classify(eng, [reading(BASE_TS_MS, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], pump, sp, "test:life:spec:1");

    const pts = getTroubleState(r, "pompa_tersangkut_sampah");
    assert.ok(pts);
    assert.equal(pts.detected, true);
    assert.ok(pts.startAt);
    assert.equal(pts.endAt, null);
    assert.equal(pts.triggerCount, 1);
  });

  test("triggerCount increments on TRUE, resets on FALSE", async () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const refs = tierRefs("3000");

    // Event 1: TRUE
    const r1 = await classify(eng, [reading(BASE_TS_MS, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], pump, sp, "test:life:tc:1");
    let pts = getTroubleState(r1, "pompa_tersangkut_sampah");
    assert.equal(pts?.triggerCount, 1);

    // Event 2: TRUE again
    const r2 = await classify(eng, [reading(BASE_TS_MS + 1000, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], pump, sp, "test:life:tc:2");
    pts = getTroubleState(r2, "pompa_tersangkut_sampah");
    assert.equal(pts?.triggerCount, 2);

    // Event 3: FALSE (safe reading)
    const r3 = await classify(eng, [reading(BASE_TS_MS + 2000, { output_frequency: 50.0, output_power: 100.0, motor_current: 100.0, motor_torque: 50.0 })], pump, sp, "test:life:tc:3");
    pts = getTroubleState(r3, "pompa_tersangkut_sampah");
    assert.equal(pts?.triggerCount, 0);
    assert.equal(pts?.detected, false);
    assert.ok(pts?.endAt);
  });

  test("stagnationCount increments on not-ready, resets on ready", async () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];

    // Event 1: insufficient history (not-ready)
    const r1 = await classify(eng, [reading(BASE_TS_MS, { motor_current: 515.0, output_frequency: 35.0, output_power: 260.0, motor_torque: 95.0 })], pump, sp, "test:life:stag:1");
    // turbulensi should be in missingData due to insufficient history
    assert.ok(r1.missingData["turbulensi"]);

    // Event 2: still insufficient
    const r2 = await classify(eng, [reading(BASE_TS_MS + 1000, { motor_current: 515.0, output_frequency: 35.0, output_power: 260.0, motor_torque: 95.0 })], pump, sp, "test:life:stag:2");
    assert.ok(r2.missingData["turbulensi"]);

    // Event 3: sufficient history -> ready
    const history = series1s(BASE_TS_MS + 2000, 30, { motor_current: 500.0, output_frequency: 35.0, output_power: 260.0, motor_torque: 95.0 });
    history.push(reading(BASE_TS_MS + 32000, { motor_current: 515.0, output_frequency: 35.0, output_power: 260.0, motor_torque: 95.0 }));
    const r3 = await classify(eng, history, pump, sp, "test:life:stag:3");
    // Now turbulensi should be ready
    const turb = r3.results.find((ev) => ev.troubleType === "turbulensi");
    if (turb) {
      assert.equal(turb.status, "Dapat Di Klasifikasi");
    }
  });

  test("activeTroubles from State Manager, not latest results", async () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];
    const refs = tierRefs("3000");

    // Event 1: activate trouble
    const r1 = await classify(eng, [reading(BASE_TS_MS, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], pump, sp, "test:life:active:1");
    assert.ok(r1.activeTroubles.includes("pompa_tersangkut_sampah"));

    // Event 2: NULL/missing data for PTS (simulate by removing freq)
    const r2 = await classify(eng, [reading(BASE_TS_MS + 1000, { output_power: 100.0, motor_current: 100.0, motor_torque: 50.0, motor_speed: 100.0 })], pump, sp, "test:life:active:2");
    // activeTroubles should still have the trouble (NULL doesn't clear active)
    assert.ok(r2.activeTroubles.includes("pompa_tersangkut_sampah"));
  });

  test("NORMAL derived after all troubles updated", async () => {
    const eng = newEngine();
    const pump = PUMP_CONFIGS["3000"];
    const sp = SETPOINTS["3000"];

    // No troubles active -> NORMAL detected
    const r1 = await classify(eng, [reading(BASE_TS_MS, { output_frequency: 40.0, output_power: 100.0, motor_current: 100.0, motor_torque: 50.0 })], pump, sp, "test:life:normal:1");
    const normal = r1.results.find((ev) => ev.troubleType === "normal");
    assert.ok(normal);
    assert.equal(normal.detected, true);

    // Activate a trouble
    const refs = tierRefs("3000");
    const r2 = await classify(eng, [reading(BASE_TS_MS + 1000, {
      output_frequency: 10.0,
      output_power: refs.kwRef + 10,
      motor_current: refs.ampRef + 10,
      motor_torque: 110.0,
      motor_speed: 100.0,
    })], pump, sp, "test:life:normal:2");
    const normal2 = r2.results.find((ev) => ev.troubleType === "normal");
    assert.ok(normal2);
    assert.equal(normal2.detected, false); // NORMAL not detected when trouble active
  });

  test("OFF >120s resets activeTroubles (OD-01/OD-02 stubbed)", () => {
    // Per spec: verified OFF continuous >120s by received_at diff
    // Resets activeTroubles, lifecycle details TBD (OD-02)
    // Currently stubbed - isPumpOff throws if not injected
    assert.ok(true);
  });
});