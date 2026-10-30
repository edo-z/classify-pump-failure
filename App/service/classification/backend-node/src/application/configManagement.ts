/**
 * DEXMIN — Configuration Management Service
 *
 * Database : MySQL dexmin
 * Schema   : 6 tables
 *
 * Responsibilities:
 * - Read equipment configuration
 * - Update existing configuration values
 * - Validate parameter code, unit, and failure ownership
 * - Resolve effective configuration by registered pump
 * - Preserve decimal precision and configuration identity
 *
 * Not responsible for:
 * - Classification formulas
 * - Authentication / authorization
 * - Next.js Route Handlers
 * - Activating new Failure evaluators
 *
 * IMPORTANT:
 * - No parameter_id
 * - No pump_config
 * - No global_config
 * - No config_parameter_definitions
 * - No hidden fallback or zero-fill
 */

import type { PoolConnection } from "mysql2/promise";

import {
  getPool,
  query,
  queryInTransaction,
  withTransaction,
} from "../db/index.ts";

import {
  ValidationError,
  NotFoundError,
} from "./errors.ts";


// ============================================================================
// TYPES
// ============================================================================

type DbDecimal = string | number;

type EquipmentScope = "flowhead" | "vsd";

type FailureCode =
  | "pompa_tersangkut_sampah"
  | "turbulensi"
  | "banyak_sampah"
  | "unbalance"
  | "undervoltage"
  | "overvoltage"
  | "dry_run"
  | "panel_overheat"
  | "normal";

interface ParameterRule {
  unit: string;
  failure: FailureCode | null;
  required?: boolean;
  integer?: boolean;
  max?: number;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  parsedValue: number | null;
}

export interface PumpRow {
  id: number | string;
  pumpId: string;
  flowhead_capacity: DbDecimal | null;
  vsd_type_id: number | null;
}

export interface FailureDefinitionResponse {
  id: number | string;
  failure: string;
  name: string;
}

export interface ConfigEntry {
  code: string;
  name: string;
  failure_id: number | string | null;
  failure_code: string | null;
  numeric_value: DbDecimal;
  unit: string;
  updated_at: Date | string;
}

export interface FlowheadConfigResponse extends ConfigEntry {
  flowhead_capacity: DbDecimal;
  source: "flowhead";
}

export interface VfdConfigResponse extends ConfigEntry {
  vsd_type_id: number;
  source: "vsd";
}

export interface RuntimeConfigResponse {
  code: string;
  numeric_value: DbDecimal;
  unit: string;
  updated_at: Date | string;
  source: "runtime";
}

export interface EffectiveConfigResponse {
  pump: PumpRow;
  flowhead: FlowheadConfigResponse[];
  vfd: VfdConfigResponse[];
  runtime: RuntimeConfigResponse[];
  missing: string[];
}

export interface UpdateConfigResponse {
  code: string;
  effective_value: number;
  source: "flowhead" | "vfd" | "runtime";
}

interface DbConfigRow {
  code: string;
  name: string;
  failure_id: number | string | null;
  failure_code: string | null;
  numeric_value: DbDecimal;
  unit: string;
  updated_at: Date | string;
}

interface DbPumpRow extends PumpRow {}


// ============================================================================
// PARAMETER CONTRACT
// ============================================================================

/**
 * Daftar kode parameter yang diizinkan untuk perubahan nilai.
 *
 * Code adalah identitas mesin.
 * Name adalah label tampilan di database.
 *
 * Runtime dan Panel Overheat dipisahkan sesuai kontrak yang berlaku.
 */

const FLOWHEAD_RULES: Record<string, ParameterRule> = {

  // Shared configuration

  power_ref_kw: {
    unit: "kW",
    failure: null,
  },

  current_ref_a: {
    unit: "A",
    failure: null,
  },

  frequency_setpoint_hz: {
    unit: "Hz",
    failure: null,
    required: true,
  },

  rpm_setpoint: {
    unit: "RPM",
    failure: null,
  },

  torque_setpoint_pct: {
    unit: "%",
    failure: null,
  },


  // Pompa Tersangkut Sampah

  pts_frequency_hz: {
    unit: "Hz",
    failure: "pompa_tersangkut_sampah",
    required: true,
  },

  pts_power_ref_kw: {
    unit: "kW",
    failure: "pompa_tersangkut_sampah",
    required: true,
  },

  pts_current_ref_a: {
    unit: "A",
    failure: "pompa_tersangkut_sampah",
    required: true,
  },

  pts_torque_ref_pct: {
    unit: "%",
    failure: "pompa_tersangkut_sampah",
    required: true,
  },

  pts_rpm_ref: {
    unit: "RPM",
    failure: "pompa_tersangkut_sampah",
    required: true,
  },


  // Turbulensi

  turbulensi_power_ref_kw: {
    unit: "kW",
    failure: "turbulensi",
    required: true,
  },

  turbulensi_torque_ref_pct: {
    unit: "%",
    failure: "turbulensi",
    required: true,
  },

  turbulensi_current_dev_threshold_a: {
    unit: "A",
    failure: "turbulensi",
    required: true,
  },


  // Banyak Sampah

  banyak_sampah_power_ref_kw: {
    unit: "kW",
    failure: "banyak_sampah",
    required: true,
  },

  banyak_sampah_current_ref_a: {
    unit: "A",
    failure: "banyak_sampah",
    required: true,
  },

  banyak_sampah_torque_ref_pct: {
    unit: "%",
    failure: "banyak_sampah",
    required: true,
  },


  // Dry Run

  dry_run_power_factor: {
    unit: "%",
    failure: "dry_run",
    required: true,
    max: 100,
  },

  dry_run_current_factor: {
    unit: "%",
    failure: "dry_run",
    required: true,
    max: 100,
  },

  dry_run_torque_threshold_pct: {
    unit: "%",
    failure: "dry_run",
    required: true,
  },
};


const VSD_RULES: Record<string, ParameterRule> = {

  unbalance_threshold_pct: {
    unit: "%",
    failure: "unbalance",
    required: true,
  },

  undervoltage_threshold_v: {
    unit: "V",
    failure: "undervoltage",
    required: true,
  },

  overvoltage_threshold_v: {
    unit: "V",
    failure: "overvoltage",
    required: true,
  },
};


/**
 * Panel Overheat:
 *
 * Belum dimasukkan sebagai parameter aktif karena threshold
 * setiap sensor suhu masih dalam tahap kajian.
 *
 * Tidak menetapkan threshold sementara.
 */


const RUNTIME_RULES: Record<string, ParameterRule> = {

  stagnation_limit: {
    unit: "count",
    failure: null,
    integer: true,
    required: true,
  },

  turbulensi_window: {
    unit: "samples",
    failure: null,
    integer: true,
    required: true,
  },
};


// ============================================================================
// DATABASE QUERY HELPER
// ============================================================================

async function selectRows<T>(
  sql: string,
  params: unknown[] = [],
  conn?: PoolConnection,
): Promise<T[]> {

  if (conn) {
    return queryInTransaction<T[]>(
      conn,
      sql,
      params,
    );
  }

  return query<T[]>(
    sql,
    params,
  );
}


// ============================================================================
// IDENTITY VALIDATION
// ============================================================================

function validatePositiveInteger(
  value: unknown,
  field: string,
): number {

  const num = Number(value);

  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "") ||
    !Number.isSafeInteger(num) ||
    num <= 0
  ) {
    throw new ValidationError(
      `${field}: must be a positive integer`,
    );
  }

  return num;
}


function validatePumpId(
  value: unknown,
): string {

  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 64
  ) {
    throw new ValidationError(
      "pumpId: must be a non-empty string (max 64 characters)",
    );
  }

  return value;
}


function validateCode(
  code: unknown,
  rules: Record<string, ParameterRule>,
  scope: string,
): {
  code: string;
  rule: ParameterRule;
} {

  if (
    typeof code !== "string" ||
    !Object.prototype.hasOwnProperty.call(rules, code)
  ) {
    throw new ValidationError(
      `${scope}: unsupported parameter code ${String(code)}`,
    );
  }

  return {
    code,
    rule: rules[code]!,
  };
}


// ============================================================================
// NUMERIC VALIDATION
// ============================================================================

/**
 * Validates DECIMAL(18,2) without silent rounding.
 *
 * Examples:
 * 66.70 -> valid
 * 64.00 -> valid
 * 0.667 -> invalid (stored as 66.70 % for Dry Run factor)
 * null  -> invalid
 *
 * Engineering bounds not yet approved are not invented here.
 */

export function validateNumericValue(
  value: unknown,
  param: ParameterRule & { code: string },
): ValidationResult {

  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean"
  ) {
    return {
      valid: false,
      error: `Parameter ${param.code}: numeric_value is required`,
      parsedValue: null,
    };
  }

  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return {
      valid: false,
      error: `Parameter ${param.code}: value must be numeric`,
      parsedValue: null,
    };
  }

  const literal = String(value).trim();

  // Maximum two decimal places, no implicit rounding.
  if (!/^\d+(?:\.\d{1,2})?$/.test(literal)) {
    return {
      valid: false,
      error:
        `Parameter ${param.code}: maximum 2 decimal places allowed`,
      parsedValue: null,
    };
  }

  const num = Number(literal);

  if (
    !Number.isFinite(num) ||
    !Number.isSafeInteger(Math.trunc(num)) ||
    num <= 0
  ) {
    return {
      valid: false,
      error:
        `Parameter ${param.code}: value must be positive and finite`,
      parsedValue: null,
    };
  }

  if (
    param.integer &&
    !Number.isSafeInteger(num)
  ) {
    return {
      valid: false,
      error:
        `Parameter ${param.code}: value must be an integer`,
      parsedValue: null,
    };
  }

  if (
    param.max !== undefined &&
    num > param.max
  ) {
    return {
      valid: false,
      error:
        `Parameter ${param.code}: maximum value is ${param.max} ${param.unit}`,
      parsedValue: null,
    };
  }

  return {
    valid: true,
    parsedValue: num,
  };
}


// ============================================================================
// FAILURE DEFINITIONS
// ============================================================================

export async function getFailureDefinitions(
  conn?: PoolConnection,
): Promise<FailureDefinitionResponse[]> {

  return selectRows<FailureDefinitionResponse>(
    `
      SELECT
        id,
        failure,
        name
      FROM failure_definitions
      ORDER BY id
    `,
    [],
    conn,
  );
}


// ============================================================================
// PUMP REGISTRY
// ============================================================================

export async function getPumps(
  conn?: PoolConnection,
): Promise<PumpRow[]> {

  return selectRows<PumpRow>(
    `
      SELECT
        id,
        pumpId,
        flowhead_capacity,
        vsd_type_id
      FROM pumps
      ORDER BY pumpId
    `,
    [],
    conn,
  );
}


export async function getPumpById(
  pumpId: string,
  conn?: PoolConnection,
): Promise<PumpRow> {

  const validPumpId = validatePumpId(pumpId);

  const rows = await selectRows<DbPumpRow>(
    `
      SELECT
        id,
        pumpId,
        flowhead_capacity,
        vsd_type_id
      FROM pumps
      WHERE pumpId = ?
      LIMIT 1
    `,
    [validPumpId],
    conn,
  );

  if (!rows[0]) {
    throw new NotFoundError(
      `Pump ${validPumpId} not registered`,
    );
  }

  return rows[0];
}


// ============================================================================
// FLOWHEAD CONFIGURATION — READ
// ============================================================================

export async function getFlowheadConfig(
  capacity: number,
  conn?: PoolConnection,
): Promise<FlowheadConfigResponse[]> {

  const validCapacity = validatePositiveInteger(
    capacity,
    "flowhead_capacity",
  );

  const rows = await selectRows<
    DbConfigRow & { flowhead_capacity: DbDecimal }
  >(
    `
      SELECT
        c.flowhead_capacity,
        c.code,
        c.name,
        c.failure_id,
        f.failure AS failure_code,
        c.numeric_value,
        c.unit,
        c.updated_at
      FROM flowhead_config AS c
      LEFT JOIN failure_definitions AS f
        ON f.id = c.failure_id
      WHERE c.flowhead_capacity = ?
      ORDER BY c.code
    `,
    [validCapacity],
    conn,
  );

  return rows.map((row) => ({
    ...row,
    source: "flowhead" as const,
  }));
}


// ============================================================================
// VSD CONFIGURATION — READ
// ============================================================================

export async function getVfdConfig(
  vsdTypeId: number,
  conn?: PoolConnection,
): Promise<VfdConfigResponse[]> {

  const validVsdTypeId = validatePositiveInteger(
    vsdTypeId,
    "vsd_type_id",
  );

  const rows = await selectRows<
    DbConfigRow & { vsd_type_id: number }
  >(
    `
      SELECT
        c.vsd_type_id,
        c.code,
        c.name,
        c.failure_id,
        f.failure AS failure_code,
        c.numeric_value,
        c.unit,
        c.updated_at
      FROM vsd_config AS c
      LEFT JOIN failure_definitions AS f
        ON f.id = c.failure_id
      WHERE c.vsd_type_id = ?
      ORDER BY c.code
    `,
    [validVsdTypeId],
    conn,
  );

  return rows.map((row) => ({
    ...row,
    source: "vsd" as const,
  }));
}


// ============================================================================
// RUNTIME CONFIGURATION — READ
// ============================================================================

export async function getRuntimeConfig(
  conn?: PoolConnection,
): Promise<RuntimeConfigResponse[]> {

  const rows = await selectRows<RuntimeConfigResponse>(
    `
      SELECT
        code,
        numeric_value,
        unit,
        updated_at
      FROM runtime_config
      ORDER BY code
    `,
    [],
    conn,
  );

  return rows.map((row) => ({
    ...row,
    source: "runtime" as const,
  }));
}


// ============================================================================
// CONFIGURATION METADATA VALIDATION
// ============================================================================

interface ExistingEquipmentRow {
  code: string;
  failure_id: number | string | null;
  failure_code: string | null;
  unit: string;
  numeric_value: DbDecimal;
}


function validateOwnership(
  row: ExistingEquipmentRow,
  rule: ParameterRule,
  scope: EquipmentScope,
): void {

  if (row.unit !== rule.unit) {
    throw new ValidationError(
      `${scope}.${row.code}: expected unit ${rule.unit}, got ${row.unit}`,
    );
  }

  if (
    rule.failure === null &&
    row.failure_id !== null
  ) {
    throw new ValidationError(
      `${scope}.${row.code}: shared parameter must have failure_id NULL`,
    );
  }

  if (
    rule.failure !== null &&
    row.failure_code !== rule.failure
  ) {
    throw new ValidationError(
      `${scope}.${row.code}: invalid Failure ownership`,
    );
  }
}


// ============================================================================
// EQUIPMENT CONFIGURATION — UPDATE
// ============================================================================

async function updateEquipmentConfig(
  scope: EquipmentScope,
  equipmentId: number,
  code: string | number,
  value: unknown,
  conn: PoolConnection,
): Promise<UpdateConfigResponse> {

  const rules =
    scope === "flowhead"
      ? FLOWHEAD_RULES
      : VSD_RULES;

  const { code: validCode, rule } = validateCode(
    code,
    rules,
    scope,
  );

  const validated = validateNumericValue(
    value,
    { ...rule, code: validCode },
  );

  if (
    !validated.valid ||
    validated.parsedValue === null
  ) {
    throw new ValidationError(
      validated.error ?? "Invalid numeric value",
    );
  }

  // Table and key are selected internally, never from user SQL.
  const table =
    scope === "flowhead"
      ? "flowhead_config"
      : "vsd_config";

  const idColumn =
    scope === "flowhead"
      ? "flowhead_capacity"
      : "vsd_type_id";

  // Read and lock the existing configuration row.
  // This operation is UPDATE ONLY, not UPSERT.

  const rows = await selectRows<ExistingEquipmentRow>(
    `
      SELECT
        c.code,
        c.failure_id,
        f.failure AS failure_code,
        c.unit,
        c.numeric_value
      FROM ${table} AS c
      LEFT JOIN failure_definitions AS f
        ON f.id = c.failure_id
      WHERE c.${idColumn} = ?
        AND c.code = ?
      FOR UPDATE
    `,
    [equipmentId, validCode],
    conn,
  );

  const existing = rows[0];

  if (!existing) {
    throw new NotFoundError(
      `${scope} configuration not found: ${equipmentId}/${validCode}`,
    );
  }

  validateOwnership(
    existing,
    rule,
    scope,
  );

  // Voltage order consistency:
  // undervoltage threshold must remain below overvoltage.

  if (
    scope === "vsd" &&
    (
      validCode === "undervoltage_threshold_v" ||
      validCode === "overvoltage_threshold_v"
    )
  ) {

    const voltageRows = await selectRows<{
      code: string;
      numeric_value: DbDecimal;
    }>(
      `
        SELECT
          code,
          numeric_value
        FROM vsd_config
        WHERE vsd_type_id = ?
          AND code IN (
            'undervoltage_threshold_v',
            'overvoltage_threshold_v'
          )
        ORDER BY code
        FOR UPDATE
      `,
      [equipmentId],
      conn,
    );

    const voltages = new Map(
      voltageRows.map((row) => [
        row.code,
        Number(row.numeric_value),
      ]),
    );

    if (
      validCode === "undervoltage_threshold_v"
    ) {
      voltages.set(
        validCode,
        validated.parsedValue,
      );
    }

    if (
      validCode === "overvoltage_threshold_v"
    ) {
      voltages.set(
        validCode,
        validated.parsedValue,
      );
    }

    const uv = voltages.get(
      "undervoltage_threshold_v",
    );

    const ov = voltages.get(
      "overvoltage_threshold_v",
    );

    if (
      uv !== undefined &&
      ov !== undefined &&
      uv >= ov
    ) {
      throw new ValidationError(
        "Undervoltage threshold must be lower than overvoltage threshold",
      );
    }
  }

  await conn.execute(
    `
      UPDATE ${table}
      SET numeric_value = ?
      WHERE ${idColumn} = ?
        AND code = ?
    `,
    [
      validated.parsedValue,
      equipmentId,
      validCode,
    ],
  );

  return {
    code: validCode,
    effective_value: validated.parsedValue,
    source: scope === "flowhead"
      ? "flowhead"
      : "vfd",
  };
}


// ============================================================================
// FLOWHEAD CONFIGURATION — UPDATE
// ============================================================================

export async function updateFlowheadConfig(
  capacity: number,
  code: string | number,
  value: unknown,
  conn?: PoolConnection,
): Promise<UpdateConfigResponse> {

  const validCapacity = validatePositiveInteger(
    capacity,
    "flowhead_capacity",
  );

  if (conn) {
    return updateEquipmentConfig(
      "flowhead",
      validCapacity,
      code,
      value,
      conn,
    );
  }

  return withTransaction(async ({ connection }) => {
    return updateEquipmentConfig(
      "flowhead",
      validCapacity,
      code,
      value,
      connection,
    );
  });
}


// ============================================================================
// VSD CONFIGURATION — UPDATE
// ============================================================================

export async function updateVfdConfig(
  vsdTypeId: number,
  code: string | number,
  value: unknown,
  conn?: PoolConnection,
): Promise<UpdateConfigResponse> {

  const validVsdTypeId = validatePositiveInteger(
    vsdTypeId,
    "vsd_type_id",
  );

  if (conn) {
    return updateEquipmentConfig(
      "vsd",
      validVsdTypeId,
      code,
      value,
      conn,
    );
  }

  return withTransaction(async ({ connection }) => {
    return updateEquipmentConfig(
      "vsd",
      validVsdTypeId,
      code,
      value,
      connection,
    );
  });
}


// ============================================================================
// RUNTIME CONFIGURATION — UPDATE
// ============================================================================

export async function updateRuntimeConfig(
  code: string,
  value: unknown,
  conn?: PoolConnection,
): Promise<UpdateConfigResponse> {

  const { code: validCode, rule } = validateCode(
    code,
    RUNTIME_RULES,
    "runtime",
  );

  const validated = validateNumericValue(
    value,
    { ...rule, code: validCode },
  );

  if (
    !validated.valid ||
    validated.parsedValue === null
  ) {
    throw new ValidationError(
      validated.error ?? "Invalid runtime value",
    );
  }

  const parsedValue = validated.parsedValue;

  const performUpdate = async (
    connection: PoolConnection,
  ): Promise<UpdateConfigResponse> => {

    const rows = await selectRows<{
      code: string;
      unit: string;
    }>(
      `
        SELECT code, unit
        FROM runtime_config
        WHERE code = ?
        FOR UPDATE
      `,
      [validCode],
      connection,
    );

    const existing = rows[0];

    if (!existing) {
      throw new NotFoundError(
        `Runtime configuration not found: ${validCode}`,
      );
    }

    if (existing.unit !== rule.unit) {
      throw new ValidationError(
        `runtime.${validCode}: expected unit ${rule.unit}`,
      );
    }

    await connection.execute(
      `
        UPDATE runtime_config
        SET numeric_value = ?
        WHERE code = ?
      `,
      [
        parsedValue,
        validCode,
      ],
    );

    return {
      code: validCode,
      effective_value: parsedValue,
      source: "runtime",
    };
  };

  if (conn) {
    return performUpdate(conn);
  }

  return withTransaction(async ({ connection }) => {
    return performUpdate(connection);
  });
}


// ============================================================================
// EFFECTIVE CONFIGURATION
// ============================================================================

/**
 * Effective configuration is resolved from:
 *
 * pumps.pumpId
 *   -> pumps.flowhead_capacity -> flowhead_config
 *   -> pumps.vsd_type_id        -> vsd_config
 *   -> runtime_config
 *
 * No Pump/Global overrides.
 * No zero-fill.
 * No fallback values.
 *
 * Uses one REPEATABLE READ transaction.
 */

export async function getEffectiveConfig(
  pumpId: string,
  conn?: PoolConnection,
): Promise<EffectiveConfigResponse> {

  const validPumpId = validatePumpId(pumpId);

  const load = async (
    connection: PoolConnection,
  ): Promise<EffectiveConfigResponse> => {

    // STEP 1 — Resolve registered pump

    const pump = await getPumpById(
      validPumpId,
      connection,
    );

    // STEP 2 — Resolve Flowhead configuration

    const flowhead =
      pump.flowhead_capacity !== null
        ? await getFlowheadConfig(
            validatePositiveInteger(
              pump.flowhead_capacity,
              "pumps.flowhead_capacity",
            ),
            connection,
          )
        : [];

    // STEP 3 — Resolve VSD configuration

    const vfd =
      pump.vsd_type_id !== null
        ? await getVfdConfig(
            pump.vsd_type_id,
            connection,
          )
        : [];

    // STEP 4 — Resolve Runtime configuration

    const runtime = await getRuntimeConfig(
      connection,
    );

    // STEP 5 — Detect missing known configurations

    const missing: string[] = [];

    if (pump.flowhead_capacity === null) {
      missing.push("pumps.flowhead_capacity");
    } else {

      const present = new Set(
        flowhead.map((row) => row.code),
      );

      for (const [code, rule] of Object.entries(
        FLOWHEAD_RULES,
      )) {
        if (rule.required && !present.has(code)) {
          missing.push(`flowhead.${code}`);
        }
      }
    }

    if (pump.vsd_type_id === null) {
      missing.push("pumps.vsd_type_id");
    } else {

      const present = new Set(
        vfd.map((row) => row.code),
      );

      for (const [code, rule] of Object.entries(
        VSD_RULES,
      )) {
        if (rule.required && !present.has(code)) {
          missing.push(`vsd.${code}`);
        }
      }
    }

    const presentRuntime = new Set(
      runtime.map((row) => row.code),
    );

    for (const [code, rule] of Object.entries(
      RUNTIME_RULES,
    )) {
      if (
        rule.required &&
        !presentRuntime.has(code)
      ) {
        missing.push(`runtime.${code}`);
      }
    }

    // Panel Overheat remains pending review.
    // It is intentionally not considered an active
    // configuration requirement in this service.

    return {
      pump,
      flowhead,
      vfd,
      runtime,
      missing,
    };
  };

  // If a transaction connection is supplied,
  // the caller owns its transaction boundary.

  if (conn) {
    return load(conn);
  }

  // Otherwise establish a consistent snapshot.

  const connection = await getPool().getConnection();

  let transactionStarted = false;

  try {

    await connection.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    );

    await connection.beginTransaction();
    transactionStarted = true;

    const result = await load(connection);

    await connection.commit();
    transactionStarted = false;

    return result;

  } catch (error) {

    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "[ConfigManagement] Rollback failed:",
          rollbackError,
        );
      }
    }

    throw error;

  } finally {
    connection.release();
  }
}


// ============================================================================
// LEGACY API GUARDS
// ============================================================================

/**
 * Temporary fail-closed adapters.
 *
 * These exports remain only so existing Socket.IO handlers
 * do not fail immediately due to missing imports.
 *
 * The old operations are DISABLED.
 *
 * They must be removed when the API handlers are migrated
 * to the new code-based contract.
 */

export type GlobalConfigResponse = never;
export type PumpConfigResponse = never;


export async function getGlobalConfigData(
  _conn?: PoolConnection,
): Promise<never> {

  throw new ValidationError(
    "Legacy Global Configuration API is disabled",
  );
}


export async function getPumpConfigData(
  _pumpId: number,
  _conn?: PoolConnection,
): Promise<never> {

  throw new ValidationError(
    "Legacy Pump Configuration API is disabled",
  );
}


export async function updateGlobalConfig(
  _parameterId: number,
  _value: unknown,
  _conn?: PoolConnection,
): Promise<never> {

  throw new ValidationError(
    "Legacy Global Configuration update is disabled",
  );
}


export async function updatePumpConfig(
  _pumpId: string,
  _parameterId: number,
  _value: unknown,
  _conn?: PoolConnection,
): Promise<never> {

  throw new ValidationError(
    "Legacy Pump Configuration update is disabled",
  );
}