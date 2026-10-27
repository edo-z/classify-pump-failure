import type { PoolConnection } from "mysql2/promise";
import { executeInTransaction, query, queryOne, queryInTransaction } from "../db/index.ts";

export interface PumpConfigRow {
  pump_id: number;
  parameter_id: number;
  numeric_value: number | null;
  updated_at: Date;
}

export interface PumpConfigInput {
  pump_id: number;
  parameter_id: number;
  numeric_value: number | null;
}

export async function getByPumpId(
  pumpId: number,
  conn?: PoolConnection
): Promise<PumpConfigRow[]> {
  const sql = `
    SELECT pump_id, parameter_id, numeric_value, updated_at
    FROM pump_config
    WHERE pump_id = ?
    ORDER BY parameter_id
  `;
  const params = [pumpId];
  if (conn) {
    return queryInTransaction<PumpConfigRow[]>(conn, sql, params);
  }
  return query<PumpConfigRow[]>(sql, params);
}

export async function getByPumpIdWithCodes(
  pumpId: number,
  conn?: PoolConnection
): Promise<Array<PumpConfigRow & { code: string; failure_id: number | null; fallback_scope: string; value_kind: string; unit: string; min_value: number; max_value: number }>> {
  const sql = `
    SELECT pc.pump_id, pc.parameter_id, pc.numeric_value, pc.updated_at,
           cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, cpd.min_value, cpd.max_value
    FROM pump_config pc
    JOIN config_parameter_definitions cpd ON pc.parameter_id = cpd.id
    WHERE pc.pump_id = ?
    ORDER BY cpd.code
  `;
  const params = [pumpId];
  if (conn) {
    return queryInTransaction(conn, sql, params);
  }
  return query(sql, params);
}

export async function upsert(
  input: PumpConfigInput,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    INSERT INTO pump_config (pump_id, parameter_id, numeric_value)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE numeric_value = VALUES(numeric_value)
  `;
  const params = [input.pump_id, input.parameter_id, input.numeric_value];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}

export async function deleteValue(
  pumpId: number,
  parameterId: number,
  conn?: PoolConnection
): Promise<void> {
  const sql = `DELETE FROM pump_config WHERE pump_id = ? AND parameter_id = ?`;
  const params = [pumpId, parameterId];
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = await import("../db/pool.ts").then(m => m.getPool());
    await pool.execute(sql, params);
  }
}