import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { getAll, getOrCreate, findByParameter, getIdMap, refreshIdMap, __resetIdMapForTest } from "../../src/repositories/parameterRepo.ts";

test("parameterRepo: getAll returns array", async () => {
  const execute = mock.fn(async () => [[], {}]);
  const query = mock.fn(async () => [[{ id: 1, parameter: "param_a" }, { id: 2, parameter: "param_b" }], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await getAll(conn);
  assert.equal(result.length, 2);
  assert.equal(query.mock.callCount(), 1);
});

test("parameterRepo: getOrCreate inserts new parameter", async () => {
  const execute = mock.fn(async (sql: string) => {
    if (sql.includes("SELECT")) {
      return [[], {}];
    }
    return [{ insertId: 20, affectedRows: 1 }, {}];
  });
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await getOrCreate("new_param", conn);
  assert.equal(result.id, 20);
  assert.equal(result.parameter, "new_param");
  assert.equal(execute.mock.callCount(), 2);
});

test("parameterRepo: findByParameter returns null for unknown", async () => {
  const execute = mock.fn(async () => [[], {}]);
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await findByParameter("unknown", conn);
  assert.equal(result, null);
  assert.equal(execute.mock.callCount(), 1);
});

test("parameterRepo: getIdMap returns Map", () => {
  __resetIdMapForTest();
  const map = getIdMap();
  assert.ok(map instanceof Map);
});

test("parameterRepo: refreshIdMap loads from database", async () => {
  const execute = mock.fn(async () => [[], {}]);
  const query = mock.fn(async () => [[{ id: 1, parameter: "p1" }, { id: 2, parameter: "p2" }], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  await refreshIdMap(conn);
  const map = getIdMap();
  assert.equal(map.get("p1"), 1);
  assert.equal(map.get("p2"), 2);
  assert.equal(query.mock.callCount(), 1);
});