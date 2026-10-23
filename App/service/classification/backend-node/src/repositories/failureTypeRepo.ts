import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, queryInTransaction } from "../db/index.ts";

export interface FailureTypeRow {
  id: number;
  failure: string;
  name: string;
}

let failureTypeCache: Map<string, number> | null = null;
let failureTypeListCache: FailureTypeRow[] | null = null;

export async function getAll(conn?: PoolConnection): Promise<FailureTypeRow[]> {
  if (failureTypeListCache) return failureTypeListCache;
  const sql = `SELECT id, failure, name FROM failure_types ORDER BY id`;
  if (conn) {
    const rows = await queryInTransaction<FailureTypeRow[]>(conn, sql);
    failureTypeListCache = rows;
    return rows;
  }
  const rows = await query<FailureTypeRow[]>(sql);
  failureTypeListCache = rows;
  return rows;
}

export async function getIdByCode(code: string, conn?: PoolConnection): Promise<number | null> {
  if (failureTypeCache?.has(code)) return failureTypeCache.get(code) ?? null;
  const sql = `SELECT id FROM failure_types WHERE failure = :code`;
  const params = { code };
  if (conn) {
    const row = await queryInTransaction<{ id: number } | null>(conn, sql, params);
    if (row) {
      if (!failureTypeCache) failureTypeCache = new Map();
      failureTypeCache.set(code, row.id);
      return row.id;
    }
    return null;
  }
  const row = await queryOne<{ id: number }>(sql, params);
  if (row) {
    if (!failureTypeCache) failureTypeCache = new Map();
    failureTypeCache.set(code, row.id);
    return row.id;
  }
  return null;
}

export function clearCache(): void {
  failureTypeCache = null;
  failureTypeListCache = null;
}