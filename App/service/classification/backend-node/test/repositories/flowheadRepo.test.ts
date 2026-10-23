import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { findByType, getOrCreate, getAll } from "../../src/repositories/flowheadRepo.ts";

function createMockConn() {
  const execute = mock.fn(async () => ({ insertId: 0, affectedRows: 0 }));
  const query = mock.fn(async () => [] as Array<Record<string, unknown>>);
  const queryOne = mock.fn(async () => null as Record<string, unknown> | null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;
  return { conn, mocks: { execute, query, queryOne, release } };
}

const mockImpl = (fn: unknown, impl: () => unknown) => (fn as { mockImplementation: (impl: () => unknown) => void }).mockImplementation(impl);

test("flowheadRepo: findByType returns null for missing", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);

  const result = await findByType("nonexistent", conn);
  assert.equal(result, null);
  assert.equal(mocks.queryOne.mock.callCount(), 1);
});

test("flowheadRepo: getOrCreate inserts when missing", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);
  mockImpl(mocks.execute, async () => ({ insertId: 42, affectedRows: 1 }));

  const result = await getOrCreate("test_type", conn);
  assert.equal(result.id, 42);
  assert.equal(result.type_flowhead, "test_type");
  assert.equal(mocks.queryOne.mock.callCount(), 1);
  assert.equal(mocks.execute.mock.callCount(), 1);
});

test("flowheadRepo: getOrCreate returns existing", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => ({ id: 99, type_flowhead: "existing" }));

  const result = await getOrCreate("existing", conn);
  assert.equal(result.id, 99);
  assert.equal(result.type_flowhead, "existing");
  assert.equal(mocks.queryOne.mock.callCount(), 1);
  assert.equal(mocks.execute.mock.callCount(), 0);
});

test("flowheadRepo: getAll returns array", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.query, async () => [{ id: 1, type_flowhead: "a" }, { id: 2, type_flowhead: "b" }]);

  const result = await getAll(conn);
  assert.equal(result.length, 2);
  assert.equal(result[0].type_flowhead, "a");
  assert.equal(mocks.query.mock.callCount(), 1);
});