import assert from "node:assert/strict";
import { test, before, after, describe } from "node:test";

import { loadTestDbConfig } from "../../src/config/db.ts";
import mysql from "mysql2/promise";
import { getPool, closePool } from "../../src/db/pool.ts";
import { runSeed } from "../../scripts/seed-reference.ts";
import { upsertLatest, getLatest } from "../../src/repositories/realtimeRepo.ts";
import { getOrCreate as createPump } from "../../src/repositories/pumpRepo.ts";
import { getIdMap } from "../../src/repositories/parameterRepo.ts";

const hasTestDb = process.env.TEST_DB_HOST && process.env.TEST_DB_NAME?.endsWith("_test");

describe("integration: realtime", { skip: !hasTestDb }, () => {
  let testPool: mysql.Pool;
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
  });

  after(async () => {
    await testPool?.end();
    await closePool();
  });

  test("upsertLatest inserts new reading", async () => {
    const pump = await createPump("test-pump-1");
    const paramDefId = paramIdMap.get("motor_current")!;
    const ts = new Date("2026-01-01T10:00:00.000Z");

    await upsertLatest(pump.id, paramDefId, "123.45", ts);

    const rows = await getLatest(pump.id);
    const row = rows.find(r => r.parameter_definition_id === paramDefId);
    assert.ok(row, "reading should exist");
    assert.equal(row?.value, "123.45");
  });

  test("upsertLatest updates value when newer timestamp", async () => {
    const pump = await createPump("test-pump-2");
    const paramDefId = paramIdMap.get("output_frequency")!;
    const ts1 = new Date("2026-01-01T10:00:00.000Z");
    const ts2 = new Date("2026-01-01T10:00:01.000Z");

    await upsertLatest(pump.id, paramDefId, "40.0", ts1);
    await upsertLatest(pump.id, paramDefId, "39.5", ts2);

    const rows = await getLatest(pump.id);
    const row = rows.find(r => r.parameter_definition_id === paramDefId);
    assert.equal(row?.value, "39.5");
  });

  test("upsertLatest ignores stale timestamp", async () => {
    const pump = await createPump("test-pump-3");
    const paramDefId = paramIdMap.get("motor_speed")!;
    const ts1 = new Date("2026-01-01T10:00:00.000Z");
    const ts2 = new Date("2026-01-01T09:59:59.000Z"); // older

    await upsertLatest(pump.id, paramDefId, "990", ts1);
    await upsertLatest(pump.id, paramDefId, "1000", ts2);

    const rows = await getLatest(pump.id);
    const row = rows.find(r => r.parameter_definition_id === paramDefId);
    assert.equal(row?.value, "990", "stale write should be ignored");
  });
});