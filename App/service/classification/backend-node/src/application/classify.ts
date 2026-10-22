import {
  EVIDENCE_MAXLEN,
  LIVE_GAP_THRESHOLD_MS,
  buildTrailingEvidence,
} from "../engine/evidence.ts";
import type { ClassificationResult, SensorReading } from "../engine/models.ts";
import { getProfileCapacity, ProfileNotFoundError } from "../engine/profiles.ts";
import { getEngine } from "../engine/service.ts";
import { resolveEffectiveSetpoint } from "../engine/setpoints.ts";
import { parseIso, serializeIso, type ZonedTimestamp } from "../util/timestamp.ts";
import { NotFoundError, ValidationError } from "./errors.ts";

const MAX_WINDOW_READINGS = 40;

const NUMERIC_FIELDS = [
  "motor_speed",
  "output_frequency",
  "motor_current",
  "motor_torque",
  "output_power",
  "hours_run",
  "output_voltage",
  "ambient_temperature",
  "control_board_temperature",
  "inverter_temperature",
  "input_voltage",
  "flux_actual",
  "motor_estimated_temperature",
  "arus_rms_u",
  "arus_rms_v",
  "arus_rms_w",
] as const;

const NAIVE_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

function coerceFloat(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${field}: value must be a finite number`);
    }
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new ValidationError(`${field}: value is not a valid number`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field}: field required`);
  }
  return value;
}

function parseReading(raw: unknown): SensorReading {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("readings: each item must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const tsRaw = obj.timestamp;
  if (typeof tsRaw !== "string") {
    throw new ValidationError("timestamp: field required");
  }
  let timestamp: ZonedTimestamp | null = parseIso(tsRaw);
  if (timestamp === null) {
    if (NAIVE_RE.test(tsRaw)) {
      throw new ValidationError(
        "timestamp must be timezone-aware ISO-8601 (event-time wajib zona waktu)",
      );
    }
    throw new ValidationError("timestamp: invalid datetime");
  }
  const numeric: Record<string, number | null> = {};
  for (const field of NUMERIC_FIELDS) {
    numeric[field] = coerceFloat(obj[field], field);
  }
  return {
    timestamp,
    motor_speed: numeric.motor_speed as number | null,
    output_frequency: numeric.output_frequency as number | null,
    motor_current: numeric.motor_current as number | null,
    motor_torque: numeric.motor_torque as number | null,
    output_power: numeric.output_power as number | null,
    hours_run: numeric.hours_run as number | null,
    output_voltage: numeric.output_voltage as number | null,
    ambient_temperature: numeric.ambient_temperature as number | null,
    control_board_temperature: numeric.control_board_temperature as number | null,
    inverter_temperature: numeric.inverter_temperature as number | null,
    input_voltage: numeric.input_voltage as number | null,
    flux_actual: numeric.flux_actual as number | null,
    motor_estimated_temperature: numeric.motor_estimated_temperature as number | null,
    arus_rms_u: numeric.arus_rms_u as number | null,
    arus_rms_v: numeric.arus_rms_v as number | null,
    arus_rms_w: numeric.arus_rms_w as number | null,
  };
}

export interface ClassifyResponseBody {
  flowhead: string;
  pump_id: string;
  evidence_size: number;
  classification: Record<string, unknown>;
}

function serializeClassification(cls: ClassificationResult): Record<string, unknown> {
  return {
    pump_id: cls.pump_id,
    timestamp: serializeIso(cls.timestamp),
    trouble_type: cls.trouble_type,
    matched_rules: cls.matched_rules.map((r) => ({
      trouble_type: r.trouble_type,
      matched_conditions: r.matched_conditions,
      total_conditions: r.total_conditions,
    })),
    sensor_snapshot: cls.sensor_snapshot,
    readings_count: cls.readings_count,
    limitations: cls.limitations,
    evaluation_status: cls.evaluation_status,
    rule_evaluations: cls.rule_evaluations.map((ev) => ({
      trouble_type: ev.trouble_type,
      capability_status: ev.capability_status,
      evaluation: ev.evaluation,
      missing_requirements: ev.missing_requirements,
      matched_conditions: ev.matched_conditions,
      total_conditions: ev.total_conditions,
    })),
  };
}

export function classifyRequest(rawBody: unknown): ClassifyResponseBody {
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = rawBody as Record<string, unknown>;

  const flowheadRaw = body.flowhead;
  if (flowheadRaw === undefined || flowheadRaw === null) {
    throw new ValidationError("flowhead: field required");
  }
  const profile_id = String(flowheadRaw);
  const pump_id_val = requireString(body.pump_id, "pump_id");
  if (pump_id_val.length < 1) throw new ValidationError("pump_id: too short");
  if (pump_id_val.length > 64) throw new ValidationError("pump_id: too long");
  const setpoint_freq = coerceFloat(body.setpoint_freq, "setpoint_freq");

  const rawReadings = body.readings;
  if (!Array.isArray(rawReadings)) {
    throw new ValidationError("readings: field required");
  }
  if (rawReadings.length < 1) {
    throw new ValidationError("readings: at least 1 reading required");
  }
  if (rawReadings.length > MAX_WINDOW_READINGS) {
    throw new ValidationError(`readings: at most ${MAX_WINDOW_READINGS} readings allowed`);
  }

  const readings = rawReadings.map(parseReading);
  const ordered = [...readings].sort(
    (a, b) => a.timestamp.epochMs - b.timestamp.epochMs,
  );
  const evidence = buildTrailingEvidence(
    ordered,
    ordered.length - 1,
    LIVE_GAP_THRESHOLD_MS,
    EVIDENCE_MAXLEN,
  );
  if (evidence.length === 0) {
    throw new ValidationError("No usable readings after gap trimming");
  }

  let capacity_lps: number;
  try {
    capacity_lps = getProfileCapacity(profile_id);
  } catch (exc) {
    if (exc instanceof ProfileNotFoundError) {
      throw new NotFoundError(`Unknown pump profile: ${profile_id}`);
    }
    throw exc;
  }

  const operating_setpoint = resolveEffectiveSetpoint(profile_id, setpoint_freq);
  const engine = getEngine();
  const classification = engine.classify(
    evidence,
    { pump_id: capacity_lps, capacity_lps },
    operating_setpoint,
    `site:${pump_id_val}`,
  );

  return {
    flowhead: profile_id,
    pump_id: pump_id_val,
    evidence_size: evidence.length,
    classification: serializeClassification(classification),
  };
}
