/**
 * Typed configuration schema and validation.
 *
 * Provides runtime validation for ClassificationConfig with clear error messages.
 * No external validation library dependency — pure TypeScript guards.
 */

import type { ClassificationConfig, FlowheadConfig, VfdConfig, OutputMode, EquipmentIdentity } from "./models.ts";

/** Validation result for config. */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate flowhead configuration (FH group troubles). */
export function validateFlowheadConfig(config: FlowheadConfig, prefix = "flowhead"): string[] {
  const errors: string[] = [];

  // Required for PTS
  if (config.ptsFrequencyHz === null) errors.push(`${prefix}.ptsFrequencyHz: required`);
  if (config.ptsPowerRefKw === null) errors.push(`${prefix}.ptsPowerRefKw: required`);
  if (config.ptsCurrentRefA === null) errors.push(`${prefix}.ptsCurrentRefA: required`);
  if (config.ptsTorqueRefPct === null) errors.push(`${prefix}.ptsTorqueRefPct: required`);
  if (config.ptsRpmRef === null) errors.push(`${prefix}.ptsRpmRef: required`);

  // Required for Turbulensi
  if (config.turbulensiPowerRefKw === null) errors.push(`${prefix}.turbulensiPowerRefKw: required`);
  if (config.turbulensiTorqueRefPct === null) errors.push(`${prefix}.turbulensiTorqueRefPct: required`);
  if (config.turbulensiCurrentDevThresholdA === null) errors.push(`${prefix}.turbulensiCurrentDevThresholdA: required`);
  if (config.turbulensiWindow === null) errors.push(`${prefix}.turbulensiWindow: required`);

  // Required for Banyak Sampah
  if (config.banyakSampahPowerRefKw === null) errors.push(`${prefix}.banyakSampahPowerRefKw: required`);
  if (config.banyakSampahCurrentRefA === null) errors.push(`${prefix}.banyakSampahCurrentRefA: required`);
  if (config.banyakSampahTorqueRefPct === null) errors.push(`${prefix}.banyakSampahTorqueRefPct: required`);

  // Required for Dry Run
  if (config.dryRunPowerFactor === null) errors.push(`${prefix}.dryRunPowerFactor: required`);
  if (config.dryRunCurrentFactor === null) errors.push(`${prefix}.dryRunCurrentFactor: required`);
  if (config.dryRunTorqueThresholdPct === null) errors.push(`${prefix}.dryRunTorqueThresholdPct: required`);

  // Validate positive finite for numeric fields
  const numericFields: (keyof FlowheadConfig)[] = [
    "powerRefKw", "currentRefA", "frequencySetpointHz", "rpmSetpoint", "torqueSetpointPct",
    "ptsFrequencyHz", "ptsPowerRefKw", "ptsCurrentRefA", "ptsTorqueRefPct", "ptsRpmRef",
    "turbulensiPowerRefKw", "turbulensiTorqueRefPct", "turbulensiCurrentDevThresholdA", "turbulensiWindow",
    "banyakSampahPowerRefKw", "banyakSampahCurrentRefA", "banyakSampahTorqueRefPct",
    "dryRunPowerFactor", "dryRunCurrentFactor", "dryRunTorqueThresholdPct",
  ];

  for (const key of numericFields) {
    const value = config[key];
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      errors.push(`${prefix}.${key}: must be positive finite number, got ${value}`);
    }
  }

  return errors;
}

/** Validate VFD configuration (VFD group troubles). */
export function validateVfdConfig(config: VfdConfig, prefix = "vfd"): string[] {
  const errors: string[] = [];

  if (config.unbalanceThresholdPct === null) errors.push(`${prefix}.unbalanceThresholdPct: required`);
  if (config.undervoltageThresholdV === null) errors.push(`${prefix}.undervoltageThresholdV: required`);
  if (config.overvoltageThresholdV === null) errors.push(`${prefix}.overvoltageThresholdV: required`);
  if (config.panelOverheatThresholdC === null) errors.push(`${prefix}.panelOverheatThresholdC: required`);

  const numericFields: (keyof VfdConfig)[] = [
    "unbalanceThresholdPct", "undervoltageThresholdV", "overvoltageThresholdV", "panelOverheatThresholdC",
  ];

  for (const key of numericFields) {
    const value = config[key];
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      errors.push(`${prefix}.${key}: must be positive finite number, got ${value}`);
    }
  }

  // Voltage thresholds should be ordered
  if (config.undervoltageThresholdV !== null && config.overvoltageThresholdV !== null) {
    if (config.undervoltageThresholdV >= config.overvoltageThresholdV) {
      errors.push(`${prefix}.undervoltageThresholdV (${config.undervoltageThresholdV}) must be < overvoltageThresholdV (${config.overvoltageThresholdV})`);
    }
  }

  return errors;
}

/** Validate runtime configuration. */
export function validateRuntimeConfig(config: { stagnationLimit: number; outputMode: OutputMode }, prefix = "runtime"): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(config.stagnationLimit) || config.stagnationLimit < 1) {
    errors.push(`${prefix}.stagnationLimit: must be positive integer`);
  }
  if (config.outputMode !== "poc" && config.outputMode !== "production") {
    errors.push(`${prefix}.outputMode: must be "poc" or "production"`);
  }

  return errors;
}

/** Validate complete classification config. */
export function validateClassificationConfig(config: ClassificationConfig): ConfigValidationResult {
  const errors: string[] = [];

  errors.push(...validateFlowheadConfig(config.flowhead, "flowhead"));
  errors.push(...validateVfdConfig(config.vfd, "vfd"));
  errors.push(...validateRuntimeConfig(config.runtime, "runtime"));

  return { valid: errors.length === 0, errors };
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