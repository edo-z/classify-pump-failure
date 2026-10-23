import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, executeInTransaction, queryInTransaction } from "../db/index.ts";

export interface PumpRow {
  id: number;
  dex_pump_id: string;
  flowhead_id: number | null;
}

export async function findByDexId(
  dexPumpId: string,
  conn?: PoolConnection
): Promise<PumpRow | null> {
  const sql = `SELECT id, dex_pump_id, flowhead_id FROM pumps WHERE dex_pump_id = :dexPumpId`;
  const params = { dexPumpId };
  if (conn) {
    const rows = await queryInTransaction<PumpRow[]>(conn, sql, params);
    return rows[0] ?? null;
  }
  return queryOne<PumpRow>(sql, params);
}

export async function getOrCreate(
  dexPumpId: string,
  flowheadId: number | null,
  conn?: PoolConnection
): Promise<PumpRow> {
  const existing = await findByDexId(dexPumpId, conn);
  if (existing) return existing;

  const sql = `INSERT INTO pumps (dex_pump_id, flowhead_id) VALUES (:dexPumpId, :flowheadId)`;
  const params = { dexPumpId, flowheadId };
  let result;
  if (conn) {
    result = await executeInTransaction(conn, sql, params);
  } else {
    const [res] = await import("../db/pool.ts").then(m => m.getPool().execute(sql, params));
    result = res as { insertId: number };
  }
  return { id: result.insertId, dex_pump_id: dexPumpId, flowhead_id: flowheadId };
}

export async function setFlowhead(
  pumpId: number,
  flowheadId: number | null,
  conn?: PoolConnection
): Promise<void> {
  const sql = `UPDATE pumps SET flowhead_id = :flowheadId WHERE id = :pumpId`;
  const params = { pumpId, flowheadId };
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    await import("../db/pool.ts").then(m => m.getPool().execute(sql, params));
  }
}

export async function findById(
  pumpId: number,
  conn?: PoolConnection
): Promise<PumpRow | null> {
  const sql = `SELECT id, dex_pump_id, flowhead_id FROM pumps WHERE id = :pumpId`;
  const params = { pumpId };
  if (conn) {
    const rows = await queryInTransaction<PumpRow[]>(conn, sql, params);
    return rows[0] ?? null;
  }
  return queryOne<PumpRow>(sql, params);
}