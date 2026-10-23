import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, executeInTransaction, queryInTransaction } from "../db/index.ts";

export interface ParameterRow {
  id: number;
  parameter: string;
}

let paramIdCache: Map<string, number> | null = null;

export async function getAll(conn?: PoolConnection): Promise<ParameterRow[]> {
  const sql = `SELECT id, parameter FROM parameter_definitions ORDER BY id`;
  if (conn) {
    return queryInTransaction<ParameterRow[]>(conn, sql);
  }
  return query<ParameterRow[]>(sql);
}

export async function getOrCreate(
  parameter: string,
  conn?: PoolConnection
): Promise<ParameterRow> {
  const existing = await findByParameter(parameter, conn);
  if (existing) return existing;

  const sql = `INSERT INTO parameter_definitions (parameter) VALUES (:parameter)`;
  const params = { parameter };
  let result;
  if (conn) {
    result = await executeInTransaction(conn, sql, params);
  } else {
    const [res] = await import("../db/pool.ts").then(m => m.getPool().execute(sql, params));
    result = res as { insertId: number };
  }
  return { id: result.insertId, parameter };
}

export async function findByParameter(
  parameter: string,
  conn?: PoolConnection
): Promise<ParameterRow | null> {
  const sql = `SELECT id, parameter FROM parameter_definitions WHERE parameter = :parameter`;
  const params = { parameter };
  if (conn) {
    const rows = await queryInTransaction<ParameterRow[]>(conn, sql, params);
    return rows[0] ?? null;
  }
  return queryOne<ParameterRow>(sql, params);
}

export function getIdMap(): Map<string, number> {
  if (!paramIdCache) {
    paramIdCache = new Map();
  }
  return paramIdCache;
}

export async function refreshIdMap(conn?: PoolConnection): Promise<void> {
  const rows = await getAll(conn);
  paramIdCache = new Map(rows.map(r => [r.parameter, r.id]));
}

export function __resetIdMapForTest(): void {
  paramIdCache = null;
}