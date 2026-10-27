/**
 * Fixture converter: Legacy frozen.json request -> New ClassificationEngine API sequence.
 * 
 * Legacy format: { flowhead: "5000_lps", pump_id: "diff-0", readings: [...], setpoint_freq: number }
 * New format: Sequence of RawTelemetryPayload (one per reading) with incrementing timestamps.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RawTelemetryPayload } from "../../models.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FROZEN_PATH = join(__dirname, "..", "..", "..", "..", "test", "differential", "frozen.json");

export interface LegacyRequest {
  flowhead: string;
  pump_id: string;
  readings: LegacyReading[];
  setpoint_freq?: number;
}

export interface LegacyReading {
  timestamp: string; // ISO with timezone offset
  motor_speed: number | null;
  output_frequency: number | null;
  motor_current: number | null;
  motor_torque: number | null;
  output_power: number | null;
  input_voltage: number | null;
  ambient_temperature: number | null;
  control_board_temperature: number | null;
  inverter_temperature: number | null;
  arus_rms_u: number | null;
  arus_rms_v: number | null;
  arus_rms_w: number | null;
}

export interface LegacyResponse {
  flowhead: string;
  pump_id: string;
  evidence_size: number;
  classification: LegacyClassification;
}

export interface LegacyClassification {
  pump_id: number;
  timestamp: string;
  trouble_type: string;
  matched_rules: Array<{ trouble_type: string; conditions: string[] }>;
  sensor_snapshot: Record<string, number>;
  readings_count: number;
  limitations: string[];
  evaluation_status: "FULL" | "PARTIAL" | "INSUFFICIENT_DATA";
  rule_evaluations: LegacyRuleEvaluation[];
}

export interface LegacyRuleEvaluation {
  trouble_type: string;
  capability_status: "READY" | "SKIPPED" | "UNSUPPORTED";
  evaluation: "MATCH" | "NO_MATCH" | null;
  missing_requirements: string[];
  matched_conditions: string[];
  total_conditions: number;
}

export interface FrozenCase {
  request: LegacyRequest;
  status: number;
  body: LegacyResponse;
}

export interface ConvertedCase {
  caseIndex: number;
  legacyRequest: LegacyRequest;
  legacyResponse: LegacyResponse;
  payloads: RawTelemetryPayload[];
  pumpId: string;
  flowhead: number;
  flowheadId: number | null;
  vsdTypeId: number;
}

/** Parse ISO timestamp with timezone to epochMs. */
function parseTimestamp(ts: string): number {
  return new Date(ts).getTime();
}

/** Format epochMs to "YYYY-MM-DD HH:mm:ss" (no offset) for received_at. */
function formatReceivedAt(epochMs: number): string {
  const d = new Date(epochMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** Extract flowhead capacity from "5000_lps" -> 5000. */
function parseFlowheadCapacity(flowhead: string): number {
  const match = flowhead.match(/^(\d+)_lps$/);
  if (!match) throw new Error(`Invalid flowhead format: ${flowhead}`);
  return parseInt(match[1], 10);
}

/** Extract flowhead_id from flowhead string (assume 1, 2, 3 for 500, 3000, 5000). */
function parseFlowheadId(flowhead: string): number | null {
  const capacity = parseFlowheadCapacity(flowhead);
  const map: Record<number, number> = { 500: 1, 3000: 2, 5000: 3 };
  return map[capacity] ?? null;
}

/** Convert a single legacy reading to new RawTelemetryPayload data field. */
function readingToPayloadData(reading: LegacyReading): Record<string, unknown> {
  return {
    motor_speed: reading.motor_speed,
    output_frequency: reading.output_frequency,
    motor_current: reading.motor_current,
    motor_torque: reading.motor_torque,
    output_power: reading.output_power,
    input_voltage: reading.input_voltage,
    ambient_temperature: reading.ambient_temperature,
    control_board_temperature: reading.control_board_temperature,
    inverter_temperature: reading.inverter_temperature,
    arus_rms_u: reading.arus_rms_u,
    arus_rms_v: reading.arus_rms_v,
    arus_rms_w: reading.arus_rms_w,
  };
}

/** Convert legacy frozen case to new API payload sequence. */
export function convertFrozenCase(frozenCase: FrozenCase, caseIndex: number): ConvertedCase {
  const { request, body } = frozenCase;
  const pumpId = request.pump_id;
  const flowhead = parseFlowheadCapacity(request.flowhead);
  const flowheadId = parseFlowheadId(request.flowhead);
  const vsdTypeId = 2; // Default VSD type

  // Convert each reading to a separate payload with its own timestamp
  const payloads: RawTelemetryPayload[] = request.readings.map((reading, idx) => {
    const epochMs = parseTimestamp(reading.timestamp);
    const receivedAt = formatReceivedAt(epochMs);

    return {
      pump_id: pumpId,
      flowhead,
      flowhead_id: flowheadId,
      vsdTypeId,
      received_at: receivedAt,
      data: readingToPayloadData(reading),
    };
  });

  return {
    caseIndex,
    legacyRequest: request,
    legacyResponse: body,
    payloads,
    pumpId,
    flowhead,
    flowheadId,
    vsdTypeId,
  };
}

/** Load all frozen cases and convert them. */
export function loadConvertedCases(): ConvertedCase[] {
  const raw = readFileSync(FROZEN_PATH, "utf-8");
  const frozenCases: FrozenCase[] = JSON.parse(raw);
  return frozenCases.map((fc, i) => convertFrozenCase(fc, i));
}

/** Get a single converted case by index. */
export function getConvertedCase(index: number): ConvertedCase {
  const cases = loadConvertedCases();
  if (index < 0 || index >= cases.length) {
    throw new Error(`Case index ${index} out of range (0-${cases.length - 1})`);
  }
  return cases[index];
}