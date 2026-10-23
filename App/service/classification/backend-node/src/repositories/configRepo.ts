import type { PoolConnection } from "mysql2/promise";
import { executeInTransaction, queryOne, queryInTransaction } from "../db/index.ts";

export interface ConfigRow {
  pump_id: number;
  operating_freq_hz: number | null;
  operating_rpm: number | null;
  operating_torque: number | null;
  ref_power_kw: number | null;
  ref_current_a: number | null;
  updated_at: Date;
}

export interface ConfigInput {
  operating_freq_hz?: number | null;
  operating_rpm?: number | null;
  operating_torque?: number | null;
  ref_power_kw?: number | null;
  ref_current_a?: number | null;
}

export async function get(
  pumpId: number,
  conn?: PoolConnection
): Promise<ConfigRow | null> {
  const sql = `
    SELECT pump_id, operating_freq_hz, operating_rpm, operating_torque, ref_power_kw, ref_current_a, updated_at
    FROM failure_config
    WHERE pump_id = :pumpId
  `;
  const params = { pumpId };
  if (conn) {
    return queryInTransaction<ConfigRow | null>(conn, sql, params);
  }
  return queryOne<ConfigRow>(sql, params);
}

export async function upsert(
  pumpId: number,
  input: ConfigInput,
  conn?: PoolConnection
): Promise<void> {
  const sql = `
    INSERT INTO failure_config (pump_id, operating_freq_hz, operating_rpm, operating_torque, ref_power_kw, ref_current_a)
    VALUES (:pumpId, :operating_freq_hz, :operating_rpm, :operating_torque, :ref_power_kw, :ref_current_a)
    ON DUPLICATE KEY UPDATE
      operating_freq_hz = VALUES(operating_freq_hz),
      operating_rpm = VALUES(operating_rpm),
      operating_torque = VALUES(operating_torque),
      ref_power_kw = VALUES(ref_power_kw),
      ref_current_a = VALUES(ref_current_a)
  `;
  const params = { pumpId, ...input };
  if (conn) {
    await executeInTransaction(conn, sql, params);
  } else {
    await import("../db/pool.js").then(m => m.getPool().execute(sql, params));
  }
}

export async function merge(
  pumpId: number,
  partial: Partial<ConfigInput>,
  conn?: PoolConnection
): Promise<void> {
  const existing = await get(pumpId, conn);
  const input: ConfigInput = {
    operating_freq_hz: partial.operating_freq_hz ?? existing?.operating_freq_hz ?? null,
    operating_rpm: partial.operating_rpm ?? existing?.operating_rpm ?? null,
    operating_torque: partial.operating_torque ?? existing?.operating_torque ?? null,
    ref_power_kw: partial.ref_power_kw ?? existing?.ref_power_kw ?? null,
    ref_current_a: partial.ref_current_a ?? existing?.ref_current_a ?? null,
  };
  await upsert(pumpId, input, conn);
}