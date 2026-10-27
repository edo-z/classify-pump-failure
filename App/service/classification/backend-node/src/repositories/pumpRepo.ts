import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, executeInTransaction, queryInTransaction } from "../db/index.ts";

export interface PumpRow {
  id: number;
  dex_pump_id: string;
  flowhead_capacity: number | null;
  vsd_type_id: number | null;
}

export async function findByDexId(
  dexPumpId: string,
  conn?: PoolConnection
): Promise<PumpRow | null> {
  const sql = `SELECT id, dex_pump_id, flowhead_capacity, vsd_type_id FROM pumps WHERE dex_pump_id = :dexPumpId`;
  const params = { dexPumpId };
  if (conn) {
    const rows = await queryInTransaction<PumpRow[]>(conn, sql, params);
    return rows[0] ?? null;
  }
  return queryOne<PumpRow>(sql, params);
}

export async function getOrCreate(
  dexPumpId: string,
  conn?: PoolConnection
): Promise<PumpRow> {
  const existing = await findByDexId(dexPumpId, conn);
  if (existing) return existing;

  const sql = `INSERT INTO pumps (dex_pump_id) VALUES (:dexPumpId)`;
  const params = { dexPumpId };
  let result;
  if (conn) {
    result = await executeInTransaction(conn, sql, params);
  } else {
    const [res] = await import("../db/pool.ts").then(m => m.getPool().execute(sql, params));
    result = res as { insertId: number };
  }
  return { id: result.insertId, dex_pump_id: dexPumpId, flowhead_capacity: null, vsd_type_id: null };
}

export async function findById(
  pumpId: number,
  conn?: PoolConnection
): Promise<PumpRow | null> {
  const sql = `SELECT id, dex_pump_id, flowhead_capacity, vsd_type_id FROM pumps WHERE id = :pumpId`;
  const params = { pumpId };
  if (conn) {
    const rows = await queryInTransaction<PumpRow[]>(conn, sql, params);
    return rows[0] ?? null;
  }
  return queryOne<PumpRow>(sql, params);
}