import assert from "node:assert/strict";
import { test, mock } from "node:test";
import type { PoolConnection } from "mysql2/promise";

import { upsertLatest, getLatest } from "../../src/repositories/realtimeRepo.ts";

function createMockConn() {
  const execute = mock.fn(async () => ({ insertId: 0, affectedRows: 0 }));
  const query = mock.fn(async () => [] as Array<Record<string, unknown>>);
  const queryOne = mock.fn(async () => null as Record<string, unknown> | null);
  const release = mock.fn(async () => {});
  const conn = { execute, query, queryOne, release } as unknown as PoolConnection;
  return { conn, mocks: { execute, query, queryOne, release } };
}

const mockImpl = (fn: unknown, impl: () => unknown) => (fn as { mockImplementation: (impl: () => unknown) => void }).mockImplementation(impl);

test("realtimeRepo: upsertLatest executes insert", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.execute, async () => ({ affectedRows: 1, insertId: 0 }));

  const ts = new Date("2026-01-01T10:00:00.000Z");
  await upsertLatest(1, 5, "42.5", ts, conn);
  assert.equal(mocks.execute.mock.callCount(), 1);
});

test("realtimeRepo: getLatest returns rows", async () => {
  const { conn, mocks } = createMockConn();
  mockImpl(mocks.query, async () => [
    { id: 1, pump_id: 1, parameter_definition_id: 5, value: "42.5", updated_at: new Date() },
  ]);

  const result = await getLatest(1, conn);
  assert.equal(result.length, 1);
  assert.equal(mocks.query.mock.callCount(), 1);
});