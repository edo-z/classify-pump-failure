import type { PoolConnection } from "mysql2/promise";
import { executeInTransaction, query, queryOne, queryInTransaction } from "../db/index.ts";

export interface FlowheadConfigRow {
  flowhead_capacity: number;
  parameter_id: number;
  numeric_value: number | null;
  updated_at: Date;
}

export interface FlowheadConfigInput {
  flowhead_capacity: number;
  parameter_id: number;
  numeric_value: number | null;
}

export async function getByCapacity(
  capacity: number,
  conn?: PoolConnection
): Promise<FlowheadConfigRow[]> {
  const sql = `
    SELECT flowhead_capacity, parameter_id, numeric_value, updated_at
    FROM flowhead_config
    WHERE flowhead_capacity = :capacity
    ORDER BY parameter_id
  `;
  const params = { capacity };
  if (conn) {
    return queryInTransaction<FlowheadConfigRow[]>(conn, sql, params);
  }
  return query<FlowheadConfigRow[]>(sql, params);
}

export async function getByCapacityWithCodes(
  capacity: number,
  conn?: PoolConnection
): Promise<Array<FlowheadConfigRow & { code: string; failure_id: number | null; fallback_scope: string; value_kind: string; unit: string; min_value: number; max_value: number }>> {
  const sql = `
    SELECT fc.flowhead_capacity, fc.parameter_id, fc.numeric_value, fc.updated_at,
           cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, cpd.min_value, cpd.max_value
    FROM flowhead_config fc
    JOIN config_parameter_definitions cpd ON fc.parameter_id = cpd.id
    WHERE fc.flowhead_capacity = :capacity AND cpd.fallback_scope = 'FLOWHEAD'
    ORDER BY cpd.code
  `;
  const params = { capacity };
  if (conn) {
    return queryInTransaction(conn, sql, params);
  }
  return query(sql, params);
}

export async function upsert(
  input: FlowheadConfigInput,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    INSERT INTO flowhead_config (flowhead_capacity, parameter_id, numeric_value)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE numeric_value = VALUES(numeric_value)
  `;
  const params = [input.flowhead_capacity, input.parameter_id, input.numeric_value];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}

export async function deleteValue(
  capacity: number,
  parameterId: number,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    DELETE FROM flowhead_config
    WHERE flowhead_capacity = ? AND parameter_id = ?
  `;
  const params = [capacity, parameterId];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}

export async function getEffectiveForPump(
  pumpId: number,
  flowheadCapacity: number,
  conn?: PoolConnection
): Promise<Map<string, { value: number | null; source: 'pump' | 'flowhead' | 'global' }>> {
  const result = new Map<string, { value: number | null; source: 'pump' | 'flowhead' | 'global' }>();
  
  const sql = `
    SELECT cpd.code, cpd.id as param_id,
           pc.numeric_value as pump_val,
           fc.numeric_value as flowhead_val,
           gc.numeric_value as global_val
    FROM config_parameter_definitions cpd
    LEFT JOIN pump_config pc ON pc.parameter_id = cpd.id AND pc.pump_id = ?
    LEFT JOIN flowhead_config fc ON fc.parameter_id = cpd.id AND fc.flowhead_capacity = ?
    LEFT JOIN global_config gc ON gc.parameter_id = cpd.id
    WHERE cpd.fallback_scope = 'FLOWHEAD'
  `;
  const params = [pumpId, flowheadCapacity];
  const rows = conn
    ? await queryInTransaction<any[]>(conn, sql, params)
    : await query<any[]>(sql, params);
  
  for (const row of rows) {
    let value: number | null = null;
    let source: 'pump' | 'flowhead' | 'global' = 'global';
    
    if (row.pump_val !== null) {
      value = row.pump_val;
      source = 'pump';
    } else if (row.flowhead_val !== null) {
      value = row.flowhead_val;
      source = 'flowhead';
    } else if (row.global_val !== null) {
      value = row.global_val;
      source = 'global';
    }
    
    result.set(row.code, { value, source });
  }
  
  return result;
}