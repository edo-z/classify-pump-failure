/**
 * DEXMIN — validation konfigurasi Classification Engine.
 * Readiness dipisahkan per Failure agar konfigurasi yang hilang
 * hanya mempengaruhi evaluator yang membutuhkannya.
 *
 * Tidak melakukan query database maupun mengubah rumus evaluator.
 */

import { TroubleType } from "./models.ts";

import type {
  ClassificationConfig,
  FlowheadConfig,
  VfdConfig,
  OutputMode,
  EquipmentIdentity,
} from "./models.ts";

// ============================================================
// VALIDATION RESULT
// ============================================================

export interface FailureReadinessResult {
  ready: boolean;
  errors: string[];
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  failureReadiness: Record<TroubleType, FailureReadinessResult>;
}

// ============================================================
// FAILURE REQUIREMENTS — FLOWHEAD
// ============================================================

const FLOWHEAD_REQUIREMENTS = {
  pompa_tersangkut_sampah: [
    "ptsFrequencyHz",
    "ptsPowerRefKw",
    "ptsCurrentRefA",
    "ptsTorqueRefPct",
    "ptsRpmRef",
  ],

  turbulensi: [
    "frequencySetpointHz",
    "turbulensiPowerRefKw",
    "turbulensiTorqueRefPct",
    "turbulensiCurrentDevThresholdA",
    "turbulensiWindow",
  ],

  banyak_sampah: [
    "frequencySetpointHz",
    "banyakSampahPowerRefKw",
    "banyakSampahCurrentRefA",
    "banyakSampahTorqueRefPct",
  ],

  dry_run: [
    "frequencySetpointHz",
    "ptsPowerRefKw",
    "ptsCurrentRefA",
    "dryRunPowerFactor",
    "dryRunCurrentFactor",
    "dryRunTorqueThresholdPct",
  ],

} as const satisfies Partial<
  Record<TroubleType, readonly (keyof FlowheadConfig)[]>
>;

// ============================================================
// FAILURE REQUIREMENTS — VSD
// ============================================================

const VFD_REQUIREMENTS = {
  unbalance: [
    "unbalanceThresholdPct",
  ],

  undervoltage: [
    "undervoltageThresholdV",
  ],

  overvoltage: [
    "overvoltageThresholdV",
  ],

  panel_overheat: [
    "panelOverheatThresholdC",
  ],

} as const satisfies Partial<
  Record<TroubleType, readonly (keyof VfdConfig)[]>
>;

const TROUBLE_TYPES: readonly TroubleType[] =
  Object.values(TroubleType);

// ============================================================
// FIELD REGISTRY
// ============================================================

const ALL_FLOWHEAD_FIELDS: readonly (keyof FlowheadConfig)[] = [
  "powerRefKw",
  "currentRefA",
  "frequencySetpointHz",
  "rpmSetpoint",
  "torqueSetpointPct",

  "ptsFrequencyHz",
  "ptsPowerRefKw",
  "ptsCurrentRefA",
  "ptsTorqueRefPct",
  "ptsRpmRef",

  "turbulensiPowerRefKw",
  "turbulensiTorqueRefPct",
  "turbulensiCurrentDevThresholdA",
  "turbulensiWindow",

  "banyakSampahPowerRefKw",
  "banyakSampahCurrentRefA",
  "banyakSampahTorqueRefPct",

  "dryRunPowerFactor",
  "dryRunCurrentFactor",
  "dryRunTorqueThresholdPct",
];

const ALL_VFD_FIELDS: readonly (keyof VfdConfig)[] = [
  "unbalanceThresholdPct",
  "undervoltageThresholdV",
  "overvoltageThresholdV",
  "panelOverheatThresholdC",
];

// ============================================================
// NUMERIC VALIDATION
// ============================================================

function validateNumber(
  field: string,
  value: number | null | undefined,
  prefix: string,
  required: boolean,
): string[] {

  const label = `${prefix}.${field}`;

  if (value == null) {
    return required
      ? [`${label}: required`]
      : [];
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return [
      `${label}: must be positive finite number, got ${value}`,
    ];
  }

  // Moving Average window harus bilangan bulat.
  if (
    field === "turbulensiWindow" &&
    !Number.isSafeInteger(value)
  ) {
    return [
      `${label}: must be positive integer`,
    ];
  }

  // Dry Run factor diterima sebagai rasio dari provider.
  // 66.70% -> 0.667
  // 64.00% -> 0.64

  if (
    (
      field === "dryRunPowerFactor" ||
      field === "dryRunCurrentFactor"
    ) &&
    value > 1
  ) {
    return [
      `${label}: factor must be <= 1 after percentage conversion`,
    ];
  }

  return [];
}

// ============================================================
// VOLTAGE CROSS-VALIDATION
// ============================================================

function voltageOrderErrors(
  config: VfdConfig,
  prefix: string,
): string[] {

  const uv = config.undervoltageThresholdV;
  const ov = config.overvoltageThresholdV;

  if (
    typeof uv === "number" &&
    Number.isFinite(uv) &&
    uv > 0 &&
    typeof ov === "number" &&
    Number.isFinite(ov) &&
    ov > 0 &&
    uv >= ov
  ) {
    return [
      `${prefix}.undervoltageThresholdV (${uv}) must be < overvoltageThresholdV (${ov})`,
    ];
  }

  return [];
}

// ============================================================
// FAILURE-SPECIFIC VALIDATION
// ============================================================

export function validateFailureConfig(
  config: ClassificationConfig,
  failure: TroubleType,
): FailureReadinessResult {

  const errors: string[] = [];

  const flowFields = FLOWHEAD_REQUIREMENTS[
    failure as keyof typeof FLOWHEAD_REQUIREMENTS
  ] as readonly (keyof FlowheadConfig)[] | undefined;

  const vfdFields = VFD_REQUIREMENTS[
    failure as keyof typeof VFD_REQUIREMENTS
  ] as readonly (keyof VfdConfig)[] | undefined;

  // Flowhead dependency
  for (const field of flowFields ?? []) {
    errors.push(
      ...validateNumber(
        field,
        config.flowhead[field],
        "flowhead",
        true,
      ),
    );
  }

  // VSD dependency
  for (const field of vfdFields ?? []) {
    errors.push(
      ...validateNumber(
        field,
        config.vfd[field],
        "vfd",
        true,
      ),
    );
  }

  // Kedua ambang tegangan perlu konsisten.
  if (
    failure === "undervoltage" ||
    failure === "overvoltage"
  ) {
    errors.push(
      ...voltageOrderErrors(config.vfd, "vfd"),
    );
  }

  // NORMAL tidak mempunyai threshold sendiri.
  // Status akhirnya tetap diturunkan oleh engine.

  return {
    ready: errors.length === 0,
    errors,
  };
}

// ============================================================
// FLOWHEAD AGGREGATE VALIDATION
// ============================================================

export function validateFlowheadConfig(
  config: FlowheadConfig,
  prefix = "flowhead",
): string[] {

  const required = new Set<keyof FlowheadConfig>(
    Object.values(FLOWHEAD_REQUIREMENTS).flat() as (keyof FlowheadConfig)[],
  );

  return ALL_FLOWHEAD_FIELDS.flatMap((field) =>
    validateNumber(
      field,
      config[field],
      prefix,
      required.has(field),
    ),
  );
}

// ============================================================
// VSD AGGREGATE VALIDATION
// ============================================================

export function validateVfdConfig(
  config: VfdConfig,
  prefix = "vfd",
): string[] {

  const required = new Set<keyof VfdConfig>(
    Object.values(VFD_REQUIREMENTS).flat() as (keyof VfdConfig)[],
  );

  return [
    ...ALL_VFD_FIELDS.flatMap((field) =>
      validateNumber(
        field,
        config[field],
        prefix,
        required.has(field),
      ),
    ),

    ...voltageOrderErrors(config, prefix),
  ];
}

// ============================================================
// RUNTIME VALIDATION
// ============================================================

export function validateRuntimeConfig(
  config: {
    stagnationLimit: number;
    outputMode: OutputMode;
  },
  prefix = "runtime",
): string[] {

  const errors: string[] = [];

  if (
    !Number.isSafeInteger(config.stagnationLimit) ||
    config.stagnationLimit < 1
  ) {
    errors.push(
      `${prefix}.stagnationLimit: must be positive integer`,
    );
  }

  if (
    config.outputMode !== "poc" &&
    config.outputMode !== "production"
  ) {
    errors.push(
      `${prefix}.outputMode: must be "poc" or "production"`,
    );
  }

  return errors;
}

// ============================================================
// CLASSIFICATION CONFIG VALIDATION
// ============================================================

export function validateClassificationConfig(
  config: ClassificationConfig,
): ConfigValidationResult {

  const failureReadiness =
    {} as Record<TroubleType, FailureReadinessResult>;

  // Penilaian independen untuk setiap Failure.
  for (const trouble of TROUBLE_TYPES) {
    failureReadiness[trouble] =
      validateFailureConfig(config, trouble);
  }

  // Tetap sediakan hasil validasi agregat untuk
  // kompatibilitas dengan pemanggil sebelumnya.
  const errors = [
    ...validateFlowheadConfig(config.flowhead),
    ...validateVfdConfig(config.vfd),
    ...validateRuntimeConfig(config.runtime),
  ];

  return {
    valid: errors.length === 0,
    errors,
    failureReadiness,
  };
}

/** Create default config for testing/fixtures (not for production). */
export function createDefaultConfig(overrides: {
  flowhead?: Partial<FlowheadConfig>;
  vfd?: Partial<VfdConfig>;
  runtime?: Partial<{ stagnationLimit: number; outputMode: OutputMode }>;
} = {}): ClassificationConfig {
  const mergeFlowhead = (base: FlowheadConfig, override?: Partial<FlowheadConfig>): FlowheadConfig => {
    const result: FlowheadConfig = { ...base };
    if (override) {
      for (const key of Object.keys(override) as Array<keyof FlowheadConfig>) {
        const value = override[key];
        if (value !== undefined) result[key] = value;
      }
    }
    return result;
  };

  const mergeVfd = (base: VfdConfig, override?: Partial<VfdConfig>): VfdConfig => {
    const result: VfdConfig = { ...base };
    if (override) {
      for (const key of Object.keys(override) as Array<keyof VfdConfig>) {
        const value = override[key];
        if (value !== undefined) result[key] = value;
      }
    }
    return result;
  };

  const baseFlowhead: FlowheadConfig = {
    powerRefKw: 250,
    currentRefA: 517,
    frequencySetpointHz: 38,
    rpmSetpoint: 950,
    torqueSetpointPct: 80,
    ptsFrequencyHz: 10,
    ptsPowerRefKw: 250,
    ptsCurrentRefA: 517,
    ptsTorqueRefPct: 110,
    ptsRpmRef: 100,
    turbulensiPowerRefKw: 250,
    turbulensiTorqueRefPct: 90,
    turbulensiCurrentDevThresholdA: 10,
    turbulensiWindow: 30,
    banyakSampahPowerRefKw: 250,
    banyakSampahCurrentRefA: 517,
    banyakSampahTorqueRefPct: 90,
    dryRunPowerFactor: 0.667,
    dryRunCurrentFactor: 0.64,
    dryRunTorqueThresholdPct: 70,
  };

  const baseVfd: VfdConfig = {
    unbalanceThresholdPct: 10,
    undervoltageThresholdV: 360,
    overvoltageThresholdV: 410,
    panelOverheatThresholdC: 60,
  };

  return {
    flowhead: mergeFlowhead(baseFlowhead, overrides.flowhead),
    vfd: mergeVfd(baseVfd, overrides.vfd),
    runtime: {
      stagnationLimit: overrides.runtime?.stagnationLimit ?? 5,
      outputMode: overrides.runtime?.outputMode ?? "poc",
    },
  };
}

/** Resolve configuration from equipment identity (legacy adapter). */
export async function resolveConfigFromLegacy(
  identity: EquipmentIdentity,
  legacyResolver: (identity: EquipmentIdentity) => Promise<{
    flowhead: Partial<FlowheadConfig>;
    vfd: Partial<VfdConfig>;
  }>
): Promise<ClassificationConfig> {
  const legacy = await legacyResolver(identity);
  return createDefaultConfig({
    flowhead: legacy.flowhead,
    vfd: legacy.vfd,
  });
}
