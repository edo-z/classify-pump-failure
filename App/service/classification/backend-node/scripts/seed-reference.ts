#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDbConfig } from "../src/config/db.ts";
import { getPool, closePool } from "../src/db/pool.ts";
import { getOrCreate as createFlowhead, getAll as getAllFlowheads } from "../src/repositories/flowheadRepo.ts";
import { getOrCreate as createParameter, getAll as getAllParameters, refreshIdMap } from "../src/repositories/parameterRepo.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CANONICAL_PARAMETERS = [
  "motor_speed",
  "output_frequency",
  "motor_current",
  "motor_torque",
  "output_power",
  "hours_run",
  "output_voltage",
  "ambient_temperature",
  "control_board_temperature",
  "inverter_temperature",
  "input_voltage",
  "flux_actual",
  "motor_estimated_temperature",
  "arus_rms_u",
  "arus_rms_v",
  "arus_rms_w",
] as const;

export async function loadProfileSetpoints(): Promise<string[]> {
  const filePath = path.resolve(__dirname, "../src/engine/profile_setpoints.json");
  const content = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(content);
  return Object.keys(data).sort();
}

export async function seedFlowheads(): Promise<void> {
  console.log("[seed] Seeding flowheads...");
  const flowheadTypes = await loadProfileSetpoints();
  for (const type of flowheadTypes) {
    const fh = await createFlowhead(type);
    console.log(`[seed]   flowhead: ${fh.type_flowhead} (id=${fh.id})`);
  }
  const all = await getAllFlowheads();
  console.log(`[seed] Total flowheads: ${all.length}`);
}

export async function seedParameters(): Promise<void> {
  console.log("[seed] Seeding parameter definitions...");
  for (const key of CANONICAL_PARAMETERS) {
    const p = await createParameter(key);
    console.log(`[seed]   parameter: ${p.key} (id=${p.id})`);
  }
  const all = await getAllParameters();
  console.log(`[seed] Total parameters: ${all.length}`);
}

export async function runSeed(): Promise<void> {
  console.log("[seed] Starting reference data seed...");
  const config = loadDbConfig();
  console.log(`[seed] Database: ${config.database} @ ${config.host}:${config.port}`);

  await seedFlowheads();
  await seedParameters();
  await refreshIdMap();

  console.log("[seed] Reference data seed completed successfully.");
  await closePool();
}

async function main(): Promise<void> {
  await runSeed();
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(async (err) => {
    console.error("[seed] Error:", err);
    await closePool();
    process.exit(1);
  });
}