import type { PoolConnection } from "mysql2/promise";
import { executeInTransaction, query, queryOne, queryInTransaction } from "../db/index.ts";

export interface GlobalConfigRow {
  parameter_id: number;
  numeric_value: number | null;
  updated_at: Date;
}

export interface GlobalConfigInput {
  parameter_id: number;
  numeric_value: number | null;
}

export async function getAll(conn?: PoolConnection): Promise<GlobalConfigRow[]> {
  const sql = `
    SELECT parameter_id, numeric_value, updated_at
    FROM global_config
    ORDER BY parameter_id
  `;
  if (conn) {
    return queryInTransaction<GlobalConfigRow[]>(conn, sql);
  }
  return query<GlobalConfigRow[]>(sql);
}

export async function getAllWithCodes(conn?: PoolConnection): Promise<Array<GlobalConfigRow & { code: string; failure_id: number | null; fallback_scope: string; value_kind: string; unit: string; min_value: number; max_value: number }>> {
  const sql = `
    SELECT gc.parameter_id, gc.numeric_value, gc.updated_at,
           cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, cpd.min_value, cpd.max_value
    FROM global_config gc
    JOIN config_parameter_definitions cpd ON gc.parameter_id = cpd.id
    WHERE cpd.fallback_scope = 'GLOBAL'
    ORDER BY cpd.code
  `;
  if (conn) {
    return queryInTransaction(conn, sql);
  }
  return query(sql);
}

export async function upsert(
  input: GlobalConfigInput,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    INSERT INTO global_config (parameter_id, numeric_value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE numeric_value = VALUES(numeric_value)
  `;
  const params = [input.parameter_id, input.numeric_value];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}

export async function deleteValue(
  parameterId: number,
  conn?: PoolConnection
): Promise<void> {
  const sql = `DELETE FROM global_config WHERE parameter_id = ?`;
  const params = [parameterId];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}