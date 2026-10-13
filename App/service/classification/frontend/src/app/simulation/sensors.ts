// 5R Simulasi — tabel sensor: target slider, noise, batas fisik UI.
// Batas di sini = rentang slider simulasi, BUKAN toleransi pabrikan
// maupun batas keselamatan peralatan.

export type NoiseKind = "pct" | "abs";

export type SimSensor = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Target default; fungsi bila tergantung profil (frekuensi, rpm). */
  defaultTarget: number | ((profileFreq: number, profileRpm: number) => number);
  noise: NoiseKind;
  /** Amplitudo default tabel (dipilih awal). */
  ampDefault: number;
  /** Amplitudo maksimum yang dapat dipilih. 0 selalu tersedia. */
  ampMax: number;
  ampUnit: string;
};

export const NOISE_SENSORS = [
  { key: "input_voltage", label: "Input Voltage", unit: "V", min: 300, max: 450, step: 0.5, decimals: 1, defaultTarget: 380, noise: "pct", ampDefault: 0.5, ampMax: 2, ampUnit: "%" },
  { key: "output_frequency", label: "Output Frequency", unit: "Hz", min: 0, max: 55, step: 0.1, decimals: 1, defaultTarget: (f) => +(f - 1).toFixed(1), noise: "abs", ampDefault: 0, ampMax: 0.5, ampUnit: "Hz" },
  { key: "motor_current", label: "Motor Current", unit: "A", min: 0, max: 1000, step: 1, decimals: 1, defaultTarget: 246, noise: "pct", ampDefault: 1, ampMax: 5, ampUnit: "%" },
  { key: "output_power", label: "Output Power", unit: "kW", min: 0, max: 500, step: 1, decimals: 1, defaultTarget: 111, noise: "pct", ampDefault: 1, ampMax: 5, ampUnit: "%" },
  { key: "motor_torque", label: "Motor Torque", unit: "%", min: 0, max: 130, step: 0.5, decimals: 1, defaultTarget: 40, noise: "abs", ampDefault: 1, ampMax: 5, ampUnit: "pts" },
  { key: "motor_speed", label: "Motor Speed", unit: "rpm", min: 0, max: 1200, step: 1, decimals: 0, defaultTarget: (_f, rpm) => rpm, noise: "pct", ampDefault: 0.2, ampMax: 1, ampUnit: "%" },
  { key: "arus_rms_u", label: "Arus RMS U", unit: "A", min: 0, max: 1000, step: 1, decimals: 1, defaultTarget: 100, noise: "pct", ampDefault: 1, ampMax: 5, ampUnit: "%" },
  { key: "arus_rms_v", label: "Arus RMS V", unit: "A", min: 0, max: 1000, step: 1, decimals: 1, defaultTarget: 100, noise: "pct", ampDefault: 1, ampMax: 5, ampUnit: "%" },
  { key: "arus_rms_w", label: "Arus RMS W", unit: "A", min: 0, max: 1000, step: 1, decimals: 1, defaultTarget: 100, noise: "pct", ampDefault: 1, ampMax: 5, ampUnit: "%" },
  { key: "ambient_temperature", label: "Ambient Temp", unit: "°C", min: 0, max: 100, step: 0.1, decimals: 1, defaultTarget: 30, noise: "abs", ampDefault: 0.2, ampMax: 1, ampUnit: "°C" },
  { key: "control_board_temperature", label: "Control Board Temp", unit: "°C", min: 0, max: 100, step: 0.1, decimals: 1, defaultTarget: 40, noise: "abs", ampDefault: 0.3, ampMax: 2, ampUnit: "°C" },
  { key: "inverter_temperature", label: "Inverter Temp", unit: "°C", min: 0, max: 100, step: 0.1, decimals: 1, defaultTarget: 45, noise: "abs", ampDefault: 0.3, ampMax: 2, ampUnit: "°C" },
] as const satisfies readonly SimSensor[];

/** Kunci sensor kanonis — satu sumber kebenaran untuk FAILURE_MAP. */
export type SensorKey = (typeof NOISE_SENSORS)[number]["key"];

export type ManualField = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** hours_run terakumulasi otomatis bila diaktifkan. */
  accumulate?: boolean;
};

export const MANUAL_FIELDS: ManualField[] = [
  { key: "output_voltage", label: "Output Voltage", unit: "V", min: 0, max: 500, step: 1 },
  { key: "hours_run", label: "Hours Run", unit: "h", min: 0, max: 100000, step: 1, accumulate: true },
  { key: "flux_actual", label: "Flux Actual", unit: "%", min: 0, max: 100, step: 0.5 },
  { key: "motor_estimated_temperature", label: "Motor Est Temp", unit: "°C", min: 0, max: 150, step: 0.5 },
];

/** Baseline profil: frekuensi setpoint + rpm acuan (cermin profile_setpoints.json). */
export const PROFILE_BASE: Record<string, { freq: number; rpm: number }> = {
  "500_lps": { freq: 46.1, rpm: 900 },
  "3000_lps": { freq: 38.0, rpm: 950 },
  "5000_lps": { freq: 40.0, rpm: 990 },
};

export function defaultTargets(profileId: string): Record<string, number> {
  const base = PROFILE_BASE[profileId] ?? PROFILE_BASE["5000_lps"];
  const out: Record<string, number> = {};
  for (const s of NOISE_SENSORS) {
    out[s.key] =
      typeof s.defaultTarget === "function"
        ? s.defaultTarget(base.freq, base.rpm)
        : s.defaultTarget;
  }
  return out;
}

export function defaultAmps(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of NOISE_SENSORS) out[s.key] = s.ampDefault;
  return out;
}

export function ampOptions(s: SimSensor): number[] {
  const opts = [0, s.ampDefault, s.ampMax].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  return opts.sort((a, b) => a - b);
}
