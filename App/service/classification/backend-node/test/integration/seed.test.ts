import assert from "node:assert/strict";
import { test, before, after, describe } from "node:test";

import { loadTestDbConfig } from "../../src/config/db.ts";
import mysql from "mysql2/promise";
import { getPool, closePool } from "../../src/db/pool.ts";
import { runSeed } from "../../scripts/seed-reference.ts";
import { getAll as getAllFlowheads } from "../../src/repositories/flowheadRepo.ts";
import { getAll as getAllParameters } from "../../src/repositories/parameterRepo.ts";

const hasTestDb = process.env.TEST_DB_HOST && process.env.TEST_DB_NAME?.endsWith("_test");

describe("integration: seed", { skip: !hasTestDb }, () => {
  let testPool: mysql.Pool;

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
  });

  after(async () => {
    await testPool?.end();
    await closePool();
  });

  test("seed creates flowheads from profile_setpoints.json", async () => {
    await runSeed();
    const flowheads = await getAllFlowheads();
    assert.ok(flowheads.length >= 3, `expected at least 3 flowheads, got ${flowheads.length}`);
    const types = flowheads.map(f => f.type_flowhead).sort();
    assert.deepEqual(types, ["3000_lps", "5000_lps", "500_lps"]);
  });

  test("seed creates 16 canonical parameters", async () => {
    const params = await getAllParameters();
    assert.equal(params.length, 16, `expected 16 parameters, got ${params.length}`);
    const keys = params.map(p => p.parameter).sort();
    assert.deepEqual(keys, [
      "ambient_temperature",
      "arus_rms_u",
      "arus_rms_v",
      "arus_rms_w",
      "control_board_temperature",
      "flux_actual",
      "hours_run",
      "input_voltage",
      "inverter_temperature",
      "motor_current",
      "motor_estimated_temperature",
      "motor_speed",
      "motor_torque",
      "output_frequency",
      "output_power",
      "output_voltage",
    ]);
  });
});