/**
 * Phase 2 — Tests for canonical telemetry parsing and typed configuration.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { normalizeTelemetry, parseNumeric, parseBoolean, parseTimestamp, validateEnvelope, extractIdentity } from "../telemetry.ts";
import { validateFlowheadConfig, validateVfdConfig, validateRuntimeConfig, validateClassificationConfig, createDefaultConfig } from "../configuration.ts";
import { cleanPositive, resolveLayeredValue, resolveEffectiveRefs, applyEffectiveRefs } from "../configuration-resolver.ts";
import type { RawTelemetryPayload, ClassificationConfig, FlowheadConfig, VfdConfig, OutputMode } from "../models.ts";

// ============================================================
// parseNumeric tests
// ============================================================
describe("parseNumeric", () => {
  const cases: [unknown, number | null, string][] = [
    ["0", 0, "string zero"],
    ["0.00", 0, "string zero with decimals"],
    ["38.0", 38.0, "string float"],
    ["46.1", 46.1, "string float one decimal"],
    ["-5.5", -5.5, "negative string"],
    [0, 0, "number zero"],
    [38.0, 38.0, "number float"],
    [-5.5, -5.5, "negative number"],
    [null, null, "null"],
    [undefined, null, "undefined"],
    ["", null, "empty string"],
    ["abc", null, "non-numeric string"],
    ["0x10", null, "hex string (not parsed)"],
    [NaN, null, "NaN"],
    [Infinity, null, "Infinity"],
    [-Infinity, null, "-Infinity"],
  ];

  for (const [input, expected, desc] of cases) {
    test(`parseNumeric(${JSON.stringify(input)}) -> ${expected} (${desc})`, () => {
      assert.equal(parseNumeric(input), expected);
    });
  }
});

// ============================================================
// parseBoolean tests
// ============================================================
describe("parseBoolean", () => {
  const cases: [unknown, boolean | null, string][] = [
    ["true", true, "string true"],
    ["false", false, "string false"],
    ["TRUE", true, "string TRUE"],
    ["FALSE", false, "string FALSE"],
    ["True", true, "string True"],
    ["False", false, "string False"],
    [true, true, "boolean true"],
    [false, false, "boolean false"],
    [null, null, "null"],
    [undefined, null, "undefined"],
    ["", null, "empty string"],
    ["yes", null, "non-boolean string"],
  ];

  for (const [input, expected, desc] of cases) {
    test(`parseBoolean(${JSON.stringify(input)}) -> ${expected} (${desc})`, () => {
      assert.equal(parseBoolean(input), expected);
    });
  }
});

// ============================================================
// parseTimestamp tests
// ============================================================
describe("parseTimestamp", () => {
  test("valid timestamp string -> ZonedTimestamp (UTC)", () => {
    const result = parseTimestamp("2026-01-15 10:30:45");
    assert.ok(result !== null);
    assert.equal(result?.offsetMinutes, 0);
    assert.equal(result?.frac, "");
    assert.equal(result?.epochMs, Date.UTC(2026, 0, 15, 10, 30, 45));
  });

  test("valid timestamp with T separator", () => {
    const result = parseTimestamp("2026-01-15T10:30:45");
    assert.ok(result !== null);
    assert.equal(result?.epochMs, Date.UTC(2026, 0, 15, 10, 30, 45));
  });

  test("valid timestamp with fractional seconds", () => {
    const result = parseTimestamp("2026-01-15 10:30:45.123");
    assert.ok(result !== null);
    assert.equal(result?.frac, ".123");
  });

  test("invalid timestamp -> null", () => {
    assert.equal(parseTimestamp("invalid"), null);
    assert.equal(parseTimestamp("2026/01/15"), null);
    assert.equal(parseTimestamp(""), null);
    assert.equal(parseTimestamp(null), null);
    assert.equal(parseTimestamp(123), null);
  });
});

// ============================================================
// validateEnvelope tests
// ============================================================
describe("validateEnvelope", () => {
  test("valid envelope -> null (no error)", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "123",
      received_at: "2026-01-15 10:30:45",
      data: { output_frequency: "38.0" },
    };
    assert.equal(validateEnvelope(raw), null);
  });

  test("missing pump_id -> error", () => {
    const raw = { received_at: "2026-01-15 10:30:45", data: {} } as RawTelemetryPayload;
    assert.equal(validateEnvelope(raw), "missing pump_id");
  });

  test("missing received_at -> error", () => {
    const raw = { pump_id: "123", data: {} } as RawTelemetryPayload;
    assert.equal(validateEnvelope(raw), "missing received_at");
  });

  test("missing data -> error", () => {
    const raw = { pump_id: "123", received_at: "2026-01-15 10:30:45" } as RawTelemetryPayload;
    assert.equal(validateEnvelope(raw), "missing data envelope");
  });
});

// ============================================================
// normalizeTelemetry tests
// ============================================================
describe("normalizeTelemetry", () => {
  test("maps numeric fields correctly", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "123",
      flowhead: 3000,
      flowhead_id: 2,
      vsdTypeId: 1,
      received_at: "2026-01-15 10:30:45",
      data: {
        output_frequency: "38.0",
        motor_current: "517.0",
        output_power: "250.0",
        motor_torque: "95.0",
        motor_speed: "950",
        arus_rms_u: "100",
        arus_rms_v: "100",
        arus_rms_w: "110",
        input_voltage: "380",
        ambient_temperature: "30",
        control_board_temperature: "40",
        inverter_temperature: "45",
      },
    };

    const canonical = normalizeTelemetry(raw);
    assert.equal(canonical.pumpId, "123");
    assert.equal(canonical.flowhead, 3000);
    assert.equal(canonical.flowheadId, 2);
    assert.equal(canonical.vsdTypeId, 1);
    assert.equal(canonical.frequencyHz, 38.0);
    assert.equal(canonical.currentA, 517.0);
    assert.equal(canonical.powerKw, 250.0);
    assert.equal(canonical.torquePercent, 95.0);
    assert.equal(canonical.motorSpeedRpm, 950);
    assert.equal(canonical.phaseCurrentU, 100);
    assert.equal(canonical.phaseCurrentV, 100);
    assert.equal(canonical.phaseCurrentW, 110);
    assert.equal(canonical.inputVoltageV, 380);
    assert.equal(canonical.ambientTemperatureC, 30);
    assert.equal(canonical.controlBoardTemperatureC, 40);
    assert.equal(canonical.inverterTemperatureC, 45);
  });

  test("null values remain null (no zero-fill)", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "123",
      received_at: "2026-01-15 10:30:45",
      data: {
        output_frequency: null,
        motor_current: "",
        output_power: "abc",
      },
    };

    const canonical = normalizeTelemetry(raw);
    assert.equal(canonical.frequencyHz, null);
    assert.equal(canonical.currentA, null);
    assert.equal(canonical.powerKw, null);
  });

  test("numeric string zero -> 0 (not null)", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "123",
      received_at: "2026-01-15 10:30:45",
      data: { output_frequency: "0", output_power: "0.00" },
    };

    const canonical = normalizeTelemetry(raw);
    assert.equal(canonical.frequencyHz, 0);
    assert.equal(canonical.powerKw, 0);
  });

  test("timestamp parsing", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "123",
      received_at: "2026-01-15 10:30:45",
      data: {},
    };

    const canonical = normalizeTelemetry(raw);
    assert.equal(canonical.receivedAt.epochMs, Date.UTC(2026, 0, 15, 10, 30, 45));
    assert.equal(canonical.receivedAt.offsetMinutes, 0);
  });

  test("invalid timestamp -> current time fallback", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "123",
      received_at: "invalid",
      data: {},
    };

    const canonical = normalizeTelemetry(raw);
    assert.ok(canonical.receivedAt.epochMs > 0);
  });
});

// ============================================================
// extractIdentity tests
// ============================================================
describe("extractIdentity", () => {
  test("extracts identity from canonical telemetry", () => {
    const canonical = {
      pumpId: "123",
      receivedAt: { epochMs: 123, offsetMinutes: 0, frac: "" },
      flowhead: 3000,
      flowheadId: 2,
      vsdTypeId: 1,
      frequencyHz: null, currentA: null, powerKw: null, torquePercent: null,
      motorSpeedRpm: null, phaseCurrentU: null, phaseCurrentV: null, phaseCurrentW: null,
      inputVoltageV: null, ambientTemperatureC: null, controlBoardTemperatureC: null,
      inverterTemperatureC: null, motorEstimatedTemperatureC: null, outputVoltageV: null,
      fluxActual: null, hoursRun: null,
    };

    const identity = extractIdentity(canonical);
    assert.equal(identity.pumpId, "123");
    assert.equal(identity.flowhead, 3000);
    assert.equal(identity.flowheadId, 2);
    assert.equal(identity.vsdTypeId, 1);
  });
});

// ============================================================
// Configuration validation tests
// ============================================================
describe("Configuration Validation", () => {
  test("createDefaultConfig produces valid config", () => {
    const config = createDefaultConfig();
    const result = validateClassificationConfig(config);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test("validateFlowheadConfig catches missing required fields", () => {
    const config: FlowheadConfig = {
      powerRefKw: null, currentRefA: null, frequencySetpointHz: null,
      rpmSetpoint: null, torqueSetpointPct: null,
      ptsFrequencyHz: null, ptsPowerRefKw: null, ptsCurrentRefA: null,
      ptsTorqueRefPct: null, ptsRpmRef: null,
      turbulensiPowerRefKw: null, turbulensiTorqueRefPct: null,
      turbulensiCurrentDevThresholdA: null, turbulensiWindow: null,
      banyakSampahPowerRefKw: null, banyakSampahCurrentRefA: null, banyakSampahTorqueRefPct: null,
      dryRunPowerFactor: null, dryRunCurrentFactor: null, dryRunTorqueThresholdPct: null,
    };
    const errors = validateFlowheadConfig(config);
    assert.ok(errors.length > 0);
    assert.ok(errors.some(e => e.includes("ptsFrequencyHz")));
  });

  test("validateFlowheadConfig catches non-positive values", () => {
    const config = createDefaultConfig();
    config.flowhead.ptsPowerRefKw = -5;
    const errors = validateFlowheadConfig(config.flowhead);
    assert.ok(errors.some(e => e.includes("ptsPowerRefKw") && e.includes("positive finite")));
  });

  test("validateVfdConfig catches missing fields", () => {
    const config: VfdConfig = {
      unbalanceThresholdPct: null,
      undervoltageThresholdV: null,
      overvoltageThresholdV: null,
      panelOverheatThresholdC: null,
    };
    const errors = validateVfdConfig(config);
    assert.ok(errors.length >= 4);
  });

  test("validateVfdConfig checks voltage ordering", () => {
    const config = createDefaultConfig();
    config.vfd.undervoltageThresholdV = 400;
    config.vfd.overvoltageThresholdV = 380;
    const errors = validateVfdConfig(config.vfd);
    assert.ok(errors.some(e => e.includes("undervoltageThresholdV") && e.includes("overvoltageThresholdV")));
  });

  test("validateRuntimeConfig validates stagnationLimit and outputMode", () => {
    const errors1 = validateRuntimeConfig({ stagnationLimit: 0, outputMode: "poc" });
    assert.ok(errors1.some(e => e.includes("stagnationLimit")));

    const errors2 = validateRuntimeConfig({ stagnationLimit: 5, outputMode: "invalid" as OutputMode });
    assert.ok(errors2.some(e => e.includes("outputMode")));
  });

  test("validateClassificationConfig integrates all validations", () => {
    const config = createDefaultConfig();
    const result = validateClassificationConfig(config);
    assert.equal(result.valid, true);

    // Break something
    config.flowhead.ptsPowerRefKw = -1;
    const result2 = validateClassificationConfig(config);
    assert.equal(result2.valid, false);
    assert.ok(result2.errors.length > 0);
  });
});

// ============================================================
// Configuration resolver tests
// ============================================================
describe("Configuration Resolver", () => {
  describe("cleanPositive", () => {
    const cases: [unknown, number | null, string][] = [
      [42, 42, "positive number"],
      ["42.5", 42.5, "positive numeric string"],
      [0, null, "zero"],
      [-5, null, "negative"],
      [null, null, "null"],
      [undefined, null, "undefined"],
      [NaN, null, "NaN"],
      [Infinity, null, "Infinity"],
      ["abc", null, "non-numeric string"],
    ];

    for (const [input, expected, desc] of cases) {
      test(`cleanPositive(${JSON.stringify(input)}) -> ${expected} (${desc})`, () => {
        assert.equal(cleanPositive(input), expected);
      });
    }
  });

  describe("resolveLayeredValue", () => {
    test("override wins", () => {
      assert.equal(resolveLayeredValue(100, 200, 300), 100);
    });

    test("flowhead wins when override null", () => {
      assert.equal(resolveLayeredValue(null, 200, 300), 200);
    });

    test("profile wins when override and flowhead null", () => {
      assert.equal(resolveLayeredValue(null, null, 300), 300);
    });

    test("all null -> null", () => {
      assert.equal(resolveLayeredValue(null, null, null), null);
    });

    test("invalid override skipped", () => {
      assert.equal(resolveLayeredValue(-5, 200, 300), 200);
    });
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
      assert.equal(result.rules?.TEST_RULE?.conditions?.[0]?.value, 500);
      assert.equal(result.rules?.TEST_RULE?.conditions?.[1]?.value, 600);
      assert.equal(result.rules?.TEST_RULE?.conditions?.[2]?.value, 30);
    });

    test("does not mutate original", () => {
      const tierRules = { rules: { TEST: { conditions: [{ field: "output_power", value: 100 }] } } };
      const refs = { power_kw: 500, current_a: null };
      applyEffectiveRefs(tierRules, refs);
      assert.equal(tierRules.rules?.TEST?.conditions?.[0]?.value, 100);
    });

    test("null ref leaves condition unchanged", () => {
      const tierRules = { rules: { TEST: { conditions: [{ field: "output_power", value: 100 }] } } };
      const refs = { power_kw: null, current_a: null };
      const result = applyEffectiveRefs(tierRules, refs);
      assert.equal(result.rules?.TEST?.conditions?.[0]?.value, 100);
    });
  });
});

// ============================================================
// Integration: Telemetry -> Identity -> Config
// ============================================================
describe("Integration: Telemetry -> Identity -> Config", () => {
  test("full pipeline: raw payload -> canonical -> identity -> config", () => {
    const raw: RawTelemetryPayload = {
      pump_id: "3000",
      flowhead: 3000,
      flowhead_id: 2,
      vsdTypeId: 1,
      received_at: "2026-01-15 10:30:45",
      data: {
        output_frequency: "38.0",
        motor_current: "517.0",
        output_power: "250.0",
        motor_torque: "95.0",
        motor_speed: "950",
        arus_rms_u: "100",
        arus_rms_v: "100",
        arus_rms_w: "100",
        input_voltage: "380",
        ambient_temperature: "30",
        control_board_temperature: "40",
        inverter_temperature: "45",
      },
    };

    const canonical = normalizeTelemetry(raw);
    assert.equal(canonical.pumpId, "3000");
    assert.equal(canonical.frequencyHz, 38.0);

    const identity = extractIdentity(canonical);
    assert.equal(identity.pumpId, "3000");
    assert.equal(identity.flowhead, 3000);
    assert.equal(identity.flowheadId, 2);
    assert.equal(identity.vsdTypeId, 1);

    const config = createDefaultConfig();
    const validation = validateClassificationConfig(config);
    assert.equal(validation.valid, true);
  });
});