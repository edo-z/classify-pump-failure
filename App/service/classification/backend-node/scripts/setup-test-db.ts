#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTestDbConfig } from "../src/config/db.ts";
import mysql from "mysql2/promise";
import { closePool } from "../src/db/pool.ts";
import { runSeed } from "./seed-reference.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const config = loadTestDbConfig();
  console.log(`[test-db] Setting up test database: ${config.database}`);

  const adminPool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectionLimit: 1,
  });

  try {
    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
    console.log(`[test-db] Database created/verified: ${config.database}`);
  } finally {
    await adminPool.end();
  }

  const schemaPath = path.resolve(__dirname, "../../../schema/dexmin/dexmin.sql");
  let schemaSql = await fs.readFile(schemaPath, "utf-8");
  schemaSql = schemaSql.replace(/USE\s+`dexmin`/g, `USE \`${config.database}\``);

  const testPool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 5,
    multipleStatements: true,
  });

  try {
    console.log("[test-db] Applying schema...");
    await testPool.query(schemaSql);
    console.log("[test-db] Schema applied successfully");

    process.env.DB_HOST = config.host;
    process.env.DB_PORT = String(config.port);
    process.env.DB_USER = config.user;
    process.env.DB_PASSWORD = config.password;
    process.env.DB_NAME = config.database;
    process.env.DB_POOL_LIMIT = String(config.poolLimit);
    process.env.REALTIME_RETRY_BASE_MS = String(config.retryBaseMs);
    process.env.REALTIME_RETRY_MAX_MS = String(config.retryMaxMs);
    process.env.REALTIME_RETRY_BUFFER_MAX = String(config.retryBufferMax);

    await runSeed();

    console.log("[test-db] Test database setup completed successfully");
  } catch (e) {
    console.error("[test-db] Error:", e);
    throw e;
  } finally {
    await testPool.end();
    await closePool();
  }
}

main().catch(async (err) => {
  console.error("[test-db] Fatal error:", err);
  await closePool();
  process.exit(1);
});