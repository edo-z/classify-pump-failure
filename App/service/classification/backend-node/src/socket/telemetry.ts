import type { SensorReading } from "../engine/models.ts";
import { parseIso } from "../util/timestamp.ts";

export interface PumpTelemetryEvent {
  pump_id: string;
  reading: SensorReading;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function normalizePumpId(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(" ", "T");

  if (!normalized) {
    return null;
  }

  // Pertahankan timezone jika sudah disediakan API.
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);

  // Asumsi timestamp DEX adalah WIB.
  const offset = process.env.DEX_TIMESTAMP_OFFSET ?? "+07:00";

  const iso = hasTimezone
    ? normalized
    : `${normalized}${offset}`;

  return parseIso(iso);
}

export function normalizePumpUpdate(
  payload: unknown,
): PumpTelemetryEvent | null {
  if (!isRecord(payload)) {
    return null;
  }

  const source = payload.data;

  if (!isRecord(source)) {
    return null;
  }

  const outerPumpId = normalizePumpId(payload.pump_id);
  const innerPumpId = normalizePumpId(source.pump_id);

  // Jangan menerima payload dengan identitas pompa berbeda.
  if (
    outerPumpId !== null &&
    innerPumpId !== null &&
    outerPumpId !== innerPumpId
  ) {
    return null;
  }

  const pumpId = outerPumpId ?? innerPumpId;

  if (pumpId === null) {
    return null;
  }

  const timestamp = normalizeTimestamp(source.received_at);

  if (timestamp === null) {
    return null;
  }

  const reading: SensorReading = {
    timestamp,

    motor_speed: numberOrNull(source.motor_speed),
    output_frequency: numberOrNull(source.output_frequency),
    motor_current: numberOrNull(source.motor_current),
    motor_torque: numberOrNull(source.motor_torque),
    output_power: numberOrNull(source.output_power),
    hours_run: numberOrNull(source.hours_run),
    output_voltage: numberOrNull(source.output_voltage),

    ambient_temperature: numberOrNull(
      source.ambient_temperature,
    ),

    control_board_temperature: numberOrNull(
      source.control_board_temperature,
    ),

    inverter_temperature: numberOrNull(
      source.inverter_temperature,
    ),

    input_voltage: numberOrNull(source.input_voltage),
    flux_actual: numberOrNull(source.flux_actual),

    motor_estimated_temperature: numberOrNull(
      source.motor_estimated_temperature,
    ),

    arus_rms_u: numberOrNull(source.arus_rms_u),
    arus_rms_v: numberOrNull(source.arus_rms_v),
    arus_rms_w: numberOrNull(source.arus_rms_w),
  };

  return {
    pump_id: pumpId,
    reading,
  };
}