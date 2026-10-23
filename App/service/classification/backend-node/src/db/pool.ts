import mysql from "mysql2/promise";
import { loadDbConfig, loadTestDbConfig } from "../config/db.ts";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    const config = loadDbConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.poolLimit,
      waitForConnections: true,
      queueLimit: 0,
      namedPlaceholders: true,
    });
    console.log("[db] pool created");
  }
  return pool;
}

export function getPoolForTest(): mysql.Pool {
  const config = loadTestDbConfig();
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.poolLimit,
    waitForConnections: true,
    queueLimit: 0,
    namedPlaceholders: true,
  });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[db] pool closed");
  }
}

export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  params?: unknown
): Promise<T> {
  const p = getPool();
  const [rows] = await p.execute(sql, params as any);
  return rows as T;
}

export async function queryOne<T = mysql.RowDataPacket>(
  sql: string,
  params?: unknown
): Promise<T | null> {
  const rows = await query<T[]>(sql, params);
  return rows[0] ?? null;
}