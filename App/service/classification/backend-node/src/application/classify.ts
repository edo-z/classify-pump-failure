import { ClassificationEngine, RULES_FILE, type ClassificationOutput } from "../engine/engine.ts";
import type { RawTelemetryPayload, SensorReading } from "../engine/models.ts";
import { TroubleType } from "../engine/models.ts";
import { parseIso, serializeIso, type ZonedTimestamp } from "../util/timestamp.ts";
import { NotFoundError, ValidationError } from "./errors.ts";
import { readFile } from "node:fs/promises";

const PROFILES_FILE = new URL("../engine/pump_profiles.json", import.meta.url);

const MAX_WINDOW_READINGS = 40;

async function validateProfile(profileId: string): Promise<void> {
  try {
    const content = await readFile(PROFILES_FILE, "utf-8");
    const data = JSON.parse(content);
    const profiles = data.profiles ?? {};
    if (!profiles[profileId]) {
      throw new NotFoundError(`Unknown pump profile: ${profileId}`);
    }
  } catch (exc) {
    if (exc instanceof NotFoundError) throw exc;
    if ((exc as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Unknown pump profile: ${profileId}`);
    }
    throw exc;
  }
}

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

const isPumpOff = (raw: RawTelemetryPayload): boolean => {
  const d = raw.data ?? {};
  return (d.output_frequency === 0 || d.motor_speed === 0) &&
         (d.motor_current === 0 || d.output_power === 0);
};

const engine = new ClassificationEngine(RULES_FILE, {
  outputMode: "production",
  isPumpOff,
});

function toRawPayload(
  readings: SensorReading[],
  profileId: string,
  pumpId: string,
): RawTelemetryPayload {
  const latest = readings[readings.length - 1];
  const data: Record<string, unknown> = {};
  for (const f of NUMERIC_FIELDS) {
    data[f] = latest[f];
  }
  const flowheadNum = Number(profileId.replace("_lps", ""));
  return {
    pump_id: pumpId,
    flowhead: Number.isFinite(flowheadNum) ? flowheadNum : null,
    flowhead_id: null,
    vsdTypeId: null,
    received_at: serializeIso(latest.timestamp).replace("T", " ").split(".")[0],
    data,
  };
}

function transformOutput(
  output: ClassificationOutput,
  flowhead: string,
  pumpId: string,
  evidenceSize: number,
): ClassifyResponseBody {
  const priority = [
    TroubleType.POMPA_TERSANGKUT_SAMPAH,
    TroubleType.TURBULENSI,
    TroubleType.BANYAK_SAMPAH,
    TroubleType.DRY_RUN,
    TroubleType.UNBALANCE,
    TroubleType.OVERVOLTAGE,
    TroubleType.UNDERVOLTAGE,
    TroubleType.PANEL_OVERHEAT,
    TroubleType.NORMAL,
  ];
  const detected = output.results.find((r) => r.detected);
  const troubleType = detected?.troubleType ?? TroubleType.NORMAL;

  return {
    flowhead,
    pump_id: pumpId,
    evidence_size: evidenceSize,
    classification: {
      pump_id: output.pumpId,
      timestamp: output.receivedAt,
      trouble_type: troubleType,
      matched_rules: output.results
        .filter((r) => r.detected)
        .map((r) => ({
          trouble_type: r.troubleType,
          matched_conditions: [],
          total_conditions: 0,
        })),
      sensor_snapshot: {},
      readings_count: evidenceSize,
      limitations: output.missingData,
      evaluation_status: "completed",
      rule_evaluations: output.results.map((r) => ({
        trouble_type: r.troubleType,
        capability_status: "ready",
        evaluation: r.detected ? "triggered" : "not_triggered",
        missing_requirements: output.missingData[r.troubleType] ?? [],
        matched_conditions: [],
        total_conditions: 0,
      })),
    },
  };
}

export async function classifyRequest(rawBody: unknown): Promise<ClassifyResponseBody> {
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = rawBody as Record<string, unknown>;

  const flowheadRaw = body.flowhead;
  if (flowheadRaw === undefined || flowheadRaw === null) {
    throw new ValidationError("flowhead: field required");
  }
  const profile_id = String(flowheadRaw);
  await validateProfile(profile_id);
  const pump_id_val = requireString(body.pump_id, "pump_id");
  if (pump_id_val.length < 1) throw new ValidationError("pump_id: too short");
  if (pump_id_val.length > 64) throw new ValidationError("pump_id: too long");

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

  const rawPayload = toRawPayload(ordered, profile_id, pump_id_val);

  let output: ClassificationOutput;
  try {
    output = await engine.classify(rawPayload);
  } catch (exc) {
    if (exc instanceof Error) {
      throw new ValidationError(exc.message);
    }
    throw exc;
  }

  return transformOutput(output, profile_id, pump_id_val, ordered.length);
}