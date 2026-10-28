import {
  getPool,
  queryInTransaction,
} from "../db/index.ts";

import type {
  PoolConnection,
} from "mysql2/promise";

import type {
  ClassificationConfig,
  FlowheadConfig,
  VfdConfig,
  EquipmentIdentity,
  ConfigurationProvider,
} from "./models.ts";

import {
  validateClassificationConfig,
} from "./configuration.ts";


// ============================================================================
// DATABASE TYPES
// ============================================================================

// mysql2 secara default membaca DECIMAL sebagai string.
// Provider mendukung representasi string maupun number.

type DbDecimal = string | number;

interface PumpRow {
  pumpId: string;
  flowhead_capacity: DbDecimal | null;
  vsd_type_id: number | null;
}

interface EquipmentConfigRow {
  code: string;
  failure_id: number | string | null;
  failure_code: string | null;
  numeric_value: DbDecimal;
  unit: string;
}

interface RuntimeRow {
  code: string;
  numeric_value: DbDecimal;
  unit: string;
}


// ============================================================================
// CONFIGURATION BINDINGS
// ============================================================================

// Binding menghubungkan code MySQL dengan
// properti yang digunakan Classification Engine.
//
// Nama tampilan (`name`) tidak digunakan sebagai identitas.

type Binding<K extends string> = {
  field: K;
  unit: string;
  failure: string | null;
  percentFactor?: boolean;
};


// ============================================================================
// FLOWHEAD CONFIGURATION BINDINGS
// ============================================================================

const FLOWHEAD_BINDINGS: Record<
  string,
  Binding<keyof FlowheadConfig>
> = {

  // Shared Configuration

  power_ref_kw: {
    field: "powerRefKw",
    unit: "kW",
    failure: null,
  },

  current_ref_a: {
    field: "currentRefA",
    unit: "A",
    failure: null,
  },

  frequency_setpoint_hz: {
    field: "frequencySetpointHz",
    unit: "Hz",
    failure: null,
  },

  rpm_setpoint: {
    field: "rpmSetpoint",
    unit: "RPM",
    failure: null,
  },

  torque_setpoint_pct: {
    field: "torqueSetpointPct",
    unit: "%",
    failure: null,
  },


  // Pompa Tersangkut Sampah

  pts_frequency_hz: {
    field: "ptsFrequencyHz",
    unit: "Hz",
    failure: "pompa_tersangkut_sampah",
  },

  pts_power_ref_kw: {
    field: "ptsPowerRefKw",
    unit: "kW",
    failure: "pompa_tersangkut_sampah",
  },

  pts_current_ref_a: {
    field: "ptsCurrentRefA",
    unit: "A",
    failure: "pompa_tersangkut_sampah",
  },

  pts_torque_ref_pct: {
    field: "ptsTorqueRefPct",
    unit: "%",
    failure: "pompa_tersangkut_sampah",
  },

  pts_rpm_ref: {
    field: "ptsRpmRef",
    unit: "RPM",
    failure: "pompa_tersangkut_sampah",
  },


  // Turbulensi

  turbulensi_power_ref_kw: {
    field: "turbulensiPowerRefKw",
    unit: "kW",
    failure: "turbulensi",
  },

  turbulensi_torque_ref_pct: {
    field: "turbulensiTorqueRefPct",
    unit: "%",
    failure: "turbulensi",
  },

  turbulensi_current_dev_threshold_a: {
    field: "turbulensiCurrentDevThresholdA",
    unit: "A",
    failure: "turbulensi",
  },


  // Banyak Sampah

  banyak_sampah_power_ref_kw: {
    field: "banyakSampahPowerRefKw",
    unit: "kW",
    failure: "banyak_sampah",
  },

  banyak_sampah_current_ref_a: {
    field: "banyakSampahCurrentRefA",
    unit: "A",
    failure: "banyak_sampah",
  },

  banyak_sampah_torque_ref_pct: {
    field: "banyakSampahTorqueRefPct",
    unit: "%",
    failure: "banyak_sampah",
  },


  // Dry Run

  dry_run_power_factor: {
    field: "dryRunPowerFactor",
    unit: "%",
    failure: "dry_run",
    percentFactor: true,
  },

  dry_run_current_factor: {
    field: "dryRunCurrentFactor",
    unit: "%",
    failure: "dry_run",
    percentFactor: true,
  },

  dry_run_torque_threshold_pct: {
    field: "dryRunTorqueThresholdPct",
    unit: "%",
    failure: "dry_run",
  },
};


// ============================================================================
// VSD CONFIGURATION BINDINGS
// ============================================================================

const VSD_BINDINGS: Record<
  string,
  Binding<keyof VfdConfig>
> = {

  unbalance_threshold_pct: {
    field: "unbalanceThresholdPct",
    unit: "%",
    failure: "unbalance",
  },

  undervoltage_threshold_v: {
    field: "undervoltageThresholdV",
    unit: "V",
    failure: "undervoltage",
  },

  overvoltage_threshold_v: {
    field: "overvoltageThresholdV",
    unit: "V",
    failure: "overvoltage",
  },

};

// Panel Overheat sengaja belum dipetakan.
//
// Alasannya:
// - Threshold suhu ambient
// - Threshold control board
// - Threshold inverter
// - Threshold motor
//
// Belum disatukan menjadi kontrak konfigurasi
// yang sesuai dengan evaluator saat ini.


// ============================================================================
// NUMERIC VALIDATION
// ============================================================================

function positiveNumber(
  raw: DbDecimal,
  label: string,
): number {

  if (
    (typeof raw !== "number" &&
      typeof raw !== "string") ||
    String(raw).trim() === ""
  ) {
    throw new Error(
      `${label}: invalid database number`,
    );
  }

  const value = Number(raw);

  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(Math.trunc(value)) ||
    value <= 0
  ) {
    throw new Error(
      `${label}: value must be positive and safely representable`,
    );
  }

  return value;
}


// ============================================================================
// INTEGER VALIDATION
// ============================================================================

function positiveInteger(
  raw: DbDecimal,
  label: string,
): number {

  const value = positiveNumber(raw, label);

  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${label}: expected positive integer`,
    );
  }

  return value;
}


// ============================================================================
// APPLY CONFIGURATION BINDINGS
// ============================================================================

function applyBindings<K extends string>(
  rows: EquipmentConfigRow[],
  bindings: Record<string, Binding<K>>,
  source: string,
  assign: (field: K, value: number) => void,
): void {

  const seen = new Set<string>();

  for (const row of rows) {

    if (seen.has(row.code)) {
      throw new Error(
        `${source}: duplicate code ${row.code}`,
      );
    }

    seen.add(row.code);

    const rule = bindings[row.code];

    // Code baru untuk PoC tidak otomatis
    // menjadi evaluator produksi.
    if (!rule) {
      continue;
    }

    // Validate unit
    if (row.unit !== rule.unit) {
      throw new Error(
        `${source}.${row.code}: expected unit ${rule.unit}, got ${row.unit}`,
      );
    }

    // Validate Failure Ownership
    const invalidOwnership =
      rule.failure === null
        ? row.failure_id !== null
        : row.failure_code !== rule.failure;

    if (invalidOwnership) {
      throw new Error(
        `${source}.${row.code}: failure ownership is inconsistent`,
      );
    }

    const stored = positiveNumber(
      row.numeric_value,
      `${source}.${row.code}`,
    );

    // Persentase Dry Run harus 0 < value <= 100.
    if (rule.percentFactor && stored > 100) {
      throw new Error(
        `${source}.${row.code}: percentage factor must not exceed 100`,
      );
    }

    // Persen menjadi rasio hanya untuk faktor Dry Run.
    const value = rule.percentFactor
      ? stored / 100
      : stored;

    assign(rule.field, value);
  }
}


// ============================================================================
// DEFAULT EMPTY FLOWHEAD CONFIG
// ============================================================================

// Null berarti parameter belum tersedia.
// Tidak menggunakan zero-fill.

function emptyFlowhead(): FlowheadConfig {

  return {
    powerRefKw: null,
    currentRefA: null,
    frequencySetpointHz: null,
    rpmSetpoint: null,
    torqueSetpointPct: null,

    ptsFrequencyHz: null,
    ptsPowerRefKw: null,
    ptsCurrentRefA: null,
    ptsTorqueRefPct: null,
    ptsRpmRef: null,

    turbulensiPowerRefKw: null,
    turbulensiTorqueRefPct: null,
    turbulensiCurrentDevThresholdA: null,
    turbulensiWindow: null,

    banyakSampahPowerRefKw: null,
    banyakSampahCurrentRefA: null,
    banyakSampahTorqueRefPct: null,

    dryRunPowerFactor: null,
    dryRunCurrentFactor: null,
    dryRunTorqueThresholdPct: null,
  };
}


// ============================================================================
// DEFAULT EMPTY VSD CONFIG
// ============================================================================

function emptyVsd(): VfdConfig {

  return {
    unbalanceThresholdPct: null,
    undervoltageThresholdV: null,
    overvoltageThresholdV: null,
    panelOverheatThresholdC: null,
  };
}


// ============================================================================
// PUMP REGISTRY
// ============================================================================

async function loadPump(
  conn: PoolConnection,
  pumpId: string,
): Promise<PumpRow> {

  const sql = `
    SELECT
      pumpId,
      flowhead_capacity,
      vsd_type_id

    FROM pumps

    WHERE pumpId = :pumpId

    LIMIT 1
  `;

  const rows = await queryInTransaction<PumpRow[]>(
    conn,
    sql,
    { pumpId },
  );

  if (!rows[0]) {
    throw new Error(
      `Pump not registered: ${pumpId}`,
    );
  }

  return rows[0];
}


// ============================================================================
// EQUIPMENT CONFIGURATION
// ============================================================================

async function loadEquipmentRows(
  conn: PoolConnection,
  equipment: "flowhead" | "vsd",
  id: number,
): Promise<EquipmentConfigRow[]> {

  const table =
    equipment === "flowhead"
      ? "flowhead_config"
      : "vsd_config";

  const idColumn =
    equipment === "flowhead"
      ? "flowhead_capacity"
      : "vsd_type_id";

  // Nama tabel dan kolom berasal dari pilihan
  // internal, bukan input SQL bebas dari pengguna.

  const sql = `
    SELECT
      c.code,
      c.failure_id,
      f.failure AS failure_code,
      c.numeric_value,
      c.unit

    FROM ${table} AS c

    LEFT JOIN failure_definitions AS f
      ON f.id = c.failure_id

    WHERE c.${idColumn} = :equipmentId
  `;

  return queryInTransaction<EquipmentConfigRow[]>(
    conn,
    sql,
    { equipmentId: id },
  );
}


// ============================================================================
// RUNTIME CONFIGURATION
// ============================================================================

async function loadRuntime(
  conn: PoolConnection,
): Promise<{
  stagnationLimit: number;
  turbulensiWindow: number | null;
}> {

  const sql = `
    SELECT
      code,
      numeric_value,
      unit

    FROM runtime_config

    WHERE code IN (
      'stagnation_limit',
      'turbulensi_window'
    )
  `;

  const rows = await queryInTransaction<RuntimeRow[]>(
    conn,
    sql,
  );

  const config = new Map(
    rows.map((row) => [row.code, row]),
  );

  const parse = (
    code: string,
    unit: string,
    required: boolean,
  ): number | null => {

    const row = config.get(code);

    if (!row) {
      if (required) {
        throw new Error(
          `Missing runtime_config.${code}`,
        );
      }

      return null;
    }

    if (row.unit !== unit) {
      throw new Error(
        `runtime_config.${code}: expected unit ${unit}`,
      );
    }

    return positiveInteger(
      row.numeric_value,
      `runtime_config.${code}`,
    );
  };

  return {
    stagnationLimit:
      parse("stagnation_limit", "count", true)!,

    turbulensiWindow:
      parse("turbulensi_window", "samples", false),
  };
}


// ============================================================================
// DATABASE CONFIGURATION PROVIDER
// ============================================================================

export class DbConfigurationProvider
  implements ConfigurationProvider {

  async resolve(
    identity: EquipmentIdentity,
  ): Promise<ClassificationConfig> {

    const pumpId = identity.pumpId;

    if (
      typeof pumpId !== "string" ||
      !pumpId.trim()
    ) {
      throw new Error(
        "EquipmentIdentity.pumpId must be a non-empty string",
      );
    }

    // Transaction isolation harus diatur
    // sebelum beginTransaction().
    //
    // Pembacaan dalam satu transaksi menggunakan
    // snapshot yang konsisten.
    //
    // Transaksi dikelola lokal pada provider agar
    // db/transaction.ts belum perlu diubah.

    const connection =
      await getPool().getConnection();

    let inTransaction = false;

    try {

      await connection.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      );

      await connection.beginTransaction();

      inTransaction = true;


      // ======================================================
      // STEP 1 — RESOLVE REGISTERED PUMP
      // ======================================================

      const pump = await loadPump(
        connection,
        pumpId,
      );


      // ======================================================
      // STEP 2 — INITIAL CONFIGURATION
      // ======================================================

      const flowhead = emptyFlowhead();
      const vfd = emptyVsd();


      // ======================================================
      // STEP 3 — LOAD RUNTIME CONFIGURATION
      // ======================================================

      const runtime = await loadRuntime(
        connection,
      );


      // ======================================================
      // STEP 4 — RESOLVE FLOWHEAD CONFIGURATION
      // ======================================================

      if (pump.flowhead_capacity !== null) {

        const capacity = positiveInteger(
          pump.flowhead_capacity,
          "pumps.flowhead_capacity",
        );

        const rows = await loadEquipmentRows(
          connection,
          "flowhead",
          capacity,
        );

        applyBindings(
          rows,
          FLOWHEAD_BINDINGS,
          `flowhead_config(${capacity})`,

          (field, value) => {
            flowhead[field] = value;
          },
        );

        // Turbulensi Window sekarang berasal
        // dari runtime_config, bukan Flowhead.

        flowhead.turbulensiWindow =
          runtime.turbulensiWindow;
      }


      // ======================================================
      // STEP 5 — RESOLVE VSD CONFIGURATION
      // ======================================================

      if (pump.vsd_type_id !== null) {

        const vsdId = positiveInteger(
          pump.vsd_type_id,
          "pumps.vsd_type_id",
        );

        const rows = await loadEquipmentRows(
          connection,
          "vsd",
          vsdId,
        );

        applyBindings(
          rows,
          VSD_BINDINGS,
          `vsd_config(${vsdId})`,

          (field, value) => {
            vfd[field] = value;
          },
        );
      }


      // ======================================================
      // STEP 6 — BUILD CLASSIFICATION CONFIG
      // ======================================================

      const config: ClassificationConfig = {

        flowhead,

        vfd,

        runtime: {
          stagnationLimit:
            runtime.stagnationLimit,

          outputMode: "production",
        },
      };


      // ======================================================
      // STEP 7 — VALIDATE CONFIGURATION
      // ======================================================

      const validation =
        validateClassificationConfig(config);

      // Konfigurasi parsial diperbolehkan.
      // Parameter yang tidak ada tetap null.
      //
      // Validasi per Failure pada evaluator
      // akan diselaraskan dalam tahap berikutnya.

      if (!validation.valid) {
        console.warn(
          "[DbConfigurationProvider] Missing/invalid configuration:",
          validation.errors,
        );
      }


      // ======================================================
      // STEP 8 — COMMIT
      // ======================================================

      await connection.commit();

      inTransaction = false;

      return config;

    } catch (error) {

      if (inTransaction) {

        try {
          await connection.rollback();

        } catch (rollbackError) {
          console.error(
            "[DbConfigurationProvider] Rollback failed:",
            rollbackError,
          );
        }
      }

      throw error;

    } finally {

      connection.release();

    }
  }
}


// ============================================================================
// PROVIDER FACTORY
// ============================================================================

export function createDbConfigurationProvider():
  DbConfigurationProvider {

  return new DbConfigurationProvider();
}