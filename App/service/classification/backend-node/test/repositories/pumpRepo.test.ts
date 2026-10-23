import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { findByDexId, getOrCreate, findById } from "../../src/repositories/pumpRepo.ts";

test("pumpRepo: findByDexId returns null for missing", async () => {
  const execute = mock.fn(async () => [[], {}]);
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await findByDexId("missing-pump", conn);
  assert.equal(result, null);
  assert.equal(execute.mock.callCount(), 1);
});

test("pumpRepo: getOrCreate inserts new pump", async () => {
  const execute = mock.fn(async (sql: string) => {
    if (sql.includes("SELECT")) {
      return [[], {}];
    }
    return [{ insertId: 10, affectedRows: 1 }, {}];
  });
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await getOrCreate("dex-pump-1", conn);
  assert.equal(result.id, 10);
  assert.equal(result.dex_pump_id, "dex-pump-1");
  assert.equal(execute.mock.callCount(), 2);
});

test("pumpRepo: getOrCreate returns existing", async () => {
  const execute = mock.fn(async () => [[{ id: 5, dex_pump_id: "dex-1" }], {}]);
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await getOrCreate("dex-1", conn);
  assert.equal(result.id, 5);
  assert.equal(result.dex_pump_id, "dex-1");
  assert.equal(execute.mock.callCount(), 1);
});

test("pumpRepo: findById returns pump", async () => {
  const execute = mock.fn(async () => [[{ id: 7, dex_pump_id: "dex-7" }], {}]);
  const query = mock.fn(async () => [[], {}]);
  const queryOne = mock.fn(async () => null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;

  const result = await findById(7, conn);
  assert.equal(result?.id, 7);
  assert.equal(result?.dex_pump_id, "dex-7");
  assert.equal(execute.mock.callCount(), 1);
});