
import type { RowDataPacket } from "mysql2";

import { getPool } from "../db/index.ts";
import { getEffectiveConfig } from "./configManagement.ts";
import { NotFoundError } from "./errors.ts";

interface PumpSetpointRow extends RowDataPacket {
  pumpId: string;
  frequency_setpoint_hz: string | number | null;
}

// Penanda lama yang tidak lagi sesuai dengan
// kepemilikan Frequency Setpoint per Pump ID.
const LEGACY_FREQUENCY_MISSING = new Set([
  "flowhead.frequency_setpoint_hz",
  "flowhead.frequencySetpointHz",
  "frequency_setpoint_hz",
]);

function normalizeFrequency(
  value: string | number | null,
): string | null {
  if (value === null) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    throw new Error(
      "Invalid pumps.frequency_setpoint_hz",
    );
  }

  return String(value);
}

/**
 * Effective Configuration dengan Frequency Setpoint
 * yang berasal dari pumps berdasarkan Pump ID.
 *
 * Tidak melakukan fallback Flowhead atau nilai default.
 * Tidak memodifikasi konfigurasi dalam database.
 */
export async function getEffectiveConfigSynced(
  pumpId: Parameters<typeof getEffectiveConfig>[0],
) {
  // Pertahankan proses existing untuk membaca
  // Flowhead, VSD, Runtime, dan parameter lainnya.
  const effective = await getEffectiveConfig(pumpId);

  // Baca setpoint berdasarkan identitas pompa.
  const [rows] = await getPool().execute<PumpSetpointRow[]>(
    `
    SELECT
      pumpId,
      frequency_setpoint_hz
    FROM pumps
    WHERE pumpId = ?
    LIMIT 1
    `,
    [String(pumpId)],
  );

  const pump = rows[0];

  if (!pump) {
    throw new NotFoundError(
      `Pump ${String(pumpId)} not registered`,
    );
  }

  const frequency = normalizeFrequency(
    pump.frequency_setpoint_hz,
  );

  // Hilangkan setpoint lama dari bagian Flowhead.
  const flowhead = effective.flowhead.filter(
    (item) => item.code !== "frequency_setpoint_hz",
  );

  // Jangan lagi menganggap Frequency Setpoint
  // sebagai missing configuration milik Flowhead.
  const missing = effective.missing.filter(
    (code) => !LEGACY_FREQUENCY_MISSING.has(code),
  );

  return {
    ...effective,

    // Menjaga informasi Pump tetap tersedia
    // untuk frontend existing.
    pump: {
      ...(effective.pump ?? {}),
      frequency_setpoint_hz: frequency,
    },

    // Sumber konfigurasi frekuensi yang benar.
    pump_setpoint: {
      pumpId: pump.pumpId,
      code: "frequency_setpoint_hz",
      numeric_value: frequency,
      unit: "Hz",
      source: "pump" as const,
      configured: frequency !== null,
    },

    flowhead,
    missing,
  };
}
