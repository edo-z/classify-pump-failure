import type { PoolConnection } from "mysql2/promise";
import { executeInTransaction, query, queryOne, queryInTransaction } from "../db/index.ts";

export interface VfdConfigRow {
  vsd_type_id: number;
  parameter_id: number;
  numeric_value: number | null;
  updated_at: Date;
}

export interface VfdConfigInput {
  vsd_type_id: number;
  parameter_id: number;
  numeric_value: number | null;
}

export async function getByVsdType(
  vsdTypeId: number,
  conn?: PoolConnection
): Promise<VfdConfigRow[]> {
  const sql = `
    SELECT vsd_type_id, parameter_id, numeric_value, updated_at
    FROM vfd_config
    WHERE vsd_type_id = ?
    ORDER BY parameter_id
  `;
  const params = [vsdTypeId];
  if (conn) {
    return queryInTransaction<VfdConfigRow[]>(conn, sql, params);
  }
  return query<VfdConfigRow[]>(sql, params);
}

export async function getByVsdTypeWithCodes(
  vsdTypeId: number,
  conn?: PoolConnection
): Promise<Array<VfdConfigRow & { code: string; failure_id: number | null; fallback_scope: string; value_kind: string; unit: string; min_value: number; max_value: number }>> {
  const sql = `
    SELECT vc.vsd_type_id, vc.parameter_id, vc.numeric_value, vc.updated_at,
           cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, cpd.min_value, cpd.max_value
    FROM vfd_config vc
    JOIN config_parameter_definitions cpd ON vc.parameter_id = cpd.id
    WHERE vc.vsd_type_id = ? AND cpd.fallback_scope = 'VFD'
    ORDER BY cpd.code
  `;
  const params = [vsdTypeId];
  if (conn) {
    return queryInTransaction(conn, sql, params);
  }
  return query(sql, params);
}

export async function upsert(
  input: VfdConfigInput,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    INSERT INTO vfd_config (vsd_type_id, parameter_id, numeric_value)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE numeric_value = VALUES(numeric_value)
  `;
  const params = [input.vsd_type_id, input.parameter_id, input.numeric_value];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}

export async function deleteValue(
  vsdTypeId: number,
  parameterId: number,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    DELETE FROM vfd_config
    WHERE vsd_type_id = ? AND parameter_id = ?
  `;
  const params = [vsdTypeId, parameterId];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}

export async function getEffectiveForPump(
  pumpId: number,
  vsdTypeId: number,
  conn?: PoolConnection
): Promise<Map<string, { value: number | null; source: 'pump' | 'vfd' | 'global' }>> {
  const result = new Map<string, { value: number | null; source: 'pump' | 'vfd' | 'global' }>();
  
  const sql = `
    SELECT cpd.code, cpd.id as param_id,
           pc.numeric_value as pump_val,
           vc.numeric_value as vfd_val,
           gc.numeric_value as global_val
    FROM config_parameter_definitions cpd
    LEFT JOIN pump_config pc ON pc.parameter_id = cpd.id AND pc.pump_id = ?
    LEFT JOIN vfd_config vc ON vc.parameter_id = cpd.id AND vc.vsd_type_id = ?
    LEFT JOIN global_config gc ON gc.parameter_id = cpd.id
    WHERE cpd.fallback_scope = 'VFD'
  `;
  const params = [pumpId, vsdTypeId];
  const rows = conn
    ? await queryInTransaction<any[]>(conn, sql, params)
    : await query<any[]>(sql, params);
  
  for (const row of rows) {
    let value: number | null = null;
    let source: 'pump' | 'vfd' | 'global' = 'global';
    
    if (row.pump_val !== null) {
      value = row.pump_val;
      source = 'pump';
    } else if (row.vfd_val !== null) {
      value = row.vfd_val;
      source = 'vfd';
    } else if (row.global_val !== null) {
      value = row.global_val;
      source = 'global';
    }
    
    result.set(row.code, { value, source });
  }
  
  return result;
}