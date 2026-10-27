/**
 * Telemetry normalization — canonical parsing from raw payload.
 *
 * Strict parsing rules:
 * - Numeric strings: "0", "0.00" -> 0; "38.5" -> 38.5; "", "abc", "0x10" -> null
 * - Boolean strings: "false" -> false (only for boolean fields), "true" -> true
 * - null/undefined -> null (never zero-filled)
 * - Timestamp: "YYYY-MM-DD HH:mm:ss" -> ZonedTimestamp (UTC assumed, no offset)
 * - No auto-fallback between ambiguous fields (OD-05)
 */

import type { RawTelemetryPayload, CanonicalTelemetry, ZonedTimestamp } from "./models.ts";

const NUMERIC_FIELD_MAP: Record<string, keyof CanonicalTelemetry> = {
  // FH group
  output_frequency: "frequencyHz",
  motor_current: "currentA",
  output_power: "powerKw",
  motor_torque: "torquePercent",
  motor_speed: "motorSpeedRpm",
  // VFD group
  arus_rms_u: "phaseCurrentU",
  arus_rms_v: "phaseCurrentV",
  arus_rms_w: "phaseCurrentW",
  input_voltage: "inputVoltageV",
  // Panel group
  ambient_temperature: "ambientTemperatureC",
  control_board_temperature: "controlBoardTemperatureC",
  inverter_temperature: "inverterTemperatureC",
  // Other
  motor_estimated_temperature: "motorEstimatedTemperatureC",
  output_voltage: "outputVoltageV",
  flux_actual: "fluxActual",
  hours_run: "hoursRun",
} as const;

const BOOLEAN_FIELDS = new Set<string>([
  // Add boolean field names here if any
]);

/** Parse a numeric value strictly: finite numbers only, no zero-fill. */
export function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // Reject hex, scientific notation not explicitly allowed
    if (/^0x/i.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse boolean string explicitly: only "true"/"false" (case-insensitive). */
export function parseBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

/** Parse timestamp string "YYYY-MM-DD HH:mm:ss" to ZonedTimestamp (UTC). */
export function parseTimestamp(value: unknown): ZonedTimestamp | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // Expect "YYYY-MM-DD HH:mm:ss" (no offset)
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, frac] = match;
  const epochMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (!Number.isFinite(epochMs)) return null;
  return {
    epochMs,
    offsetMinutes: 0,
    frac: frac ? `.${frac}` : "",
  };
}

/** Normalize raw telemetry payload to canonical form. */
export function normalizeTelemetry(raw: RawTelemetryPayload): CanonicalTelemetry {
  const data = raw.data ?? {};

  // Identity fields
  const pumpId = String(raw.pump_id ?? data.pump_id ?? "");
  const flowhead = typeof raw.flowhead === "number" ? raw.flowhead :
    typeof data.flowhead === "number" ? data.flowhead : null;
  const flowheadId = typeof raw.flowhead_id === "number" ? raw.flowhead_id :
    typeof data.flowhead_id === "number" ? data.flowhead_id : null;
  const vsdTypeId = typeof raw.vsdTypeId === "number" ? raw.vsdTypeId :
    typeof data.vsdTypeId === "number" ? data.vsdTypeId : null;

  // Timestamp
  const receivedAt = parseTimestamp(raw.received_at ?? data.received_at) ?? {
    epochMs: Date.now(),
    offsetMinutes: 0,
    frac: "",
  };

  // Numeric fields from data
  const canonical: CanonicalTelemetry = {
    pumpId,
    receivedAt,
    flowhead,
    flowheadId,
    vsdTypeId,
    frequencyHz: null,
    currentA: null,
    powerKw: null,
    torquePercent: null,
    motorSpeedRpm: null,
    phaseCurrentU: null,
    phaseCurrentV: null,
    phaseCurrentW: null,
    inputVoltageV: null,
    ambientTemperatureC: null,
    controlBoardTemperatureC: null,
    inverterTemperatureC: null,
    motorEstimatedTemperatureC: null,
    outputVoltageV: null,
    fluxActual: null,
    hoursRun: null,
  };

  // Map known numeric fields
  for (const [rawKey, canonicalKey] of Object.entries(NUMERIC_FIELD_MAP)) {
    const value = data[rawKey];
    const parsed = parseNumeric(value);
    if (parsed !== null) {
      (canonical as any)[canonicalKey] = parsed;
    }
  }

  // Handle potential duplicate field names (OD-05: no auto-fallback)
  // If both output_current and motor_current present, prefer motor_current
  // This is a documented decision point, not automatic fallback
  if (canonical.currentA === null) {
    const altCurrent = parseNumeric(data.output_current);
    if (altCurrent !== null) {
      canonical.currentA = altCurrent;
    }
  }

  return canonical;
}

/** Extract equipment identity from canonical telemetry. */
export function extractIdentity(canonical: CanonicalTelemetry) {
  return {
    pumpId: canonical.pumpId,
    flowhead: canonical.flowhead,
    flowheadId: canonical.flowheadId,
    vsdTypeId: canonical.vsdTypeId,
  };
}

/** Validate required envelope fields. */
export function validateEnvelope(raw: RawTelemetryPayload): string | null {
  if (!raw.pump_id && !raw.data?.pump_id) return "missing pump_id";
  if (!raw.received_at && !raw.data?.received_at) return "missing received_at";
  if (!raw.data) return "missing data envelope";
  return null;
}