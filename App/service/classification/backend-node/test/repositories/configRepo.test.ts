import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { get, upsert, merge } from "../../src/repositories/configRepo.ts";

function createMockConn() {
  const execute = mock.fn(async () => ({ insertId: 0, affectedRows: 0 }));
  const query = mock.fn(async () => [] as Array<Record<string, unknown>>);
  const queryOne = mock.fn(async () => null as Record<string, unknown> | null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;
  return { conn, mocks: { execute, query, queryOne, release } };
}

const mockImpl = (fn: unknown, impl: () => unknown) => (fn as { mockImplementation: (impl: () => unknown) => void }).mockImplementation(impl);

test("configRepo: get returns null for missing", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);

  const result = await get(999, conn);
  assert.equal(result, null);
  assert.equal(mocks.queryOne.mock.callCount(), 1);
});

test("configRepo: upsert inserts new config", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.execute, async () => ({ affectedRows: 1, insertId: 0 }));

  await upsert(1, { operating_freq_hz: 40, operating_rpm: 990, operating_torque: 90, ref_power_kw: 400, ref_current_a: 867 }, conn);
  assert.equal(mocks.execute.mock.callCount(), 1);
});

test("configRepo: merge uses existing values for missing fields", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => ({
    pump_id: 1,
    operating_freq_hz: 38,
    operating_rpm: 950,
    operating_torque: 80,
    ref_power_kw: 300,
    ref_current_a: 700,
    updated_at: new Date(),
  }));
  mockImpl(mocks.execute, async () => ({ affectedRows: 1, insertId: 0 }));

  await merge(1, { operating_freq_hz: 40 }, conn);
  assert.equal(mocks.execute.mock.callCount(), 1);
  assert.equal(mocks.queryOne.mock.callCount(), 1);
});