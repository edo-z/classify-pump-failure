/**
 * Domain models — DEXMIN Classification Engine.
 *
 * TroubleType is a plain const map (not a TS enum) so the source stays
 * erasable-syntax-only and runnable by Node's native TypeScript stripping.
 */

import type { ZonedTimestamp } from "../util/timestamp.ts";

export type { ZonedTimestamp } from "../util/timestamp.ts";

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

/** Raw telemetry payload from device/middleware (snake_case as received). */
export interface RawTelemetryPayload {
  pump_id: string | number;
  flowhead?: number | null;
  flowhead_id?: number | null;
  vsdTypeId?: number | null;
  received_at: string; // "YYYY-MM-DD HH:mm:ss" (no offset)
  data: Record<string, unknown>;
  [key: string]: unknown;
}

/** Canonical telemetry after strict parsing (camelCase, typed). */
export interface CanonicalTelemetry {
  pumpId: string;
  receivedAt: ZonedTimestamp;
  flowhead: number | null;
  flowheadId: number | null;
  vsdTypeId: number | null;
  frequencyHz: number | null;
  currentA: number | null;
  powerKw: number | null;
  torquePercent: number | null;
  motorSpeedRpm: number | null;
  phaseCurrentU: number | null;
  phaseCurrentV: number | null;
  phaseCurrentW: number | null;
  inputVoltageV: number | null;
  ambientTemperatureC: number | null;
  controlBoardTemperatureC: number | null;
  inverterTemperatureC: number | null;
  motorEstimatedTemperatureC: number | null;
  outputVoltageV: number | null;
  fluxActual: number | null;
  hoursRun: number | null;
}

/** Equipment identity for configuration resolution. */
export interface EquipmentIdentity {
  pumpId: string;
  flowhead: number | null;
  flowheadId: number | null;
  vsdTypeId: number | null;
}

/** Flowhead-specific configuration (FH group troubles). */
export interface FlowheadConfig {
  powerRefKw: number | null;
  currentRefA: number | null;
  frequencySetpointHz: number | null;
  rpmSetpoint: number | null;
  torqueSetpointPct: number | null;
  ptsFrequencyHz: number | null;           // PTS: freq <= this
  ptsPowerRefKw: number | null;            // PTS: power >= this
  ptsCurrentRefA: number | null;           // PTS: current >= this
  ptsTorqueRefPct: number | null;          // PTS: torque >= this
  ptsRpmRef: number | null;                // PTS: rpm >= this
  turbulensiPowerRefKw: number | null;     // Turbulensi: power >= this
  turbulensiTorqueRefPct: number | null;   // Turbulensi: torque >= this
  turbulensiCurrentDevThresholdA: number | null; // Turbulensi: |A-MA| >= this
  turbulensiWindow: number | null;         // Turbulensi: MA window
  banyakSampahPowerRefKw: number | null;   // Banyak Sampah: power >= this
  banyakSampahCurrentRefA: number | null;  // Banyak Sampah: current >= this
  banyakSampahTorqueRefPct: number | null; // Banyak Sampah: torque >= this
  dryRunPowerFactor: number | null;        // Dry Run: 0.667 * ptsPowerRefKw
  dryRunCurrentFactor: number | null;      // Dry Run: 0.64 * ptsCurrentRefA
  dryRunTorqueThresholdPct: number | null; // Dry Run: torque < this
}

/** VFD-specific configuration (VFD group troubles). */
export interface VfdConfig {
  unbalanceThresholdPct: number | null;    // Unbalance: deviation >= this
  undervoltageThresholdV: number | null;   // Undervoltage: voltage < this
  overvoltageThresholdV: number | null;    // Overvoltage: voltage > this
  panelOverheatThresholdC: number | null;  // Panel: any temp >= this
}

/** Complete typed configuration for classification. */
export interface ClassificationConfig {
  flowhead: FlowheadConfig;
  vfd: VfdConfig;
  runtime: {
    stagnationLimit: number;
    outputMode: OutputMode;
  };
}

/** Output mode for serialization. */
export type OutputMode = "poc" | "production";

/** Configuration provider interface (injectable, no DB coupling). */
export interface ConfigurationProvider {
  resolve(identity: EquipmentIdentity): Promise<ClassificationConfig>;
}

/** Evaluation result per trouble type (discriminated union). */
export type Evaluation =
  | { ready: true; trigger: 0 | 1; measurements: Record<string, number | string | null> }
  | { ready: false; missingData: string[] };

/** Classification result per trouble (ready only). */
export interface TroubleResult {
  troubleType: TroubleType;
  status: "Dapat Di Klasifikasi";
  detected: boolean;
  triggerCount: number;
  startAt: string | null;
  endAt: string | null;
  measurements?: Record<string, number | string | null>; // PoC ONLY
}

/** Final classification output. */
export interface ClassificationOutput {
  pumpId: string;
  receivedAt: string;
  results: TroubleResult[];                       // ready ONLY
  missingData: Record<string, string[]>;          // not ready ONLY
  activeTroubles: string[];                       // last-known state
}

/** Function type for pump OFF detection (OD-01: injectable port).
 *  Implementations MUST be provided by middleware/device team with verified semantics.
 *  Return true if pump is definitively OFF based on raw payload.
 */
export type IsPumpOffFn = (rawPayload: RawTelemetryPayload) => boolean;

/** OFF detection state for >120s tracking (OD-01/OD-02). */
export interface OffDetectionState {
  offSince: number | null;      // epochMs when OFF first detected
  lastRunAt: number | null;     // epochMs of last RUN event
}

/** Internal state per trouble per pump. */
export interface TroubleState {
  detected: boolean;
  triggerCount: number;
  stagnationCount: number;
  startAt: string | null;
  endAt: string | null;
}

/** Pump-level state including OFF tracking (OD-01/OD-02). */
export interface PumpState {
  troubles: Map<string, TroubleState>;
  offDetection: OffDetectionState;
  lastAcceptedAt: number | null;
  configSnapshot: ClassificationConfig | null;
}

// ============================================================
// Legacy types (still used internally by engine source)
// ============================================================

/** Legacy sensor reading format (snake_case, used internally for history). */
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

/** Legacy pump configuration. */
export interface PumpConfig {
  pump_id: number;
  capacity_lps: number;
  flowhead_id?: number | null;
}

/** Legacy operating setpoint. */
export interface OperatingSetpoint {
  frequency?: number | null;
  rpm?: number | null;
  torque?: number | null;
}