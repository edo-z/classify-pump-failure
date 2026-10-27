/**
 * Legacy aggregate readings — returns last reading's non-null numeric fields.
 * Used for test characterization of legacy behavior.
 * New engine uses direct field access from canonical telemetry.
 */

import type { SensorReading } from "../models.ts";

const NUMERIC_FIELDS: (keyof SensorReading)[] = [
  "output_frequency",
  "output_power",
  "motor_current",
  "motor_torque",
  "motor_speed",
  "ambient_temperature",
  "control_board_temperature",
  "inverter_temperature",
  "input_voltage",
  "flux_actual",
  "motor_estimated_temperature",
  "output_voltage",
  "hours_run",
];

export function aggregateReadings(
  readings: SensorReading[],
): Record<string, number> {
  if (readings.length === 0) return {};
  const last = readings[readings.length - 1] as SensorReading;
  const agg: Record<string, number> = {};
  for (const field of NUMERIC_FIELDS) {
    const value = last[field];
    if (value !== null && value !== undefined) {
      agg[field] = value as number;
    }
  }
  return agg;
}