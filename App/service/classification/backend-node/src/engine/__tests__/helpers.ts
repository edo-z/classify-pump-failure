/** Shared test fixtures for characterization tests — inside engine scope only. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ZonedTimestamp } from "../../util/timestamp.ts";
import type { RawTelemetryPayload } from "../models.ts";
import type { IsPumpOffFn } from "../models.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RULES_PATH = join(__dirname, "..", "rules.json");

/** Legacy SensorReading for test fixtures (snake_case fields, matches legacy data format). */
export interface SensorReading {
  timestamp: ZonedTimestamp;
  motor_speed: number | null;
  output_frequency: number | null;
  motor_current: number | null;
  motor_torque: number | null;
  output_power: number | null;
  hours_run: number | null;
  output_voltage: number | null;
  ambient_temperature: number | null;
  control_board_temperature: number | null;
  inverter_temperature: number | null;
  input_voltage: number | null;
  flux_actual: number | null;
  motor_estimated_temperature: number | null;
  arus_rms_u: number | null;
  arus_rms_v: number | null;
  arus_rms_w: number | null;
}

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

export const PUMP_CONFIGS = {
  "500_lps": { pump_id: 500, capacity_lps: 500, flowhead_id: 1 },
  "3000_lps": { pump_id: 3000, capacity_lps: 3000, flowhead_id: 2 },
  "5000_lps": { pump_id: 5000, capacity_lps: 5000, flowhead_id: 3 },
} as const;

export const SETPOINTS = {
  "500_lps": { frequency: 46.1, rpm: 900, torque: 70 },
  "3000_lps": { frequency: 38.0, rpm: 950, torque: 80 },
  "5000_lps": { frequency: 40.0, rpm: 990, torque: 90 },
} as const;

export function getProfileCapacity(flowhead: string): number {
  const match = flowhead.match(/^(\d+)_lps$/);
  if (!match) throw new Error(`Invalid flowhead format: ${flowhead}`);
  return parseInt(match[1], 10);
}

export function resolveEffectiveSetpoint(flowhead: string): { frequency: number; rpm: number; torque: number } {
  const sp = SETPOINTS[flowhead as keyof typeof SETPOINTS];
  if (!sp) throw new Error(`Unknown flowhead: ${flowhead}`);
  return sp;
}

export function tierRefs(tier: keyof typeof SETPOINTS) {
  const rules = JSON.parse(readFileSync(RULES_PATH, "utf-8"));
  const cap = PUMP_CONFIGS[tier].capacity_lps;
  const tierRules = rules.tiers[String(cap)]?.rules ?? {};
  const pompa = tierRules.POMPA_TERSANGKUT_SAMPAH?.conditions ?? [];
  const turb = tierRules.TURBULENSI?.conditions ?? [];
  const dry = tierRules.DRY_RUN?.conditions ?? [];

  const kwRef = Number(pompa.find((c: any) => c.field === "output_power")?.value ?? 0);
  const ampRef = Number(pompa.find((c: any) => c.field === "motor_current")?.value ?? 0);
  const tKw = Number(turb.find((c: any) => String(c.note ?? "").startsWith("T_KW"))?.value ?? 0);

  return {
    capacity: cap,
    spFreq: SETPOINTS[tier].frequency,
    kwRef,
    ampRef,
    drKw: Number((kwRef * 0.667).toFixed(3)),
    drAmp: Number((ampRef * 0.64).toFixed(2)),
    tKw,
    tWindow: 30,
    tThreshold: 10.0,
  };
}

/** Convert legacy SensorReading to new RawTelemetryPayload data field. */
export function readingToPayloadData(r: SensorReading): Record<string, unknown> {
  return {
    motor_speed: r.motor_speed,
    output_frequency: r.output_frequency,
    motor_current: r.motor_current,
    motor_torque: r.motor_torque,
    output_power: r.output_power,
    hours_run: r.hours_run,
    output_voltage: r.output_voltage,
    ambient_temperature: r.ambient_temperature,
    control_board_temperature: r.control_board_temperature,
    inverter_temperature: r.inverter_temperature,
    input_voltage: r.input_voltage,
    flux_actual: r.flux_actual,
    motor_estimated_temperature: r.motor_estimated_temperature,
    arus_rms_u: r.arus_rms_u,
    arus_rms_v: r.arus_rms_v,
    arus_rms_w: r.arus_rms_w,
  };
}

/** Build new RawTelemetryPayload from legacy test format. */
export function buildPayload(
  readings: SensorReading[],
  pumpConfig: { pump_id: number; capacity_lps: number; flowhead_id?: number | null },
  setpoint: { frequency: number; rpm: number; torque: number },
  namespace: string,
  receivedAtMs?: number
): RawTelemetryPayload {
  const tsMs = receivedAtMs ?? BASE_TS_MS;
  // Use first reading's timestamp as received_at
  const receivedAt = new Date(tsMs).toISOString().replace("T", " ").slice(0, 19);
  return {
    pump_id: pumpConfig.pump_id,
    flowhead: pumpConfig.capacity_lps,
    flowhead_id: pumpConfig.flowhead_id ?? null,
    vsdTypeId: 2, // Default VSD type
    received_at: receivedAt,
    data: readingToPayloadData(readings[0]),
  };
}

/** Build RawTelemetryPayload for a sequence of readings (uses last reading's data, first timestamp). */
export function buildPayloadFromSeries(
  readings: SensorReading[],
  pumpConfig: { pump_id: number; capacity_lps: number; flowhead_id?: number | null },
  setpoint: { frequency: number; rpm: number; torque: number },
  namespace: string
): RawTelemetryPayload {
  const receivedAt = new Date(readings[0].timestamp.epochMs).toISOString().replace("T", " ").slice(0, 19);
  return {
    pump_id: pumpConfig.pump_id,
    flowhead: pumpConfig.capacity_lps,
    flowhead_id: pumpConfig.flowhead_id ?? null,
    vsdTypeId: 2,
    received_at: receivedAt,
    data: readingToPayloadData(readings[readings.length - 1]),
  };
}

/** Mock isPumpOff for testing - always returns false (pump is running). */
export const mockIsPumpOff: IsPumpOffFn = () => false;

/** Create a test ClassificationEngine with mock isPumpOff. */
import { ClassificationEngine, RULES_FILE } from "../engine.ts";
export function createTestEngine(): ClassificationEngine {
  return new ClassificationEngine(RULES_FILE, { 
    outputMode: "poc",
    isPumpOff: mockIsPumpOff
  });
}