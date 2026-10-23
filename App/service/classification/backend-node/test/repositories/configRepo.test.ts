import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { get, upsert, merge } from "../../src/repositories/configRepo.ts";

test("configRepo: get returns null for missing", async () => {
  const execute = mock.fn(async () => [[], {}]);
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await get(999, conn);
  assert.equal(result, null);
  assert.equal(execute.mock.callCount(), 1);
});

test("configRepo: upsert inserts new config", async () => {
  const execute = mock.fn(async () => [[], {}]);
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  await upsert(1, { operating_freq_hz: 40, operating_rpm: 990, operating_torque: 90, ref_power_kw: 400, ref_current_a: 867 }, conn);
  assert.equal(execute.mock.callCount(), 1);
});

test("configRepo: merge uses existing values for missing fields", async () => {
  const execute = mock.fn(async (sql: string) => {
    if (sql.includes("SELECT")) {
      return [[{
        pump_id: 1,
        operating_freq_hz: 38,
        operating_rpm: 950,
        operating_torque: 80,
        ref_power_kw: 300,
        ref_current_a: 700,
        updated_at: new Date(),
      }], {}];
    }
    return [[], {}];
  });
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  await merge(1, { operating_freq_hz: 40 }, conn);
  assert.equal(execute.mock.callCount(), 2); // SELECT + UPDATE
});