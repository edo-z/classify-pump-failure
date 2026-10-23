#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applySchema(): Promise<void> {
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = parseInt(process.env.DB_PORT ?? "3306", 10);
  const user = process.env.DB_USER ?? "root";
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_NAME ?? "dexmin";

  console.log(`[apply-schema] Connecting to ${database} @ ${host}:${port}`);

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
  });

  // Ensure database exists
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${database}\``);

  // Read and execute schema
  const schemaPath = path.resolve(__dirname, "../../../schema/dexmin/dexmin.sql");
  const schema = await fs.readFile(schemaPath, "utf-8");

  console.log("[apply-schema] Applying schema...");
  await connection.query(schema);

  console.log("[apply-schema] Schema applied successfully");
  await connection.end();
}

applySchema().catch(async (err) => {
  console.error("[apply-schema] Error:", err);
  process.exit(1);
});