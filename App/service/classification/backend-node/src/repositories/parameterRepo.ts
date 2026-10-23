import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, executeInTransaction, queryInTransaction } from "../db/index.ts";

export interface ParameterRow {
  id: number;
  key: string;
}

let paramIdCache: Map<string, number> | null = null;

export async function getAll(conn?: PoolConnection): Promise<ParameterRow[]> {
  const sql = `SELECT id, \`key\` FROM parameter_definitions ORDER BY id`;
  if (conn) {
    return queryInTransaction<ParameterRow[]>(conn, sql);
  }
  return query<ParameterRow[]>(sql);
}

export async function getOrCreate(
  key: string,
  conn?: PoolConnection
): Promise<ParameterRow> {
  const existing = await findByKey(key, conn);
  if (existing) return existing;

  const sql = `INSERT INTO parameter_definitions (\`key\`) VALUES (:key)`;
  const params = { key };
  let result;
  if (conn) {
    result = await executeInTransaction(conn, sql, params);
  } else {
    const [res] = await import("../db/pool.ts").then(m => m.getPool().execute(sql, params));
    result = res as { insertId: number };
  }
  return { id: result.insertId, key };
}

export async function findByKey(
  key: string,
  conn?: PoolConnection
): Promise<ParameterRow | null> {
  const sql = `SELECT id, \`key\` FROM parameter_definitions WHERE \`key\` = :key`;
  const params = { key };
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
  paramIdCache = new Map(rows.map(r => [r.key, r.id]));
}

export function __resetIdMapForTest(): void {
  paramIdCache = null;
}