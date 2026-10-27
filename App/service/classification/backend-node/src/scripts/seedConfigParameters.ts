#!/usr/bin/env node
import { getPool, withTransaction, queryInTransaction } from "../db/index.ts";
import { loadDbConfig } from "../config/db.ts";

interface ConfigParamSeed {
  code: string;
  failure: string | null;
  fallback_scope: 'FLOWHEAD' | 'VFD' | 'GLOBAL';
  value_kind: 'DECIMAL' | 'INTEGER';
  unit: string;
  min_value: number;
  max_value: number;
  description: string;
}

const PARAMETERS: ConfigParamSeed[] = [
  { code: 'FH_POWER_REF_KW', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'kW', min_value: 0, max_value: 5000, description: 'Referensi daya untuk Pompa Tersangkut Sampah' },
  { code: 'FH_CURRENT_REF_A', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'A', min_value: 0, max_value: 2000, description: 'Referensi arus untuk Pompa Tersangkut Sampah' },
  { code: 'FH_FREQ_SETPOINT_HZ', failure: null, fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'Hz', min_value: 0, max_value: 60, description: 'Setpoint frekuensi operasi' },
  { code: 'FH_RPM_SETPOINT', failure: null, fallback_scope: 'FLOWHEAD', value_kind: 'INTEGER', unit: 'RPM', min_value: 0, max_value: 3600, description: 'Setpoint putaran motor' },
  { code: 'FH_TORQUE_SETPOINT_PCT', failure: null, fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: '%', min_value: 0, max_value: 200, description: 'Setpoint torsi motor' },
  { code: 'PTS_FREQ_HZ', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'Hz', min_value: 0, max_value: 60, description: 'Ambang frekuensi untuk Pompa Tersangkut Sampah (freq <= ini)' },
  { code: 'PTS_POWER_REF_KW', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'kW', min_value: 0, max_value: 5000, description: 'Ambang daya untuk Pompa Tersangkut Sampah (power >= ini)' },
  { code: 'PTS_CURRENT_REF_A', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'A', min_value: 0, max_value: 2000, description: 'Ambang arus untuk Pompa Tersangkut Sampah (current >= ini)' },
  { code: 'PTS_TORQUE_REF_PCT', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: '%', min_value: 0, max_value: 200, description: 'Ambang torsi untuk Pompa Tersangkut Sampah (torque >= ini)' },
  { code: 'PTS_RPM_REF', failure: 'pompa_tersangkut_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'INTEGER', unit: 'RPM', min_value: 0, max_value: 3600, description: 'Ambang RPM untuk Pompa Tersangkut Sampah (rpm >= ini)' },
  { code: 'TURB_POWER_REF_KW', failure: 'turbulensi', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'kW', min_value: 0, max_value: 5000, description: 'Ambang daya untuk Turbulensi (power >= ini)' },
  { code: 'TURB_TORQUE_REF_PCT', failure: 'turbulensi', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: '%', min_value: 0, max_value: 200, description: 'Ambang torsi untuk Turbulensi (torque >= ini)' },
  { code: 'TURB_CURRENT_DEV_A', failure: 'turbulensi', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'A', min_value: 0, max_value: 500, description: 'Ambang deviasi arus untuk Turbulensi (|A-MA| >= ini)' },
  { code: 'TURB_WINDOW', failure: 'turbulensi', fallback_scope: 'FLOWHEAD', value_kind: 'INTEGER', unit: 'samples', min_value: 1, max_value: 100, description: 'Jendela moving average untuk Turbulensi' },
  { code: 'BS_POWER_REF_KW', failure: 'banyak_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'kW', min_value: 0, max_value: 5000, description: 'Ambang daya untuk Banyak Sampah (power >= ini)' },
  { code: 'BS_CURRENT_REF_A', failure: 'banyak_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'A', min_value: 0, max_value: 2000, description: 'Ambang arus untuk Banyak Sampah (current >= ini)' },
  { code: 'BS_TORQUE_REF_PCT', failure: 'banyak_sampah', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: '%', min_value: 0, max_value: 200, description: 'Ambang torsi untuk Banyak Sampah (torque >= ini)' },
  { code: 'DR_POWER_FACTOR', failure: 'dry_run', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'factor', min_value: 0, max_value: 1, description: 'Faktor daya untuk Dry Run (0.667 * ptsPowerRefKw)' },
  { code: 'DR_CURRENT_FACTOR', failure: 'dry_run', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: 'factor', min_value: 0, max_value: 1, description: 'Faktor arus untuk Dry Run (0.64 * ptsCurrentRefA)' },
  { code: 'DR_TORQUE_THRESHOLD_PCT', failure: 'dry_run', fallback_scope: 'FLOWHEAD', value_kind: 'DECIMAL', unit: '%', min_value: 0, max_value: 200, description: 'Ambang torsi untuk Dry Run (torque < ini)' },
  { code: 'UNB_THRESHOLD_PCT', failure: 'unbalance', fallback_scope: 'VFD', value_kind: 'DECIMAL', unit: '%', min_value: 0, max_value: 100, description: 'Ambang unbalance arus (deviasi >= ini)' },
  { code: 'UV_THRESHOLD_V', failure: 'undervoltage', fallback_scope: 'VFD', value_kind: 'INTEGER', unit: 'V', min_value: 0, max_value: 500, description: 'Ambang undervoltage (voltage < ini)' },
  { code: 'OV_THRESHOLD_V', failure: 'overvoltage', fallback_scope: 'VFD', value_kind: 'INTEGER', unit: 'V', min_value: 0, max_value: 500, description: 'Ambang overvoltage (voltage > ini)' },
  { code: 'PO_THRESHOLD_C', failure: 'panel_overheat', fallback_scope: 'VFD', value_kind: 'INTEGER', unit: '°C', min_value: 0, max_value: 150, description: 'Ambang panel overheat (suhu >= ini)' },
];

async function seed() {
  const config = loadDbConfig();
  console.log(`[seed] Connecting to ${config.host}:${config.port}/${config.database}`);
  
  const pool = getPool();
  
  await withTransaction(async ({ connection }) => {
    for (const param of PARAMETERS) {
      let failureId: number | null = null;
      if (param.failure) {
        const rows = await queryInTransaction<{ id: number }[]>(
          connection,
          'SELECT id FROM failure_definitions WHERE failure = ?',
          [param.failure]
        );
        if (rows.length > 0) {
          failureId = rows[0].id;
        } else {
          console.warn(`[seed] Failure not found: ${param.failure}`);
        }
      }

      const sql = `
        INSERT INTO config_parameter_definitions (code, failure_id, fallback_scope, value_kind, unit, min_value, max_value, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          failure_id = VALUES(failure_id),
          fallback_scope = VALUES(fallback_scope),
          value_kind = VALUES(value_kind),
          unit = VALUES(unit),
          min_value = VALUES(min_value),
          max_value = VALUES(max_value),
          description = VALUES(description)
      `;
      await connection.execute(sql, [
        param.code,
        failureId,
        param.fallback_scope,
        param.value_kind,
        param.unit,
        param.min_value,
        param.max_value,
        param.description,
      ]);
      console.log(`[seed] Upserted: ${param.code} (scope: ${param.fallback_scope})`);
    }
    console.log('[seed] Done');
  });

  await pool.end();
  process.exit(0);
}

seed().catch(err => {
  console.error('[seed] Error:', err);
  process.exit(1);
});