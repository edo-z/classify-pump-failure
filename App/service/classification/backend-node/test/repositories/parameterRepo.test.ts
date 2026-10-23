import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { getAll, getOrCreate, findByParameter, getIdMap, refreshIdMap, __resetIdMapForTest } from "../../src/repositories/parameterRepo.ts";

function createMockConn() {
  const execute = mock.fn(async () => ({ insertId: 0, affectedRows: 0 }));
  const query = mock.fn(async () => [] as Array<Record<string, unknown>>);
  const queryOne = mock.fn(async () => null as Record<string, unknown> | null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;
  return { conn, mocks: { execute, query, queryOne, release } };
}

const mockImpl = (fn: unknown, impl: () => unknown) => (fn as { mockImplementation: (impl: () => unknown) => void }).mockImplementation(impl);

test("parameterRepo: getAll returns array", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.query, async () => [{ id: 1, parameter: "param_a" }, { id: 2, parameter: "param_b" }]);

  const result = await getAll(conn);
  assert.equal(result.length, 2);
  assert.equal(mocks.query.mock.callCount(), 1);
});

test("parameterRepo: getOrCreate inserts new parameter", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);
  mockImpl(mocks.execute, async () => ({ insertId: 20, affectedRows: 1 }));

  const result = await getOrCreate("new_param", conn);
  assert.equal(result.id, 20);
  assert.equal(result.parameter, "new_param");
  assert.equal(mocks.queryOne.mock.callCount(), 1);
  assert.equal(mocks.execute.mock.callCount(), 1);
});

test("parameterRepo: findByParameter returns null for unknown", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.queryOne, async () => null);

  const result = await findByParameter("unknown", conn);
  assert.equal(result, null);
  assert.equal(mocks.queryOne.mock.callCount(), 1);
});

test("parameterRepo: getIdMap returns Map", () => {
  __resetIdMapForTest();
  const map = getIdMap();
  assert.ok(map instanceof Map);
});

test("parameterRepo: refreshIdMap loads from database", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.query, async () => [{ id: 1, parameter: "p1" }, { id: 2, parameter: "p2" }]);

  await refreshIdMap(conn);
  const map = getIdMap();
  assert.equal(map.get("p1"), 1);
  assert.equal(map.get("p2"), 2);
  assert.equal(mocks.query.mock.callCount(), 1);
});