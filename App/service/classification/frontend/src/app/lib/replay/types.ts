// 5R Rapi — diekstrak dari ../replay.ts (sumber tunggal tipe replay).
// replay.ts me-re-export modul ini, konsumen `../replay` tidak berubah.

export type ReplayPoint = [number, number | null];

export type ReplayRow = {
  timestamp: number;
  motorSpeed: number | null;
  outputFrequency: number | null;
  motorCurrent: number | null;
  motorTorque: number | null;
  outputPower: number | null;
  hoursRun: number | null;
  outputVoltage: number | null;
  ambientTemperature: number | null;
  controlBoardTemperature: number | null;
  inverterTemperature: number | null;
  inputVoltage: number | null;
  fluxActual: number | null;
  motorEstimatedTemperature: number | null;
  arusRmsU: number | null;
  arusRmsV: number | null;
  arusRmsW: number | null;
  frequencySetpoint: number | null;
  gapBefore: boolean;
};

export type ReplaySeries = {
  rows: ReplayRow[];
  timestamps: number[];
  firstTimestamp: number;
  lastTimestamp: number;
  timestampedSamples: number;
  medianIntervalMs: number;
  gapCount: number;
};

export type ReplayRenderMode =
  | "RAW"
  | "ADAPTIVE";

export type ReplayRender = {
  motorSpeed: ReplayPoint[];
  outputFrequency: ReplayPoint[];
  motorCurrent: ReplayPoint[];
  motorTorque: ReplayPoint[];
  outputPower: ReplayPoint[];
  hoursRun: ReplayPoint[];
  outputVoltage: ReplayPoint[];
  ambientTemperature: ReplayPoint[];
  controlBoardTemperature: ReplayPoint[];
  inverterTemperature: ReplayPoint[];
  inputVoltage: ReplayPoint[];
  fluxActual: ReplayPoint[];
  motorEstimatedTemperature: ReplayPoint[];
  arusRmsU: ReplayPoint[];
  arusRmsV: ReplayPoint[];
  arusRmsW: ReplayPoint[];
  frequencySetpoint: ReplayPoint[];
  visibleSamples: number;
  renderedPoints: number;
  renderBudget: number;
  mode: ReplayRenderMode;
};

export type ReplaySignal =
  | "motorSpeed"
  | "outputFrequency"
  | "motorCurrent"
  | "motorTorque"
  | "outputPower"
  | "hoursRun"
  | "outputVoltage"
  | "ambientTemperature"
  | "controlBoardTemperature"
  | "inverterTemperature"
  | "inputVoltage"
  | "fluxActual"
  | "motorEstimatedTemperature"
  | "arusRmsU"
  | "arusRmsV"
  | "arusRmsW"
  | "frequencySetpoint";

export type FailurePointLite = {
  timestamp: string;
  trouble_type: string;
};

export type FailureArea = {
  start: string;
  end: string;
  trouble_type: string;
  count: number;
  durationMs: number;
};
