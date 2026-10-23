import assert from "node:assert/strict";
import { test, before, after, describe } from "node:test";

import { loadTestDbConfig } from "../../src/config/db.ts";
import mysql from "mysql2/promise";
import { getPool, closePool } from "../../src/db/pool.ts";
import {
  initRetryBuffer,
  enqueue,
  processQueue,
  getBufferSize,
  clearBuffer,
} from "../../src/socket/realtimeBuffer.ts";
import { runSeed } from "../../scripts/seed-reference.ts";
import { getOrCreate as createPump } from "../../src/repositories/pumpRepo.ts";
import { getIdMap } from "../../src/repositories/parameterRepo.ts";
import { upsertLatest } from "../../src/repositories/realtimeRepo.ts";

const hasTestDb = process.env.TEST_DB_HOST && process.env.TEST_DB_NAME?.endsWith("_test");

describe("integration: retry buffer", { skip: !hasTestDb }, () => {
  let testPool: import("mysql2/promise").Pool;
  let paramIdMap: Map<string, number>;

  before(async () => {
    const config = loadTestDbConfig();
    testPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 5,
      multipleStatements: true,
    });

    process.env.DB_HOST = config.host;
    process.env.DB_PORT = String(config.port);
    process.env.DB_USER = config.user;
    process.env.DB_PASSWORD = config.password;
    process.env.DB_NAME = config.database;
    process.env.DB_POOL_LIMIT = String(config.poolLimit);

    await runSeed();
    paramIdMap = getIdMap();

    const cfg = loadTestDbConfig();
    initRetryBuffer(cfg);
    clearBuffer();
  });

  after(async () => {
    await closePool();
  });

  test("enqueue and processQueue resolves pending writes", async () => {
    const pump = await createPump("buffer-test-pump-1", null);
    const paramDefId = paramIdMap.get("motor_current")!;
    const ts = new Date("2026-01-01T10:00:00.000Z");

    // Simulate DB failure by enqueueing
    enqueue("buffer-test-pump-1", "motor_current", "150.5", ts);
    assert.equal(getBufferSize(), 1);

    // Process queue - should flush to DB
    await processQueue(
      async (dpId) => await createPump(dpId, null),
      (pKey) => paramIdMap.get(pKey) ?? null,
      async (pId, pDefId, val, t) => {
        await upsertLatest(pId, pDefId, val, t);
      }
    );

    // Buffer should be empty after successful flush
    assert.equal(getBufferSize(), 0);

    // Verify data was written
    const rows = await import("../../src/repositories/realtimeRepo.ts").then(m => m.getLatest(pump.id));
    const row = rows.find(r => r.parameter_definition_id === paramDefId);
    assert.equal(row?.value, "150.5");
  });

  test("buffer evicts oldest entry when full", async () => {
    clearBuffer();
    const cfg = loadTestDbConfig();
    initRetryBuffer(cfg);

    // Fill buffer beyond max
    for (let i = 0; i < cfg.retryBufferMax + 10; i++) {
      enqueue(`pump-${i}`, "motor_current", String(i), new Date());
    }

    // Buffer should be capped at max size
    assert.equal(getBufferSize(), cfg.retryBufferMax);
  });
});