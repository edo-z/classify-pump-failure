/**
 * Configuration Provider — implements ConfigurationProvider interface.
 * Reads configuration from JSON files (pump_profiles.json, profile_setpoints.json, rules.json).
 * This is the typed configuration mechanism replacing the legacy resolveLegacyConfig adapter.
 */

import { readFileSync } from "node:fs";
import type { ClassificationConfig, EquipmentIdentity } from "./models.ts";
import { validateClassificationConfig } from "./configuration.ts";
import { resolveLayeredValue } from "./configuration-resolver.ts";

/** Configuration provider interface (injectable, no DB coupling). */
export interface ConfigurationProvider {
  resolve(identity: EquipmentIdentity): Promise<ClassificationConfig>;
}

const PROFILES_FILE = new URL("./pump_profiles.json", import.meta.url);
const SETPOINTS_FILE = new URL("./profile_setpoints.json", import.meta.url);
const RULES_FILE = new URL("./rules.json", import.meta.url);

interface ProfileData {
  thresholds?: {
    pompa_tersangkut_sampah?: {
      power_kw?: { value: number };
      current_a?: { value: number };
    };
  };
  operating_setpoint?: {
    frequency_hz?: number;
    rpm?: number;
    torque?: number;
  };
}

interface SetpointData {
  frequency_hz?: number;
  rpm?: number;
  torque?: number;
}

interface RulesData {
  tiers?: Record<string, {
    rules?: Record<string, {
      conditions?: Array<{
        field?: string;
        value?: unknown;
      }>;
    }>;
  }>;
}

/**
 * Default ConfigurationProvider implementation reading from JSON files.
 * Used for testing and frozen cases. Production should inject a DB-backed provider.
 */
export class JsonFileConfigurationProvider {
  private _profilesCache: Record<string, ProfileData> | null = null;
  private _setpointsCache: Record<string, SetpointData> | null = null;
  private _rulesCache: RulesData | null = null;

  private getProfiles(): Record<string, ProfileData> {
    if (this._profilesCache === null) {
      const raw = readFileSync(PROFILES_FILE, "utf-8");
      this._profilesCache = JSON.parse(raw).profiles ?? {};
    }
    return this._profilesCache!;
  }

  private getSetpoints(): Record<string, SetpointData> {
    if (this._setpointsCache === null) {
      const raw = readFileSync(SETPOINTS_FILE, "utf-8");
      this._setpointsCache = JSON.parse(raw);
    }
    return this._setpointsCache!;
  }

  private getRules(): RulesData {
    if (this._rulesCache === null) {
      const raw = readFileSync(RULES_FILE, "utf-8");
      this._rulesCache = JSON.parse(raw);
    }
    return this._rulesCache!;
  }

  async resolve(identity: EquipmentIdentity): Promise<import("./models.ts").ClassificationConfig> {
    const profiles = this.getProfiles();
    const setpoints = this.getSetpoints();
    const rules = this.getRules();

    // Profile is keyed by capacity (flowhead), not by flowhead_id
    const lookupKey = identity.flowhead ? `${identity.flowhead}_lps` : "";
    const profile = lookupKey ? profiles[lookupKey] : null;
    const setpoint = lookupKey ? setpoints[lookupKey] : null;

    // Read PTS thresholds from rules.json for this tier
    const tierKey = String(identity.flowhead);
    const ptsConditions = rules.tiers?.[tierKey]?.rules?.POMPA_TERSANGKUT_SAMPAH?.conditions ?? [];
    const ptsTorqueCond = ptsConditions.find((c: { field?: string; value?: unknown }) => c.field === "motor_torque") as { value?: number } | undefined;
    const ptsRpmCond = ptsConditions.find((c: { field?: string; value?: unknown }) => c.field === "motor_speed") as { value?: number } | undefined;
    const ptsFreqCond = ptsConditions.find((c: { field?: string; value?: unknown }) => c.field === "output_frequency") as { value?: number } | undefined;

    // Build flowhead config with priority override -> flowhead -> profile
    // Note: flowhead and override only have power_kw and current_a (from rule_config)
    // For now, override/flowhead have no additional data beyond what profile provides
    const flowheadConfig: import("./models.ts").FlowheadConfig = {
      powerRefKw: profile?.thresholds?.pompa_tersangkut_sampah?.power_kw?.value ?? null,
      currentRefA: profile?.thresholds?.pompa_tersangkut_sampah?.current_a?.value ?? null,
      frequencySetpointHz: setpoint?.frequency_hz ?? profile?.operating_setpoint?.frequency_hz ?? null,
      rpmSetpoint: setpoint?.rpm ?? profile?.operating_setpoint?.rpm ?? null,
      torqueSetpointPct: setpoint?.torque ?? profile?.operating_setpoint?.torque ?? null,
      // PTS specific - read from profile data (which now includes rules.json values)
      ptsFrequencyHz: ptsFreqCond?.value ?? 10,
      ptsPowerRefKw: profile?.thresholds?.pompa_tersangkut_sampah?.power_kw?.value ?? null,
      ptsCurrentRefA: profile?.thresholds?.pompa_tersangkut_sampah?.current_a?.value ?? null,
      ptsTorqueRefPct: ptsTorqueCond?.value ?? 110,
      ptsRpmRef: ptsRpmCond?.value ?? 100,
      // Turbulensi specific
      turbulensiPowerRefKw: profile?.thresholds?.pompa_tersangkut_sampah?.power_kw?.value ?? null,
      turbulensiTorqueRefPct: 90, // From rules.json
      turbulensiCurrentDevThresholdA: 10, // From rules.json
      turbulensiWindow: 30, // From rules.json
      // Banyak Sampah specific
      banyakSampahPowerRefKw: profile?.thresholds?.pompa_tersangkut_sampah?.power_kw?.value ?? null,
      banyakSampahCurrentRefA: profile?.thresholds?.pompa_tersangkut_sampah?.current_a?.value ?? null,
      banyakSampahTorqueRefPct: 90, // From rules.json
      // Dry Run specific
      dryRunPowerFactor: 0.667,
      dryRunCurrentFactor: 0.64,
      dryRunTorqueThresholdPct: 70,
    };

    // VFD config (capability rules from rules.json)
    const vfdConfig: import("./models.ts").VfdConfig = {
      unbalanceThresholdPct: 10,
      undervoltageThresholdV: 360,
      overvoltageThresholdV: 410,
      panelOverheatThresholdC: 60,
    };

    const config: import("./models.ts").ClassificationConfig = {
      flowhead: flowheadConfig,
      vfd: vfdConfig,
      runtime: {
        stagnationLimit: 5,
        outputMode: "poc",
      },
    };

    const validation = validateClassificationConfig(config);
    if (!validation.valid) {
      console.warn("Configuration validation warnings:", validation.errors);
    }

    return config;
  }
}

/**
 * Singleton instance for convenience (used by tests and ClassificationEngine default).
 * Production should inject a proper DB-backed provider.
 */
let _defaultProvider: JsonFileConfigurationProvider | null = null;

export function getDefaultConfigurationProvider(): JsonFileConfigurationProvider {
  if (!_defaultProvider) {
    _defaultProvider = new JsonFileConfigurationProvider();
  }
  return _defaultProvider;
}

export function resetDefaultConfigurationProvider(): void {
  _defaultProvider = null;
}