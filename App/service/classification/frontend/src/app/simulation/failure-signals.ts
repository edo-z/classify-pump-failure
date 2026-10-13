/**
 * Mapping Failure Type ke sensor kanonis berdasarkan 06-classification.md.
 * Digunakan untuk memfilter Sensor Controls dan Live Trend.
 */

export type FailureType = 
  | "dry_run" 
  | "turbulensi" 
  | "banyak_sampah" 
  | "pompa_tersangkut_sampah" 
  | "unbalance" 
  | "undervoltage" 
  | "overvoltage" 
  | "panel_overheat";

import type { SensorKey } from "./sensors";

export interface FailureMapping {
  label: string;
  sensors: SensorKey[];
}

export const FAILURE_MAP: Record<FailureType, FailureMapping> = {
  dry_run: {
    label: "Dry Run",
    sensors: ["output_frequency", "output_power", "motor_current", "motor_torque"],
  },
  turbulensi: {
    label: "Turbulensi",
    sensors: ["output_frequency", "output_power", "motor_current", "motor_torque"],
  },
  banyak_sampah: {
    label: "Banyak Sampah",
    sensors: ["output_frequency", "output_power", "motor_current", "motor_torque"],
  },
  pompa_tersangkut_sampah: {
    label: "Pompa Tersangkut Sampah",
    sensors: ["output_frequency", "output_power", "motor_current", "motor_torque", "motor_speed"],
  },
  unbalance: {
    label: "Unbalance",
    sensors: ["arus_rms_u", "arus_rms_v", "arus_rms_w"],
  },
  undervoltage: {
    label: "Undervoltage",
    sensors: ["input_voltage"],
  },
  overvoltage: {
    label: "Overvoltage",
    sensors: ["input_voltage"],
  },
  panel_overheat: {
    label: "Panel Overheat",
    sensors: ["ambient_temperature", "control_board_temperature", "inverter_temperature"],
  },
};

export const FAILURE_OPTIONS = Object.entries(FAILURE_MAP).map(([id, map]) => ({
  id,
  label: map.label,
}));
