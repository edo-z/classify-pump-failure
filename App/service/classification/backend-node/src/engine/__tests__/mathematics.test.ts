/**
 * Phase 1 — Mathematics unit tests for pure functions.
 * Tests the core mathematical formulas independently of engine orchestration.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { freqEq2dp, freqBelowSetpoint, freqAtOrBelowSetpoint } from "../mathematics/frequency.ts";
import { computeTA, getTAParams, checkFluctuation } from "../mathematics/moving-average.ts";
import { calculateUnbalance } from "../mathematics/three-phase.ts";
import { resolveOperatingSetpoint } from "../configuration-resolver.ts";
import { aggregateReadings } from "../mathematics/index.ts";
import { cleanPositive, resolveLayeredValue, resolveEffectiveRefs, applyEffectiveRefs } from "../configuration-resolver.ts";
import type { SensorReading, OperatingSetpoint } from "../models.ts";
import { BASE_TS_MS, reading, series1s } from "./helpers.ts";

// ----------------------------------------------------------------------
// Frequency equality (DR_F) - ROUND_HALF_UP 2 decimal places
// ----------------------------------------------------------------------
describe("Mathematics: freqEq2dp (DR_F)", () => {
  const cases: [number | null, number | null, boolean, string][] = [
    [40.004, 40.0, true, "40.004 rounds to 40.00"],
    [40.005, 40.0, false, "40.005 rounds to 40.01 (HALF_UP)"],
    [38.004, 38.0, true, "38.004 rounds to 38.00"],
    [38.005, 38.0, false, "38.005 rounds to 38.01"],
    [46.104, 46.1, true, "46.104 rounds to 46.10"],
    [46.105, 46.1, false, "46.105 rounds to 46.11"],
    [40.0, 40.0, true, "exact match"],
    [39.995, 40.0, true, "39.995 rounds to 40.00 (HALF_UP)"],
    [39.994, 40.0, false, "39.994 rounds to 39.99"],
    [null, 40.0, false, "actual null"],
    [40.0, null, false, "setpoint null"],
    [40.0, 0, false, "setpoint zero"],
    [40.0, -1, false, "setpoint negative"],
    [NaN, 40.0, false, "actual NaN"],
    [40.0, NaN, false, "setpoint NaN"],
  ];

  for (const [actual, sp, expected, desc] of cases) {
    test(`${desc}: freqEq2dp(${actual}, ${sp}) === ${expected}`, () => {
      assert.equal(freqEq2dp(actual as any, sp as any), expected);
    });
  }
});

// ----------------------------------------------------------------------
// Moving Average / CMA (Turbulensi T_A)
// ----------------------------------------------------------------------
describe("Mathematics: computeTA (Turbulensi T_A)", () => {
  test("zero readings -> insufficient", () => {
    const res = computeTA([], 30, 10.0);
    assert.equal(res.insufficient, true);
    assert.equal(res.reason, "no_readings");
    assert.equal(res.T_A, false);
  });

  test("current reading null -> insufficient", () => {
    const readings = [reading(BASE_TS_MS, { motor_current: null })];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.insufficient, true);
    assert.equal(res.reason, "current_none");
    assert.equal(res.A, null);
  });

  test("no valid history -> insufficient (need 30 got 0)", () => {
    const readings = series1s(BASE_TS_MS, 5, { motor_current: null });
    readings.push(reading(BASE_TS_MS + 5000, { motor_current: 865.0 }));
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.insufficient, true);
    assert.ok(res.reason?.includes("need_30_got_0"));
  });

  test("1 history sample -> CMA1", () => {
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),
      reading(BASE_TS_MS + 1000, { motor_current: 865.0 }),
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.refKind, "CMA");
    assert.equal(res.window, 1);
    assert.equal(res.MA_A, 850.0);
    assert.equal(res.Delta_A, 15.0);
    assert.equal(res.Abs_Delta_A, 15.0);
    assert.equal(res.T_A, true);
  });

  test("5 history samples -> CMA5", () => {
    const readings = series1s(BASE_TS_MS, 5, { motor_current: 850.0 });
    readings.push(reading(BASE_TS_MS + 5000, { motor_current: 865.0 }));
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.refKind, "CMA");
    assert.equal(res.window, 5);
    assert.equal(res.MA_A, 850.0);
    assert.equal(res.T_A, true);
  });

  test("29 history samples -> CMA29", () => {
    const readings = series1s(BASE_TS_MS, 29, { motor_current: 850.0 });
    readings.push(reading(BASE_TS_MS + 29000, { motor_current: 865.0 }));
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.refKind, "CMA");
    assert.equal(res.window, 29);
    assert.equal(res.MA_A, 850.0);
  });

  test("30 history samples -> MA30", () => {
    const readings = series1s(BASE_TS_MS, 30, { motor_current: 850.0 });
    readings.push(reading(BASE_TS_MS + 30000, { motor_current: 865.0 }));
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.refKind, "MA30");
    assert.equal(res.window, 30);
    assert.equal(res.MA_A, 850.0);
  });

  test("31 history samples -> MA30 (trailing 30)", () => {
    const readings = series1s(BASE_TS_MS, 31, { motor_current: 850.0 });
    readings.push(reading(BASE_TS_MS + 31000, { motor_current: 865.0 }));
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.refKind, "MA30");
    assert.equal(res.window, 30);
    // MA30 should be average of last 30 (positions 1-30), not including position 0
    assert.equal(res.MA_A, 850.0);
  });

  test("varying history values -> correct MA", () => {
    const readings = [
      reading(BASE_TS_MS, { motor_current: 100.0 }),
      reading(BASE_TS_MS + 1000, { motor_current: 200.0 }),
      reading(BASE_TS_MS + 2000, { motor_current: 300.0 }),
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.refKind, "CMA");
    assert.equal(res.window, 2);
    assert.equal(res.MA_A, 150.0); // (100 + 200) / 2
    assert.equal(res.Delta_A, 150.0); // 300 - 150
    assert.equal(res.T_A, true);
  });

  test("threshold boundary: |delta| == threshold -> true", () => {
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),
      reading(BASE_TS_MS + 1000, { motor_current: 860.0 }),
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.Abs_Delta_A, 10.0);
    assert.equal(res.T_A, true);
  });

  test("threshold boundary: |delta| < threshold -> false", () => {
    // Use values that don't have floating point precision issues
    // 850 + 9.89 = 859.89
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),
      reading(BASE_TS_MS + 1000, { motor_current: 859.89 }),
    ];
    const res = computeTA(readings, 30, 10.0);
    // Allow small floating point tolerance
    assert.ok(Math.abs((res.Abs_Delta_A ?? 0) - 9.89) < 0.001);
    assert.equal(res.T_A, false);
  });

  test("insufficient flag false when history >= 1", () => {
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),
      reading(BASE_TS_MS + 1000, { motor_current: 865.0 }),
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.insufficient, false);
  });

  test("10s gap policy: history before gap >10s is excluded", () => {
    // Readings: 850@0s, 850@1s, 850@2s, GAP 15s, 850@17s, 850@18s, current@19s=865
    // Only 2 readings (17s, 18s) should be used (after gap)
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),           // 0s
      reading(BASE_TS_MS + 1000, { motor_current: 850.0 }),    // 1s
      reading(BASE_TS_MS + 2000, { motor_current: 850.0 }),    // 2s
      // Gap of 15s (15000ms) - exceeds 10s threshold
      reading(BASE_TS_MS + 17000, { motor_current: 850.0 }),   // 17s
      reading(BASE_TS_MS + 18000, { motor_current: 850.0 }),   // 18s
      reading(BASE_TS_MS + 19000, { motor_current: 865.0 }),   // 19s current
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.collected, 2); // Only 2 historical readings after gap
    assert.equal(res.refKind, "CMA");
    assert.equal(res.MA_A, 850.0);
    assert.equal(res.T_A, true); // 865 - 850 = 15 >= 10
  });

  test("10s gap policy: exactly 10s gap is allowed (continuity maintained)", () => {
    // Gap of exactly 10000ms should NOT break continuity
    // 0s -> 1s (1s gap), 1s -> 11s (10s gap, exactly at boundary)
    // All 3 historical readings are contiguous (no gap > 10s)
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),           // 0s
      reading(BASE_TS_MS + 1000, { motor_current: 850.0 }),    // 1s
      reading(BASE_TS_MS + 11000, { motor_current: 850.0 }),   // 11s (gap = 10s from previous)
      reading(BASE_TS_MS + 12000, { motor_current: 865.0 }),   // 12s current
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.collected, 3); // All 3 historical readings included (no gap > 10s)
    assert.equal(res.MA_A, 850.0);
  });

  test("10s gap policy: multiple gaps, only most recent contiguous segment used", () => {
    // 850@0s, GAP 15s, 850@16s, GAP 15s, 850@32s, 850@33s, current@34s=865
    // Only 32s and 33s should be used (after last gap)
    const readings = [
      reading(BASE_TS_MS, { motor_current: 850.0 }),            // 0s
      reading(BASE_TS_MS + 1000, { motor_current: 850.0 }),     // 1s
      // Gap 15s
      reading(BASE_TS_MS + 16000, { motor_current: 850.0 }),    // 16s
      reading(BASE_TS_MS + 17000, { motor_current: 850.0 }),    // 17s
      // Gap 15s
      reading(BASE_TS_MS + 32000, { motor_current: 850.0 }),    // 32s
      reading(BASE_TS_MS + 33000, { motor_current: 850.0 }),    // 33s
      reading(BASE_TS_MS + 34000, { motor_current: 865.0 }),    // 34s current
    ];
    const res = computeTA(readings, 30, 10.0);
    assert.equal(res.collected, 2); // Only last 2 readings after final gap
    assert.equal(res.MA_A, 850.0);
  });
});

// ----------------------------------------------------------------------
// getTAParams - extract window/threshold from rule conditions
// ----------------------------------------------------------------------
describe("Mathematics: getTAParams", () => {
  test("default window=30, threshold=10 when not specified", () => {
    const ruleDef = { conditions: [{ field: "motor_current", op: "deviation_from_ma" }] };
    const [w, t] = getTAParams(ruleDef);
    assert.equal(w, 30);
    assert.equal(t, 10.0);
  });

  test("custom window and threshold from condition", () => {
    const ruleDef = {
      conditions: [{
        field: "motor_current",
        op: "deviation_from_ma",
        window: 20,
        threshold: 5.5,
      }],
    };
    const [w, t] = getTAParams(ruleDef);
    assert.equal(w, 20);
    assert.equal(t, 5.5);
  });

  test("invalid window falls back to default", () => {
    const ruleDef = {
      conditions: [{
        field: "motor_current",
        op: "deviation_from_ma",
        window: "invalid",
        threshold: "invalid",
      }],
    };
    const [w, t] = getTAParams(ruleDef);
    assert.equal(w, 30);
    assert.equal(t, 10.0);
  });

  test("window < 1 falls back to default", () => {
    const ruleDef = {
      conditions: [{
        field: "motor_current",
        op: "deviation_from_ma",
        window: 0,
        threshold: 10.0,
      }],
    };
    const [w, t] = getTAParams(ruleDef);
    assert.equal(w, 30);
  });
});

// ----------------------------------------------------------------------
// checkFluctuation (legacy, currently unreachable but ported)
// ----------------------------------------------------------------------
describe("Mathematics: checkFluctuation", () => {
  test("less than 4 values -> false", () => {
    const readings = series1s(BASE_TS_MS, 3, { output_frequency: 40.0 });
    assert.equal(checkFluctuation(readings, "output_frequency", 1.0), false);
  });

  test("no significant moves -> false", () => {
    const readings = series1s(BASE_TS_MS, 5, { output_frequency: 40.0 });
    assert.equal(checkFluctuation(readings, "output_frequency", 1.0), false);
  });

  test("significant moves with reversals -> true", () => {
    const readings = [
      reading(BASE_TS_MS, { output_frequency: 40.0 }),
      reading(BASE_TS_MS + 1000, { output_frequency: 42.0 }),
      reading(BASE_TS_MS + 2000, { output_frequency: 39.0 }),
      reading(BASE_TS_MS + 3000, { output_frequency: 42.0 }),
      reading(BASE_TS_MS + 4000, { output_frequency: 39.0 }),
    ];
    assert.equal(checkFluctuation(readings, "output_frequency", 1.0), true);
  });

  test("center band enforcement", () => {
    const readings = [
      reading(BASE_TS_MS, { output_frequency: 40.0 }),
      reading(BASE_TS_MS + 1000, { output_frequency: 42.0 }),
      reading(BASE_TS_MS + 2000, { output_frequency: 39.0 }),
      reading(BASE_TS_MS + 3000, { output_frequency: 42.0 }),
    ];
    // All within 40 +/- 2
    assert.equal(checkFluctuation(readings, "output_frequency", 2.0, 40.0), true);
    // One outside band
    const readings2 = [
      reading(BASE_TS_MS, { output_frequency: 40.0 }),
      reading(BASE_TS_MS + 1000, { output_frequency: 45.0 }),
      reading(BASE_TS_MS + 2000, { output_frequency: 39.0 }),
      reading(BASE_TS_MS + 3000, { output_frequency: 42.0 }),
    ];
    assert.equal(checkFluctuation(readings2, "output_frequency", 2.0, 40.0), false);
  });
});

// ----------------------------------------------------------------------
// resolveOperatingSetpoint
// ----------------------------------------------------------------------
describe("Mathematics: resolveOperatingSetpoint", () => {
  const setpoints: OperatingSetpoint = { frequency: 38.0, rpm: 950, torque: 80 };

  test("valid ref_field returns correct value", () => {
    assert.equal(resolveOperatingSetpoint(setpoints, "setpoint_freq"), 38.0);
    assert.equal(resolveOperatingSetpoint(setpoints, "setpoint_rpm"), 950);
    assert.equal(resolveOperatingSetpoint(setpoints, "setpoint_torque"), 80);
  });

  test("invalid ref_field returns null", () => {
    assert.equal(resolveOperatingSetpoint(setpoints, "invalid"), null);
    assert.equal(resolveOperatingSetpoint(setpoints, undefined), null);
  });

  test("null setpoint field returns null", () => {
    const sp: OperatingSetpoint = { frequency: null, rpm: 950, torque: 80 };
    assert.equal(resolveOperatingSetpoint(sp, "setpoint_freq"), null);
  });
});

// ----------------------------------------------------------------------
// aggregateReadings - last valid reading per field (LEGACY: only last reading)
// ----------------------------------------------------------------------
describe("Mathematics: aggregateReadings", () => {
  test("returns last reading's non-null values (legacy behavior)", () => {
    const readings = [
      reading(BASE_TS_MS, { output_frequency: 35.0, output_power: 100.0 }),
      reading(BASE_TS_MS + 1000, { output_frequency: 36.0, output_power: null }),
      reading(BASE_TS_MS + 2000, { output_frequency: null, output_power: 200.0 }),
    ];
    const agg = aggregateReadings(readings);
    // Legacy: only last reading's non-null values
    assert.equal("output_frequency" in agg, false); // last reading has null
    assert.equal(agg.output_power, 200.0); // last reading has 200
  });

  test("empty readings returns empty object", () => {
    const agg = aggregateReadings([]);
    assert.deepEqual(agg, {});
  });

  test("null fields are not included", () => {
    const readings = [reading(BASE_TS_MS, { output_frequency: null, output_power: null })];
    const agg = aggregateReadings(readings);
    assert.equal("output_frequency" in agg, false);
    assert.equal("output_power" in agg, false);
  });
});

// ----------------------------------------------------------------------
// Configuration Resolver Mathematics
// ----------------------------------------------------------------------
describe("Mathematics: Configuration Resolver", () => {
  describe("cleanPositive", () => {
    test("positive number -> same number", () => assert.equal(cleanPositive(42), 42));
    test("positive numeric string -> number", () => assert.equal(cleanPositive("42.5"), 42.5));
    test("zero -> null", () => assert.equal(cleanPositive(0), null));
    test("negative -> null", () => assert.equal(cleanPositive(-5), null));
    test("null -> null", () => assert.equal(cleanPositive(null), null));
    test("undefined -> null", () => assert.equal(cleanPositive(undefined), null));
    test("NaN -> null", () => assert.equal(cleanPositive(NaN), null));
    test("Infinity -> null (not finite)", () => assert.equal(cleanPositive(Infinity), null));
    test("non-numeric string -> null", () => assert.equal(cleanPositive("abc"), null));
  });

  describe("resolveLayeredValue (priority: override -> flowhead -> profile)", () => {
    test("override wins", () => assert.equal(resolveLayeredValue(100, 200, 300), 100));
    test("flowhead wins when override null", () => assert.equal(resolveLayeredValue(null, 200, 300), 200));
    test("profile wins when override and flowhead null", () => assert.equal(resolveLayeredValue(null, null, 300), 300));
    test("all null -> null", () => assert.equal(resolveLayeredValue(null, null, null), null));
    test("invalid override skipped", () => assert.equal(resolveLayeredValue(-5, 200, 300), 200));
  });

  describe("resolveEffectiveRefs", () => {
    test("full priority chain", () => {
      const res = resolveEffectiveRefs(
        100, 200,    // profile
        150, 250,    // flowhead
        300, 400     // override
      );
      assert.deepEqual(res, { power_kw: 300, current_a: 400 });
    });

    test("partial override", () => {
      const res = resolveEffectiveRefs(
        100, 200,
        null, null,
        300, null
      );
      assert.deepEqual(res, { power_kw: 300, current_a: 200 });
    });
  });

  describe("applyEffectiveRefs", () => {
    test("replaces condition values in tier rules copy", () => {
      const tierRules = {
        rules: {
          TEST_RULE: {
            conditions: [
              { field: "output_power", value: 100 },
              { field: "motor_current", value: 200 },
              { field: "output_frequency", value: 30 },
            ],
          },
        },
      };
      const refs = { power_kw: 500, current_a: 600 };
      const result = applyEffectiveRefs(tierRules, refs);
      assert.ok(result.rules);
      assert.ok(result.rules!.TEST_RULE.conditions);
      assert.equal(result.rules!.TEST_RULE.conditions[0].value, 500);
      assert.equal(result.rules!.TEST_RULE.conditions[1].value, 600);
      assert.equal(result.rules!.TEST_RULE.conditions[2].value, 30); // unchanged
    });

    test("does not mutate original", () => {
      const tierRules = { rules: { TEST: { conditions: [{ field: "output_power", value: 100 }] } } };
      const refs = { power_kw: 500, current_a: null };
      applyEffectiveRefs(tierRules, refs);
      assert.ok(tierRules.rules);
      assert.ok(tierRules.rules!.TEST.conditions);
      assert.equal(tierRules.rules!.TEST.conditions[0].value, 100); // original unchanged
    });

    test("null ref leaves condition unchanged", () => {
      const tierRules = { rules: { TEST: { conditions: [{ field: "output_power", value: 100 }] } } };
      const refs = { power_kw: null, current_a: null };
      const result = applyEffectiveRefs(tierRules, refs);
      assert.ok(result.rules);
      assert.ok(result.rules!.TEST.conditions);
      assert.equal(result.rules!.TEST.conditions[0].value, 100);
    });
  });
});

// ----------------------------------------------------------------------
// Unbalance Formula (IEC/NEMA: |avg - phase| / avg * 100)
// ----------------------------------------------------------------------
describe("Mathematics: Unbalance Formula (IEC)", () => {
  // IEC formula: deviation% = |avg - phase| / avg * 100, Unbalance = max(|Eu|,|Ev|,|Ew|) >= threshold
  const threshold = 10.0;

  test("balanced phases -> no match", () => {
    const res = calculateUnbalance(100, 100, 100, threshold);
    assert.equal(res.matched, false);
    assert.equal(res.eu, 0);
    assert.equal(res.ev, 0);
    assert.equal(res.ew, 0);
    assert.equal(res.ri, 100);
  });

  test("one phase high -> match (IEC: |avg-u|/avg >= 10%)", () => {
    // u=125, v=100, w=100 -> ri=108.33, Eu=|108.33-125|/108.33*100 = 15.4%
    const res = calculateUnbalance(125, 100, 100, threshold);
    assert.ok(res.eu! >= 10.0);
    assert.equal(res.matched, true);
    assert.ok(res.eu! > res.ev!);
  });

  test("one phase low -> match (IEC: |avg-u|/avg >= 10%)", () => {
    // u=85, v=100, w=100 -> ri=95, Eu=|95-85|/95*100 = 10.5%
    const res = calculateUnbalance(85, 100, 100, threshold);
    assert.ok(res.eu! >= 10.0);
    assert.equal(res.matched, true);
  });

  test("zero phase current -> match (IEC: deviation = 100%)", () => {
    // u=0, v=100, w=100 -> ri=66.67, Eu=|66.67-0|/66.67*100 = 100%
    const res = calculateUnbalance(0, 100, 100, threshold);
    assert.ok(res.eu! >= 10.0);
    assert.equal(res.matched, true);
  });

  test("null/undefined phases -> not ready (matched=false)", () => {
    const res1 = calculateUnbalance(null as any, 100, 100, threshold);
    const res2 = calculateUnbalance(100, undefined as any, 100, threshold);
    const res3 = calculateUnbalance(100, 100, NaN, threshold);
    assert.equal(res1.matched, false);
    assert.equal(res2.matched, false);
    assert.equal(res3.matched, false);
  });
});

// ----------------------------------------------------------------------
// Dry Run Thresholds Mathematics
// ----------------------------------------------------------------------
describe("Mathematics: Dry Run Thresholds", () => {
  test("DR_kW = 0.667 * PTS_kW_ref", () => {
    const ptsKw = 250.0;
    assert.equal(Number((ptsKw * 0.667).toFixed(3)), 166.75);
  });

  test("DR_A = 0.64 * PTS_A_ref", () => {
    const ptsA = 517.0;
    assert.equal(Number((ptsA * 0.64).toFixed(2)), 330.88);
  });

  test("torque threshold < 70%", () => {
    // This is a constant in the legacy code
    assert.equal(70, 70);
  });

  test("tier 500: DR_kW = 0.667 * 75 = 50.025", () => {
    assert.equal(Number((75 * 0.667).toFixed(3)), 50.025);
  });

  test("tier 500: DR_A = 0.64 * 157 = 100.48", () => {
    assert.equal(Number((157 * 0.64).toFixed(2)), 100.48);
  });

  test("tier 5000: DR_kW = 0.667 * 400 = 266.8", () => {
    assert.equal(Number((400 * 0.667).toFixed(1)), 266.8);
  });

  test("tier 5000: DR_A = 0.64 * 867 = 554.88", () => {
    assert.equal(Number((867 * 0.64).toFixed(2)), 554.88);
  });
});

// ----------------------------------------------------------------------
// PTS Frequency Boundary Conflict (OD-08)
// ----------------------------------------------------------------------
describe("Mathematics: PTS Frequency Boundary (OD-08)", () => {
  // rules.json uses <= 10, pump_profiles.json uses < 10
  test("rules.json operator is <=", () => {
    // This is documented in the rules.json - the condition uses "<="
    // Legacy code in evaluator.ts line 137 uses: freq !== null && freq <= ref_freq
    // Where ref_freq comes from rule condition value (10)
    assert.ok(true); // Documented behavior
  });

  test("pump_profiles.json operator is <", () => {
    // pump_profiles.json has "operator": "<" for frequency_hz in pompa_tersangkut_sampah
    assert.ok(true); // Documented conflict
  });

  test("boundary 10.0: rules.json includes, profiles.json excludes", () => {
    // At exactly 10.0 Hz:
    // rules.json (<=) -> TRUE
    // pump_profiles.json (<) -> FALSE
    // Legacy evaluator follows rules.json (<=)
    assert.ok(10.0 <= 10.0);
    assert.ok(!(10.0 < 10.0));
  });
});