import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { findByDexId, getOrCreate, findById } from "../../src/repositories/pumpRepo.ts";

function createMockConn() {
  const execute = mock.fn(async () => ({ insertId: 0, affectedRows: 0 }));
  const query = mock.fn(async () => [] as Array<Record<string, unknown>>);
  const queryOne = mock.fn(async () => null as Record<string, unknown> | null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;
  return { conn, mocks: { execute, query, queryOne, release } };
}

const mockImpl = (fn: unknown, impl: () => unknown) => (fn as { mockImplementation: (impl: () => unknown) => void }).mockImplementation(impl);

test("pumpRepo: findByDexId returns null for missing", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);

  const result = await findByDexId("missing-pump", conn);
  assert.equal(result, null);
  assert.equal(mocks.queryOne.mock.callCount(), 1);
});

test("pumpRepo: getOrCreate inserts new pump", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);
  mockImpl(mocks.execute, async () => ({ insertId: 10, affectedRows: 1 }));

  const result = await getOrCreate("dex-pump-1", conn);
  assert.equal(result.id, 10);
  assert.equal(result.dex_pump_id, "dex-pump-1");
  assert.equal(mocks.queryOne.mock.callCount(), 1);
  assert.equal(mocks.execute.mock.callCount(), 1);
});

test("pumpRepo: getOrCreate returns existing", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => ({ id: 5, dex_pump_id: "dex-1" }));

  const result = await getOrCreate("dex-1", conn);
  assert.equal(result.id, 5);
  assert.equal(result.dex_pump_id, "dex-1");
  assert.equal(mocks.queryOne.mock.callCount(), 1);
  assert.equal(mocks.execute.mock.callCount(), 0);
});

test("pumpRepo: findById returns pump", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => ({ id: 7, dex_pump_id: "dex-7" }));

  const result = await findById(7, conn);
  assert.equal(result?.id, 7);
  assert.equal(result?.dex_pump_id, "dex-7");
  assert.equal(mocks.queryOne.mock.callCount(), 1);
});