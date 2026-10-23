import { PoolConnection } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";
import { getPool } from "./pool.ts";

export interface TransactionContext {
  connection: PoolConnection;
}

export async function withTransaction<T>(
  fn: (ctx: TransactionContext) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn({ connection });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function executeInTransaction(
  connection: PoolConnection,
  sql: string,
  params?: unknown
): Promise<ResultSetHeader> {
  const [result] = await connection.execute(sql, params as any);
  return result as ResultSetHeader;
}

export async function queryInTransaction<T = import("mysql2/promise").RowDataPacket[]>(
  connection: PoolConnection,
  sql: string,
  params?: unknown
): Promise<T> {
  const [rows] = await connection.execute(sql, params as any);
  return rows as T;
}