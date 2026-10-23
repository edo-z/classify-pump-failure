import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, executeInTransaction, queryInTransaction } from "../db/index.ts";

export interface FlowheadRow {
  id: number;
  type_flowhead: string;
}

export async function findByType(
  type: string,
  conn?: PoolConnection
): Promise<FlowheadRow | null> {
  const sql = `SELECT id, type_flowhead FROM flowheads WHERE type_flowhead = :type`;
  const params = { type };
  if (conn) {
    const rows = await queryInTransaction<FlowheadRow[]>(conn, sql, params);
    return rows[0] ?? null;
  }
  return queryOne<FlowheadRow>(sql, params);
}

export async function getOrCreate(
  type: string,
  conn?: PoolConnection
): Promise<FlowheadRow> {
  const existing = await findByType(type, conn);
  if (existing) return existing;

  const sql = `INSERT INTO flowheads (type_flowhead) VALUES (:type)`;
  const params = { type };
  let result;
  if (conn) {
    result = await executeInTransaction(conn, sql, params);
  } else {
    const [res] = await import("../db/pool.ts").then(m => m.getPool().execute(sql, params));
    result = res as { insertId: number };
  }
  return { id: result.insertId, type_flowhead: type };
}

export async function getAll(conn?: PoolConnection): Promise<FlowheadRow[]> {
  const sql = `SELECT id, type_flowhead FROM flowheads ORDER BY id`;
  if (conn) {
    return queryInTransaction<FlowheadRow[]>(conn, sql);
  }
  return query<FlowheadRow[]>(sql);
}