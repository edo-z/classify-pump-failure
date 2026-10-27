import type { PoolConnection } from "mysql2/promise";
import { query, queryOne, queryInTransaction } from "../db/index.ts";

export interface ConfigParameterRow {
  id: number;
  code: string;
  failure_id: number | null;
  fallback_scope: 'FLOWHEAD' | 'VFD' | 'GLOBAL';
  value_kind: 'DECIMAL' | 'INTEGER';
  unit: string;
  min_value: number;
  max_value: number;
  description: string | null;
}

export interface ConfigParameterWithFailure extends ConfigParameterRow {
  failure_code: string | null;
}

export async function getAll(conn?: PoolConnection): Promise<ConfigParameterRow[]> {
  const sql = `
    SELECT id, code, failure_id, fallback_scope, value_kind, unit, min_value, max_value, description
    FROM config_parameter_definitions
    ORDER BY fallback_scope, code
  `;
  if (conn) {
    return queryInTransaction<ConfigParameterRow[]>(conn, sql);
  }
  return query<ConfigParameterRow[]>(sql);
}

export async function getByScope(
  scope: 'FLOWHEAD' | 'VFD' | 'GLOBAL',
  conn?: PoolConnection
): Promise<ConfigParameterRow[]> {
  const sql = `
    SELECT id, code, failure_id, fallback_scope, value_kind, unit, min_value, max_value, description
    FROM config_parameter_definitions
    WHERE fallback_scope = :scope
    ORDER BY code
  `;
  const params = { scope };
  if (conn) {
    return queryInTransaction<ConfigParameterRow[]>(conn, sql, params);
  }
  return query<ConfigParameterRow[]>(sql, params);
}

export async function getByFailureId(
  failureId: number,
  conn?: PoolConnection
): Promise<ConfigParameterRow[]> {
  const sql = `
    SELECT id, code, failure_id, fallback_scope, value_kind, unit, min_value, max_value, description
    FROM config_parameter_definitions
    WHERE failure_id = :failureId
    ORDER BY code
  `;
  const params = { failureId };
  if (conn) {
    return queryInTransaction<ConfigParameterRow[]>(conn, sql, params);
  }
  return query<ConfigParameterRow[]>(sql, params);
}

export async function getByCode(
  code: string,
  conn?: PoolConnection
): Promise<ConfigParameterRow | null> {
  const sql = `
    SELECT id, code, failure_id, fallback_scope, value_kind, unit, min_value, max_value, description
    FROM config_parameter_definitions
    WHERE code = :code
  `;
  const params = { code };
  if (conn) {
    return queryInTransaction<ConfigParameterRow | null>(conn, sql, params);
  }
  return queryOne<ConfigParameterRow>(sql, params);
}

export async function getWithFailureCode(conn?: PoolConnection): Promise<ConfigParameterWithFailure[]> {
  const sql = `
    SELECT cpd.id, cpd.code, cpd.failure_id, cpd.fallback_scope, cpd.value_kind, cpd.unit, 
           cpd.min_value, cpd.max_value, cpd.description,
           fd.failure as failure_code
    FROM config_parameter_definitions cpd
    LEFT JOIN failure_definitions fd ON cpd.failure_id = fd.id
    ORDER BY cpd.fallback_scope, cpd.code
  `;
  if (conn) {
    return queryInTransaction<ConfigParameterWithFailure[]>(conn, sql);
  }
  return query<ConfigParameterWithFailure[]>(sql);
}