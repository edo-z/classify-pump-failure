/**
 * Single-shot classification contract — 1:1 port of ``app/api/classify.py``.
 *
 * ``POST /classify`` is the stable, single-shot, stateless contract for the
 * BE team: the server trims evidence (trailing 31 after a 10 s gap).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { EVIDENCE_MAXLEN, LIVE_GAP_THRESHOLD_MS, buildTrailingEvidence } from "../engine/evidence.ts";
import type { ClassificationResult, SensorReading } from "../engine/models.ts";
import { getProfileCapacity, ProfileNotFoundError } from "../engine/profiles.ts";
import { getEngine } from "../engine/service.ts";
import { resolveEffectiveSetpoint } from "../engine/setpoints.ts";
import { parseIso, serializeIso, type ZonedTimestamp } from "../util/timestamp.ts";

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

export class ValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

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
  profile_id: string;
  namespace: string;
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

  const profile_id = requireString(body.profile_id, "profile_id");
  const namespace = requireString(body.namespace, "namespace");
  if (namespace.length < 1) throw new ValidationError("namespace: too short");
  if (namespace.length > 64) throw new ValidationError("namespace: too long");
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
    `site:${namespace}`,
  );

  return {
    profile_id,
    namespace,
    evidence_size: evidence.length,
    classification: serializeClassification(classification),
  };
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export function registerClassifyRoutes(app: FastifyInstance): void {
  app.post("/classify", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = classifyRequest(request.body);
      return reply.code(200).send(result);
    } catch (exc) {
      if (exc instanceof NotFoundError) {
        return reply.code(404).send({ detail: exc.message });
      }
      if (exc instanceof ValidationError) {
        return reply.code(422).send({ detail: exc.message });
      }
      throw exc;
    }
  });
}
