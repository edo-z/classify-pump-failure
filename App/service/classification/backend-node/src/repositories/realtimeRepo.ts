import type { PoolConnection } from "mysql2/promise";
import { executeInTransaction, queryInTransaction, query, getPool, withTransaction } from "../db/index.ts";

export interface RealtimeRow {
  id: number;
  pump_id: number;
  parameter_definition_id: number;
  value: string | null;
  updated_at: Date;
}

export interface UpsertItem {
  paramDefId: number;
  value: string;
  eventTimestamp: Date;
}

export async function upsertLatest(
  pumpId: number,
  paramDefId: number,
  value: string,
  eventTimestamp: Date,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    INSERT INTO pump_realtimes (pump_id, parameter_definition_id, value, updated_at)
    VALUES (:pumpId, :paramDefId, :value, :eventTimestamp)
    ON DUPLICATE KEY UPDATE
      value = CASE
        WHEN VALUES(updated_at) >= updated_at THEN VALUES(value)
        ELSE value
      END,
      updated_at = CASE
        WHEN VALUES(updated_at) >= updated_at THEN VALUES(updated_at)
        ELSE updated_at
      END
  `;
  const params = {
    pumpId,
    paramDefId,
    value,
    eventTimestamp: eventTimestamp.toISOString().slice(0, 23).replace("T", " "),
  };
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    const pool = getPool();
    await pool.execute(sql, params);
  }
}

export async function upsertLatestBatch(
  pumpId: number,
  items: UpsertItem[],
  conn?: PoolConnection
): Promise<void> {
  if (items.length === 0) return;
  const run = async (ctx: { connection: PoolConnection }) => {
    for (const item of items) {
      const sql = `
        INSERT INTO pump_realtimes (pump_id, parameter_definition_id, value, updated_at)
        VALUES (:pumpId, :paramDefId, :value, :eventTimestamp)
        ON DUPLICATE KEY UPDATE
          value = CASE
            WHEN VALUES(updated_at) >= updated_at THEN VALUES(value)
            ELSE value
          END,
          updated_at = CASE
            WHEN VALUES(updated_at) >= updated_at THEN VALUES(updated_at)
            ELSE updated_at
          END
      `;
      const params = {
        pumpId,
        paramDefId: item.paramDefId,
        value: item.value,
        eventTimestamp: item.eventTimestamp.toISOString().slice(0, 23).replace("T", " "),
      };
      await executeInTransaction(ctx.connection, sql, params);
    }
  };
  if (conn) {
    await run({ connection: conn });
  } else {
    await withTransaction(run);
  }
}

export async function getLatest(
  pumpId: number,
  conn?: PoolConnection
): Promise<RealtimeRow[]> {
  const sql = `
    SELECT id, pump_id, parameter_definition_id, value, updated_at
    FROM pump_realtimes
    WHERE pump_id = :pumpId
  `;
  const params = { pumpId };
  if (conn) {
    return queryInTransaction<RealtimeRow[]>(conn, sql, params);
  }
  return query<RealtimeRow[]>(sql, params);
}

export async function getLatestForParams(
  pumpId: number,
  paramDefIds: number[],
  conn?: PoolConnection
): Promise<RealtimeRow[]> {
  if (paramDefIds.length === 0) return [];
  const placeholders = paramDefIds.map((_, i) => `:param${i}`).join(",");
  const sql = `
    SELECT id, pump_id, parameter_definition_id, value, updated_at
    FROM pump_realtimes
    WHERE pump_id = :pumpId AND parameter_definition_id IN (${placeholders})
  `;
  const params: Record<string, unknown> = { pumpId };
  paramDefIds.forEach((id, i) => { params[`param${i}`] = id; });
  if (conn) {
    return queryInTransaction<RealtimeRow[]>(conn, sql, params);
  }
  return query<RealtimeRow[]>(sql, params);
}