import { getPool, queryInTransaction, withTransaction } from "../db/index.ts";
import type { PoolConnection } from "mysql2/promise";
import type { ClassificationConfig, FlowheadConfig, VfdConfig, EquipmentIdentity, ConfigurationProvider } from "./models.ts";
import { validateClassificationConfig } from "./configuration.ts";

interface ConfigParamDefRow {
  id: number;
  code: string;
  failure_id: number | null;
  fallback_scope: 'FLOWHEAD' | 'VFD' | 'GLOBAL';
  value_kind: 'DECIMAL' | 'INTEGER';
  unit: string;
  min_value: number;
  max_value: number;
}

interface PumpRow {
  id: number;
  dex_pump_id: string;
  flowhead_capacity: number | null;
  vsd_type_id: number | null;
}

interface ConfigValueRow {
  parameter_id: number;
  numeric_value: number;
}

function mapParamToNumber(value: number | null): number | null {
  return value;
}

async function getPumpByDexId(conn: PoolConnection, dexPumpId: string): Promise<PumpRow | null> {
  const sql = `
    SELECT id, dex_pump_id, flowhead_capacity, vsd_type_id
    FROM pumps
    WHERE dex_pump_id = :dexPumpId
  `;
  const rows = await queryInTransaction<PumpRow[]>(conn, sql, { dexPumpId });
  return rows[0] ?? null;
}

async function getAllConfigParams(conn: PoolConnection): Promise<ConfigParamDefRow[]> {
  const sql = `
    SELECT id, code, failure_id, fallback_scope, value_kind, unit, min_value, max_value
    FROM config_parameter_definitions
    ORDER BY fallback_scope, code
  `;
  return queryInTransaction<ConfigParamDefRow[]>(conn, sql);
}

async function getPumpConfigValues(conn: PoolConnection, pumpId: number): Promise<Map<number, number>> {
  const sql = `
    SELECT parameter_id, numeric_value
    FROM pump_config
    WHERE pump_id = :pumpId
  `;
  const rows = await queryInTransaction<ConfigValueRow[]>(conn, sql, { pumpId });
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.parameter_id, row.numeric_value);
  }
  return map;
}

async function getFlowheadConfigValues(conn: PoolConnection, capacity: number): Promise<Map<number, number>> {
  const sql = `
    SELECT parameter_id, numeric_value
    FROM flowhead_config
    WHERE flowhead_capacity = :capacity
  `;
  const rows = await queryInTransaction<ConfigValueRow[]>(conn, sql, { capacity });
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.parameter_id, row.numeric_value);
  }
  return map;
}

async function getVfdConfigValues(conn: PoolConnection, vsdTypeId: number): Promise<Map<number, number>> {
  const sql = `
    SELECT parameter_id, numeric_value
    FROM vfd_config
    WHERE vsd_type_id = :vsdTypeId
  `;
  const rows = await queryInTransaction<ConfigValueRow[]>(conn, sql, { vsdTypeId });
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.parameter_id, row.numeric_value);
  }
  return map;
}

async function getGlobalConfigValues(conn: PoolConnection): Promise<Map<number, number>> {
  const sql = `SELECT parameter_id, numeric_value FROM global_config`;
  const rows = await queryInTransaction<ConfigValueRow[]>(conn, sql);
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.parameter_id, row.numeric_value);
  }
  return map;
}

function getEffectiveValue(
  paramId: number,
  pumpValues: Map<number, number>,
  equipmentValues: Map<number, number>,
  globalValues: Map<number, number>
): number | null {
  if (pumpValues.has(paramId)) return pumpValues.get(paramId)!;
  if (equipmentValues.has(paramId)) return equipmentValues.get(paramId)!;
  if (globalValues.has(paramId)) return globalValues.get(paramId)!;
  return null;
}

function buildFlowheadConfig(
  params: ConfigParamDefRow[],
  pumpValues: Map<number, number>,
  flowheadValues: Map<number, number>,
  globalValues: Map<number, number>
): FlowheadConfig {
  const get = (code: string): number | null => {
    const param = params.find(p => p.code === code && p.fallback_scope === 'FLOWHEAD');
    if (!param) return null;
    return getEffectiveValue(param.id, pumpValues, flowheadValues, globalValues);
  };

  return {
    powerRefKw: get('FH_POWER_REF_KW'),
    currentRefA: get('FH_CURRENT_REF_A'),
    frequencySetpointHz: get('FH_FREQ_SETPOINT_HZ'),
    rpmSetpoint: get('FH_RPM_SETPOINT'),
    torqueSetpointPct: get('FH_TORQUE_SETPOINT_PCT'),
    ptsFrequencyHz: get('PTS_FREQ_HZ'),
    ptsPowerRefKw: get('PTS_POWER_REF_KW'),
    ptsCurrentRefA: get('PTS_CURRENT_REF_A'),
    ptsTorqueRefPct: get('PTS_TORQUE_REF_PCT'),
    ptsRpmRef: get('PTS_RPM_REF'),
    turbulensiPowerRefKw: get('TURB_POWER_REF_KW'),
    turbulensiTorqueRefPct: get('TURB_TORQUE_REF_PCT'),
    turbulensiCurrentDevThresholdA: get('TURB_CURRENT_DEV_A'),
    turbulensiWindow: get('TURB_WINDOW'),
    banyakSampahPowerRefKw: get('BS_POWER_REF_KW'),
    banyakSampahCurrentRefA: get('BS_CURRENT_REF_A'),
    banyakSampahTorqueRefPct: get('BS_TORQUE_REF_PCT'),
    dryRunPowerFactor: get('DR_POWER_FACTOR'),
    dryRunCurrentFactor: get('DR_CURRENT_FACTOR'),
    dryRunTorqueThresholdPct: get('DR_TORQUE_THRESHOLD_PCT'),
  };
}

function buildVfdConfig(
  params: ConfigParamDefRow[],
  pumpValues: Map<number, number>,
  vfdValues: Map<number, number>,
  globalValues: Map<number, number>
): VfdConfig {
  const get = (code: string): number | null => {
    const param = params.find(p => p.code === code && p.fallback_scope === 'VFD');
    if (!param) return null;
    return getEffectiveValue(param.id, pumpValues, vfdValues, globalValues);
  };

  return {
    unbalanceThresholdPct: get('UNB_THRESHOLD_PCT'),
    undervoltageThresholdV: get('UV_THRESHOLD_V'),
    overvoltageThresholdV: get('OV_THRESHOLD_V'),
    panelOverheatThresholdC: get('PO_THRESHOLD_C'),
  };
}

export class DbConfigurationProvider implements ConfigurationProvider {
  async resolve(identity: EquipmentIdentity): Promise<ClassificationConfig> {
    return withTransaction(async ({ connection }) => {
      await queryInTransaction(connection, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      
      const pump = await getPumpByDexId(connection, identity.pumpId);
      if (!pump) {
        throw new Error(`Pump not registered: ${identity.pumpId}`);
      }

      const params = await getAllConfigParams(connection);
      
      const pumpValues = await getPumpConfigValues(connection, pump.id);
      const flowheadValues = pump.flowhead_capacity
        ? await getFlowheadConfigValues(connection, pump.flowhead_capacity)
        : new Map();
      const vfdValues = pump.vsd_type_id
        ? await getVfdConfigValues(connection, pump.vsd_type_id)
        : new Map();
      const globalValues = await getGlobalConfigValues(connection);

      const flowhead = buildFlowheadConfig(params, pumpValues, flowheadValues, globalValues);
      const vfd = buildVfdConfig(params, pumpValues, vfdValues, globalValues);

      const config: ClassificationConfig = {
        flowhead,
        vfd,
        runtime: {
          stagnationLimit: 5,
          outputMode: "production",
        },
      };

      const validation = validateClassificationConfig(config);
      if (!validation.valid) {
        console.warn("[DbConfigurationProvider] Configuration validation warnings:", validation.errors);
      }

      return config;
    });
  }
}

export function createDbConfigurationProvider(): DbConfigurationProvider {
  return new DbConfigurationProvider();
}