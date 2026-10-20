/**
 * Domain models — 1:1 port of ``app/classification/models.py``.
 *
 * TroubleType is a plain const map (not a TS enum) so the source stays
 * erasable-syntax-only and runnable by Node's native TypeScript stripping.
 */

import type { ZonedTimestamp } from "../util/timestamp.ts";

export class UnsupportedPumpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPumpConfigurationError";
  }
}

export const TroubleType = {
  POMPA_TERSANGKUT_SAMPAH: "pompa_tersangkut_sampah",
  TURBULENSI: "turbulensi",
  BANYAK_SAMPAH: "banyak_sampah",
  UNBALANCE: "unbalance",
  UNDERVOLTAGE: "undervoltage",
  OVERVOLTAGE: "overvoltage",
  DRY_RUN: "dry_run",
  PANEL_OVERHEAT: "panel_overheat",
  NORMAL: "normal",
} as const;

export type TroubleType = (typeof TroubleType)[keyof typeof TroubleType];

/**
 * Maps a JSON rule name to its TroubleType, mirroring ``TroubleType[name]``.
 * ``LOW_WATER_MENYALA`` is the legacy alias for ``dry_run``.
 */
export const RuleNameToTroubleType: Record<string, TroubleType> = {
  POMPA_TERSANGKUT_SAMPAH: TroubleType.POMPA_TERSANGKUT_SAMPAH,
  TURBULENSI: TroubleType.TURBULENSI,
  BANYAK_SAMPAH: TroubleType.BANYAK_SAMPAH,
  UNBALANCE: TroubleType.UNBALANCE,
  UNDERVOLTAGE: TroubleType.UNDERVOLTAGE,
  OVERVOLTAGE: TroubleType.OVERVOLTAGE,
  DRY_RUN: TroubleType.DRY_RUN,
  PANEL_OVERHEAT: TroubleType.PANEL_OVERHEAT,
  LOW_WATER_MENYALA: TroubleType.DRY_RUN,
  NORMAL: TroubleType.NORMAL,
};

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

export interface PumpConfig {
  pump_id: number;
  capacity_lps: number;
  flowhead_id?: number | null;
}

export interface OperatingSetpoint {
  frequency?: number | null;
  rpm?: number | null;
  torque?: number | null;
}

export interface MatchedRule {
  trouble_type: TroubleType;
  matched_conditions: string[];
  total_conditions: number;
}

export type RuleCapabilityStatus = "READY" | "SKIPPED" | "UNSUPPORTED";
export type RuleMatchStatus = "MATCH" | "NO_MATCH";
export type ClassificationEvaluationStatus =
  | "FULL"
  | "PARTIAL"
  | "INSUFFICIENT_DATA";

export interface RuleEvaluation {
  trouble_type: TroubleType;
  capability_status: RuleCapabilityStatus;
  evaluation: RuleMatchStatus | null;
  missing_requirements: string[];
  matched_conditions: string[];
  total_conditions: number;
}

export interface ClassificationResult {
  pump_id: number;
  timestamp: ZonedTimestamp;
  trouble_type: TroubleType;
  matched_rules: MatchedRule[];
  sensor_snapshot: Record<string, number>;
  readings_count: number;
  limitations: string[];
  evaluation_status: ClassificationEvaluationStatus;
  rule_evaluations: RuleEvaluation[];
}
