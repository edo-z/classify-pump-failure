import type { PoolConnection } from "mysql2/promise";
import { ValidationError, NotFoundError } from "./errors.ts";
import {
  getByCode as getConfigParamByCode,
  type ConfigParameterRow,
} from "../repositories/configParameterRepo.ts";
import {
  getByCapacityWithCodes as getFlowheadConfigByCapacityWithCodes,
  upsert as upsertFlowheadConfig,
  type FlowheadConfigInput,
} from "../repositories/flowheadConfigRepo.ts";
import {
  getByVsdTypeWithCodes as getVfdConfigByVsdTypeWithCodes,
  upsert as upsertVfdConfig,
  type VfdConfigInput,
} from "../repositories/vfdConfigRepo.ts";
import {
  getAllWithCodes as getGlobalConfigWithCodes,
  upsert as upsertGlobalConfig,
  type GlobalConfigInput,
} from "../repositories/globalConfigRepo.ts";
import {
  upsert as upsertPumpConfig,
  type PumpConfigInput,
} from "../repositories/pumpConfigRepo.ts";
import {
  findByDexId as findPumpByDexId,
  type PumpRow,
} from "../repositories/pumpRepo.ts";
import { query, queryInTransaction } from "../db/index.ts";

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  parsedValue: number | null;
}

export function validateNumericValue(
  value: unknown,
  param: ConfigParameterRow
): ValidationResult {
  if (value === null || value === undefined || value === "") {
    return { valid: true, parsedValue: null };
  }

  let num: number;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { valid: true, parsedValue: null };
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      return { valid: false, error: `Parameter ${param.code}: value must be a valid number`, parsedValue: null };
    }
    num = parsed;
  } else {
    return { valid: false, error: `Parameter ${param.code}: value must be a number`, parsedValue: null };
  }

  if (!Number.isFinite(num)) {
    return { valid: false, error: `Parameter ${param.code}: value must be finite`, parsedValue: null };
  }

  if (param.value_kind === "INTEGER" && !Number.isInteger(num)) {
    return { valid: false, error: `Parameter ${param.code}: value must be an integer`, parsedValue: null };
  }

  if (num < param.min_value || num > param.max_value) {
    return { valid: false, error: `Parameter ${param.code}: value must be between ${param.min_value} and ${param.max_value} ${param.unit}`, parsedValue: null };
  }

  return { valid: true, parsedValue: num };
}

export interface FlowheadConfigResponse {
  parameter_id: number;
  code: string;
  failure_id: number | null;
  value_kind: string;
  unit: string;
  min_value: number;
  max_value: number;
  description: string | null;
  numeric_value: number | null;
  source: 'pump' | 'flowhead' | 'global';
}

export interface VfdConfigResponse {
  parameter_id: number;
  code: string;
  failure_id: number | null;
  value_kind: string;
  unit: string;
  min_value: number;
  max_value: number;
  description: string | null;
  numeric_value: number | null;
  source: 'pump' | 'vfd' | 'global';
}

export interface GlobalConfigResponse {
  parameter_id: number;
  code: string;
  failure_id: number | null;
  value_kind: string;
  unit: string;
  min_value: number;
  max_value: number;
  description: string | null;
  numeric_value: number | null;
  source: 'pump' | 'global';
}

export interface PumpConfigResponse {
  parameter_id: number;
  code: string;
  failure_id: number | null;
  fallback_scope: string;
  value_kind: string;
  unit: string;
  min_value: number;
  max_value: number;
  description: string | null;
  numeric_value: number | null;
}

export interface EffectiveConfigResponse {
  pump: PumpRow | null;
  flowhead: FlowheadConfigResponse[];
  vfd: VfdConfigResponse[];
  global: GlobalConfigResponse[];
  missing: string[];
}

export async function getFlowheadConfig(
  capacity: number,
  conn?: PoolConnection
): Promise<FlowheadConfigResponse[]> {
  const rows = await getFlowheadConfigByCapacityWithCodes(capacity, conn);
  return rows.map((r: any) => ({
    parameter_id: r.parameter_id,
    code: r.code,
    failure_id: r.failure_id,
    value_kind: r.value_kind,
    unit: r.unit,
    min_value: r.min_value,
    max_value: r.max_value,
    description: r.description,
    numeric_value: r.numeric_value,
    source: 'flowhead' as const,
  }));
}

export async function getVfdConfig(
  vsdTypeId: number,
  conn?: PoolConnection
): Promise<VfdConfigResponse[]> {
  const rows = await getVfdConfigByVsdTypeWithCodes(vsdTypeId, conn);
  return rows.map((r: any) => ({
    parameter_id: r.parameter_id,
    code: r.code,
    failure_id: r.failure_id,
    value_kind: r.value_kind,
    unit: r.unit,
    min_value: r.min_value,
    max_value: r.max_value,
    description: r.description,
    numeric_value: r.numeric_value,
    source: 'vfd' as const,
  }));
}

export async function getGlobalConfigData(conn?: PoolConnection): Promise<GlobalConfigResponse[]> {
  const rows = await getGlobalConfigWithCodes(conn);
  return rows.map((r: any) => ({
    parameter_id: r.parameter_id,
    code: r.code,
    failure_id: r.failure_id,
    value_kind: r.value_kind,
    unit: r.unit,
    min_value: r.min_value,
    max_value: r.max_value,
    description: r.description,
    numeric_value: r.numeric_value,
    source: 'global' as const,
  }));
}

export async function getPumpConfigData(
  pumpId: number,
  conn?: PoolConnection
): Promise<PumpConfigResponse[]> {
  const rows = conn
    ? await queryInTransaction<any[]>(conn,
      `
      SELECT pc.pump_id, pc.parameter_id, pc.numeric_value, pc.updated_at,
             cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, cpd.min_value, cpd.max_value, cpd.description
      FROM pump_config pc
      JOIN config_parameter_definitions cpd ON pc.parameter_id = cpd.id
      WHERE pc.pump_id = ?
      ORDER BY cpd.code
    `,
      [pumpId]
    )
    : await query<any[]>(
      `
      SELECT pc.pump_id, pc.parameter_id, pc.numeric_value, pc.updated_at,
             cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, cpd.min_value, cpd.max_value, cpd.description
      FROM pump_config pc
      JOIN config_parameter_definitions cpd ON pc.parameter_id = cpd.id
      WHERE pc.pump_id = ?
      ORDER BY cpd.code
    `,
      [pumpId]
    );
  return rows.map((r: any) => ({
    parameter_id: r.parameter_id,
    code: r.code,
    failure_id: r.failure_id,
    fallback_scope: r.fallback_scope,
    value_kind: r.value_kind,
    unit: r.unit,
    min_value: r.min_value,
    max_value: r.max_value,
    description: r.description,
    numeric_value: r.numeric_value,
  }));
}

export async function updateFlowheadConfig(
  capacity: number,
  parameterId: number,
  value: unknown,
  conn?: PoolConnection
): Promise<{ effective_value: number | null; source: 'pump' | 'flowhead' | 'global' }> {
  const paramById = await getConfigParamById(parameterId, conn);
  if (!paramById) throw new ValidationError(`Parameter ID ${parameterId} not found`);
  
  if (paramById.fallback_scope !== 'FLOWHEAD') {
    throw new ValidationError(`Parameter ${paramById.code} is not a FLOWHEAD parameter`);
  }

  const validation = validateNumericValue(value, paramById);
  if (!validation.valid) throw new ValidationError(validation.error!);

  const input: FlowheadConfigInput = {
    flowhead_capacity: capacity,
    parameter_id: parameterId,
    numeric_value: validation.parsedValue,
  };
  await upsertFlowheadConfig(input, conn);

  return { effective_value: validation.parsedValue, source: 'flowhead' };
}

export async function updateVfdConfig(
  vsdTypeId: number,
  parameterId: number,
  value: unknown,
  conn?: PoolConnection
): Promise<{ effective_value: number | null; source: 'pump' | 'vfd' | 'global' }> {
  const paramById = await getConfigParamById(parameterId, conn);
  if (!paramById) throw new ValidationError(`Parameter ID ${parameterId} not found`);
  
  if (paramById.fallback_scope !== 'VFD') {
    throw new ValidationError(`Parameter ${paramById.code} is not a VFD parameter`);
  }

  const validation = validateNumericValue(value, paramById);
  if (!validation.valid) throw new ValidationError(validation.error!);

  const input: VfdConfigInput = {
    vsd_type_id: vsdTypeId,
    parameter_id: parameterId,
    numeric_value: validation.parsedValue,
  };
  await upsertVfdConfig(input, conn);

  return { effective_value: validation.parsedValue, source: 'vfd' };
}

export async function updateGlobalConfig(
  parameterId: number,
  value: unknown,
  conn?: PoolConnection
): Promise<{ effective_value: number | null; source: 'global' }> {
  const paramById = await getConfigParamById(parameterId, conn);
  if (!paramById) throw new ValidationError(`Parameter ID ${parameterId} not found`);
  
  if (paramById.fallback_scope !== 'GLOBAL') {
    throw new ValidationError(`Parameter ${paramById.code} is not a GLOBAL parameter`);
  }

  const validation = validateNumericValue(value, paramById);
  if (!validation.valid) throw new ValidationError(validation.error!);

  const input: GlobalConfigInput = {
    parameter_id: parameterId,
    numeric_value: validation.parsedValue,
  };
  await upsertGlobalConfig(input, conn);

  return { effective_value: validation.parsedValue, source: 'global' };
}

export async function updatePumpConfig(
  dexPumpId: string,
  parameterId: number,
  value: unknown,
  conn?: PoolConnection
): Promise<{ effective_value: number | null; source: 'pump' | 'flowhead' | 'vfd' | 'global' }> {
  const pump = await findPumpByDexId(dexPumpId, conn);
  if (!pump) throw new NotFoundError(`Pump ${dexPumpId} not registered`);

  const paramById = await getConfigParamById(parameterId, conn);
  if (!paramById) throw new ValidationError(`Parameter ID ${parameterId} not found`);

  const validation = validateNumericValue(value, paramById);
  if (!validation.valid) throw new ValidationError(validation.error!);

  const input: PumpConfigInput = {
    pump_id: pump.id,
    parameter_id: parameterId,
    numeric_value: validation.parsedValue,
  };
  await upsertPumpConfig(input, conn);

  return { effective_value: validation.parsedValue, source: 'pump' };
}

async function getConfigParamById(
  parameterId: number,
  conn?: PoolConnection
): Promise<ConfigParameterRow | null> {
  const sql = `
    SELECT id, code, failure_id, fallback_scope, value_kind, unit, min_value, max_value, description
    FROM config_parameter_definitions
    WHERE id = ?
  `;
  const params = [parameterId];
  if (conn) {
    return queryInTransaction<ConfigParameterRow | null>(conn, sql, params);
  }
  return query<ConfigParameterRow | null>(sql, params);
}

function getPumpValue(pumpConfigMap: Map<number, number | null>, paramId: number): number | null {
  const val = pumpConfigMap.get(paramId);
  return val ?? null;
}

function getGlobalValue(globalRows: any[], paramId: number): number | null {
  const globalRow = globalRows.find((g: any) => g.parameter_id === paramId);
  return globalRow?.numeric_value ?? null;
}

export async function getEffectiveConfig(
  dexPumpId: string,
  conn?: PoolConnection
): Promise<EffectiveConfigResponse> {
  const pump = await findPumpByDexId(dexPumpId, conn);
  if (!pump) throw new NotFoundError(`Pump ${dexPumpId} not registered`);

  const flowheadCapacity = pump.flowhead_capacity ?? 0;
  const vsdTypeId = pump.vsd_type_id ?? 0;

  const [flowheadRows, vfdRows, globalRows] = await Promise.all([
    getFlowheadConfigByCapacityWithCodes(flowheadCapacity, conn),
    getVfdConfigByVsdTypeWithCodes(vsdTypeId, conn),
    getGlobalConfigWithCodes(conn),
  ]);

  const pumpConfigRows = conn
    ? await queryInTransaction<any[]>(conn,
      `SELECT parameter_id, numeric_value FROM pump_config WHERE pump_id = ?`,
      [pump.id]
    )
    : await query<any[]>(
      `SELECT parameter_id, numeric_value FROM pump_config WHERE pump_id = ?`,
      [pump.id]
    );
  const pumpConfigMap = new Map(pumpConfigRows.map(r => [r.parameter_id, r.numeric_value]));

  const flowhead = flowheadRows.map((r: any) => {
    const pumpVal = getPumpValue(pumpConfigMap, r.parameter_id);
    let value: number | null = null;
    let source: 'pump' | 'flowhead' | 'global' = 'global';
    
    if (pumpVal !== null) {
      value = pumpVal;
      source = 'pump';
    } else if (r.numeric_value !== null) {
      value = r.numeric_value;
      source = 'flowhead';
    } else {
      const globalVal = getGlobalValue(globalRows, r.parameter_id);
      if (globalVal !== null) {
        value = globalVal;
        source = 'global';
      }
    }
    
    return {
      parameter_id: r.parameter_id,
      code: r.code,
      failure_id: r.failure_id,
      value_kind: r.value_kind,
      unit: r.unit,
      min_value: r.min_value,
      max_value: r.max_value,
      description: r.description,
      numeric_value: value,
      source,
    };
  });

  const vfd = vfdRows.map((r: any) => {
    const pumpVal = getPumpValue(pumpConfigMap, r.parameter_id);
    let value: number | null = null;
    let source: 'pump' | 'vfd' | 'global' = 'global';
    
    if (pumpVal !== null) {
      value = pumpVal;
      source = 'pump';
    } else if (r.numeric_value !== null) {
      value = r.numeric_value;
      source = 'vfd';
    } else {
      const globalVal = getGlobalValue(globalRows, r.parameter_id);
      if (globalVal !== null) {
        value = globalVal;
        source = 'global';
      }
    }
    
    return {
      parameter_id: r.parameter_id,
      code: r.code,
      failure_id: r.failure_id,
      value_kind: r.value_kind,
      unit: r.unit,
      min_value: r.min_value,
      max_value: r.max_value,
      description: r.description,
      numeric_value: value,
      source,
    };
  });

  const global = globalRows.map((r: any) => {
    const pumpVal = getPumpValue(pumpConfigMap, r.parameter_id);
    let value: number | null = null;
    let source: 'pump' | 'global' = 'global';
    
    if (pumpVal !== null) {
      value = pumpVal;
      source = 'pump';
    } else if (r.numeric_value !== null) {
      value = r.numeric_value;
    }
    
    return {
      parameter_id: r.parameter_id,
      code: r.code,
      failure_id: r.failure_id,
      value_kind: r.value_kind,
      unit: r.unit,
      min_value: r.min_value,
      max_value: r.max_value,
      description: r.description,
      numeric_value: value,
      source,
    };
  });

  const missing = [
    ...flowhead.filter((f: any) => f.numeric_value === null).map((f: any) => f.code),
    ...vfd.filter((v: any) => v.numeric_value === null).map((v: any) => v.code),
    ...global.filter((g: any) => g.numeric_value === null).map((g: any) => g.code),
  ];

  return { pump, flowhead, vfd, global, missing };
}