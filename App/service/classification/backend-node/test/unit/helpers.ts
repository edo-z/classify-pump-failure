/** Shared test fixtures — parity port of ``tests/conftest.py`` helpers. */

import type { SensorReading } from "../../src/engine/models.ts";
import type { ZonedTimestamp } from "../../src/util/timestamp.ts";

export const BASE_TS_MS = Date.UTC(2026, 0, 1);

export function ts(epochMs: number): ZonedTimestamp {
  return { epochMs, offsetMinutes: 0, frac: "" };
}

export function reading(
  epochMs: number,
  overrides: Partial<Omit<SensorReading, "timestamp">> = {},
): SensorReading {
  const base: SensorReading = {
    timestamp: ts(epochMs),
    motor_speed: 990.0,
    output_frequency: 35.0,
    motor_current: 850.0,
    motor_torque: 95.0,
    output_power: 405.0,
    hours_run: null,
    output_voltage: null,
    ambient_temperature: 30.0,
    control_board_temperature: 40.0,
    inverter_temperature: 45.0,
    input_voltage: 380.0,
    flux_actual: null,
    motor_estimated_temperature: null,
    arus_rms_u: 100.0,
    arus_rms_v: 100.0,
    arus_rms_w: 100.0,
  };
  return { ...base, ...overrides, timestamp: ts(epochMs) };
}

export function series1s(
  base: number,
  n: number,
  overrides: Partial<Omit<SensorReading, "timestamp">> = {},
): SensorReading[] {
  return Array.from({ length: n }, (_v, i) => reading(base + i * 1000, overrides));
}
