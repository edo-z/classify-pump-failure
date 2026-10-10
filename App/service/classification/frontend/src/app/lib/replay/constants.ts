// 5R Rapi — diekstrak dari ../replay.ts (sumber tunggal konstanta replay).
// replay.ts me-re-export modul ini, konsumen `../replay` tidak berubah.

import type { ReplaySignal } from "./types";

export const SIGNALS = [
  "motorSpeed",
  "outputFrequency",
  "motorCurrent",
  "motorTorque",
  "outputPower",
  "hoursRun",
  "outputVoltage",
  "ambientTemperature",
  "controlBoardTemperature",
  "inverterTemperature",
  "inputVoltage",
  "fluxActual",
  "motorEstimatedTemperature",
  "arusRmsU",
  "arusRmsV",
  "arusRmsW",
  "frequencySetpoint",
] as const;

export const REPLAY_SIGNAL_LABELS: Record<
  ReplaySignal,
  string
> = {
  motorSpeed: "Motor Speed",
  outputFrequency: "Output Frequency",
  motorCurrent: "Motor Current",
  motorTorque: "Motor Torque",
  outputPower: "Output Power",
  hoursRun: "Hours Run",
  outputVoltage: "Output Voltage",
  ambientTemperature: "Ambient Temp",
  controlBoardTemperature: "Control Board Temp",
  inverterTemperature: "Inverter Temp",
  inputVoltage: "Input Voltage",
  fluxActual: "Flux Actual",
  motorEstimatedTemperature: "Motor Est Temp",
  arusRmsU: "Arus RMS U",
  arusRmsV: "Arus RMS V",
  arusRmsW: "Arus RMS W",
  frequencySetpoint: "Frequency Setpoint",
};

export const REPLAY_SIGNAL_COLORS: Record<
  ReplaySignal,
  string
> = {
  motorSpeed: "#0ea5e9",
  outputFrequency: "#2563eb",
  motorCurrent: "#dc2626",
  motorTorque: "#16a34a",
  outputPower: "#f59e0b",
  hoursRun: "#6b7280",
  outputVoltage: "#8b5cf6",
  ambientTemperature: "#ec4899",
  controlBoardTemperature: "#f97316",
  inverterTemperature: "#ef4444",
  inputVoltage: "#7c3aed",
  fluxActual: "#14b8a6",
  motorEstimatedTemperature: "#eab308",
  arusRmsU: "#06b6d4",
  arusRmsV: "#84cc16",
  arusRmsW: "#a855f7",
  frequencySetpoint: "#0f172a",
};

export const SMALL_MULTIPLE_GROUPS: Record<
  string,
  { label: string; signals: ReplaySignal[] }
> = {
  mechanical: {
    label: "Power & Mechanical",
    signals: [
      "motorSpeed",
      "outputFrequency",
      "motorTorque",
      "outputPower",
      "fluxActual",
    ],
  },
  electrical: {
    label: "Electrical",
    signals: [
      "motorCurrent",
      "inputVoltage",
      "outputVoltage",
      "arusRmsU",
      "arusRmsV",
      "arusRmsW",
    ],
  },
  thermal: {
    label: "Thermal",
    signals: [
      "ambientTemperature",
      "controlBoardTemperature",
      "inverterTemperature",
      "motorEstimatedTemperature",
      "hoursRun",
    ],
  },
};

// F3 riset: satuan per sinyal untuk tooltip + label sumbu.
export const SIGNAL_UNITS: Record<ReplaySignal, string> = {
  motorSpeed: "RPM",
  outputFrequency: "Hz",
  motorCurrent: "A",
  motorTorque: "%",
  outputPower: "kW",
  hoursRun: "jam",
  outputVoltage: "V",
  ambientTemperature: "°C",
  controlBoardTemperature: "°C",
  inverterTemperature: "°C",
  inputVoltage: "V",
  fluxActual: "",
  motorEstimatedTemperature: "°C",
  arusRmsU: "A",
  arusRmsV: "A",
  arusRmsW: "A",
  frequencySetpoint: "Hz",
};

export const DEFAULT_VISIBLE_SIGNALS: Record<ReplaySignal, boolean> = {  motorSpeed: false,
  outputFrequency: true,
  motorCurrent: true,
  motorTorque: false,
  outputPower: false,
  hoursRun: false,
  outputVoltage: false,
  ambientTemperature: false,
  controlBoardTemperature: false,
  inverterTemperature: false,
  inputVoltage: true,
  fluxActual: false,
  motorEstimatedTemperature: false,
  arusRmsU: false,
  arusRmsV: false,
  arusRmsW: false,
  frequencySetpoint: false,
};

// Preset sinyal per trouble dari persamaan klasifikasi: mengaktifkan
// trouble otomatis menyalakan parameter yang mempengaruhinya.
export const TROUBLE_SIGNAL_PRESETS: Record<string, ReplaySignal[]> = {
  pompa_tersangkut_sampah: [
    "outputFrequency",
    "outputPower",
    "motorCurrent",
    "motorTorque",
    "motorSpeed",
  ],
  turbulensi: [
    "outputFrequency",
    "frequencySetpoint",
    "outputPower",
    "motorCurrent",
    "motorTorque",
  ],
  banyak_sampah: [
    "outputFrequency",
    "frequencySetpoint",
    "outputPower",
    "motorCurrent",
    "motorTorque",
  ],
  unbalance: ["arusRmsU", "arusRmsV", "arusRmsW"],
  undervoltage: ["inputVoltage"],
  overvoltage: ["inputVoltage"],
  dry_run: [
    "outputFrequency",
    "frequencySetpoint",
    "outputPower",
    "motorCurrent",
    "motorTorque",
  ],
  panel_overheat: [
    "ambientTemperature",
    "controlBoardTemperature",
    "inverterTemperature",
  ],
};

export const TROUBLE_PRESET_ORDER: string[] = [
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "unbalance",
  "undervoltage",
  "overvoltage",
  "dry_run",
  "panel_overheat",
];

// Warna netral untuk tipe failure tak dikenal (seragam di chart+tabel+preset).
export const UNKNOWN_FAILURE_COLOR = "#6b7280";

// Mode cetak monokrom (keputusan produk #3cetak): pola garis per sinyal
// agar figure terbaca grayscale. Warna diganti hitam/abu (lihat builder).
export const MONOCHROME_LINESTYLES: Record<ReplaySignal, "solid" | "dashed" | "dotted"> = {
  motorSpeed: "solid",
  outputFrequency: "dashed",
  motorCurrent: "dotted",
  motorTorque: "solid",
  outputPower: "dashed",
  hoursRun: "dotted",
  outputVoltage: "solid",
  ambientTemperature: "dashed",
  controlBoardTemperature: "dotted",
  inverterTemperature: "solid",
  inputVoltage: "dashed",
  fluxActual: "dotted",
  motorEstimatedTemperature: "solid",
  arusRmsU: "dashed",
  arusRmsV: "dotted",
  arusRmsW: "solid",
  frequencySetpoint: "dashed",
};

export const MONOCHROME_WIDTHS: Record<ReplaySignal, number> = {
  motorSpeed: 2,
  outputFrequency: 2,
  motorCurrent: 3,
  motorTorque: 3,
  outputPower: 2,
  hoursRun: 2,
  outputVoltage: 3,
  ambientTemperature: 2,
  controlBoardTemperature: 2,
  inverterTemperature: 3,
  inputVoltage: 3,
  fluxActual: 2,
  motorEstimatedTemperature: 2,
  arusRmsU: 2,
  arusRmsV: 3,
  arusRmsW: 2,
  frequencySetpoint: 2,
};

// F5 riset: palet failure bebas tabrakan dengan warna sinyal (Okabe-Ito)
// + redundansi simbol per tipe (bukan warna saja).
export const FAILURE_COLORS: Record<string, string> = {
  undervoltage: "#0072B2",
  overvoltage: "#D55E00",
  unbalance: "#009E73",
  panel_overheat: "#CC79A7",
  pompa_tersangkut_sampah: "#b45309",
  turbulensi: "#0891b2",
  banyak_sampah: "#65a30d",
  dry_run: "#0e7490",
  // Alias backend lama (dinormalisasi ke dry_run di failure-areas.ts) —
  // entri ganda disengaja agar lookup tipe mentah tetap berwarna.
  low_water_menyala: "#0e7490",
  normal: "#9ca3af",
};

export const FAILURE_SYMBOLS: Record<string, string> = {
  undervoltage: "triangle",
  overvoltage: "arrow",
  unbalance: "circle",
  panel_overheat: "rect",
  pompa_tersangkut_sampah: "diamond",
  turbulensi: "roundRect",
  banyak_sampah: "pin",
  dry_run: "pin",
  low_water_menyala: "pin",
  normal: "circle",
};
