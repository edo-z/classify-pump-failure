import type { RowDataPacket } from "mysql2";
import { getPool } from "../../../../db/index.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// TYPES
// ============================================================

interface PumpSetpointRow extends RowDataPacket {
  pumpId: string;
  flowhead_capacity: number | string | null;
  vsd_type_id: number | null;
  frequency_setpoint_hz: string | number | null;
}

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

function errorResponse(
  message: string,
  status: number,
): Response {
  return jsonResponse(
    { ok: false, error: message },
    status,
  );
}

// ============================================================
// WRITE GUARD — LOCAL DEVELOPMENT ONLY
// ============================================================

// Ini pembatasan development, bukan autentikasi.
// Jangan digunakan sebagai satu-satunya pengaman
// apabila development server terhubung ke internet.

function canWrite(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  if (
    process.env.DEXMIN_ENABLE_LOCAL_PUMP_SETPOINT_WRITE
      !== "1"
  ) {
    return false;
  }

  const host =
    (request.headers.get("host") ?? "").toLowerCase();

  if (
    host !== "127.0.0.1:3030" &&
    host !== "localhost:3030"
  ) {
    return false;
  }

  const forwardedHost =
    request.headers.get("x-forwarded-host");

  if (
    forwardedHost &&
    forwardedHost.toLowerCase() !== host
  ) {
    return false;
  }

  const forwardedProto =
    request.headers.get("x-forwarded-proto");

  if (forwardedProto && forwardedProto !== "http") {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin && origin !== `http://${host}`) {
    return false;
  }

  const fetchSite =
    request.headers.get("sec-fetch-site");

  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return false;
  }

  return true;
}

// ============================================================
// VALIDATION
// ============================================================

function parsePumpId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const pumpId = value.trim();

  if (!pumpId || pumpId.length > 64) {
    return null;
  }

  return pumpId;
}

function parseFrequency(
  value: unknown,
): string | null | undefined {
  // NULL berarti setpoint belum dikonfigurasi.
  if (value === null) {
    return null;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return undefined;
  }

  const text = String(value).trim();

  // DECIMAL(8,2): maksimal 2 digit desimal.
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return undefined;
  }

  const number = Number(text);

  if (
    !Number.isFinite(number) ||
    number <= 0 ||
    number > 999999.99
  ) {
    return undefined;
  }

  return text;
}

// ============================================================
// DATABASE READER
// ============================================================

async function findPump(
  pumpId: string,
): Promise<PumpSetpointRow | null> {
  const [rows] =
    await getPool().execute<PumpSetpointRow[]>(
      `
      SELECT
        pumpId,
        flowhead_capacity,
        vsd_type_id,
        frequency_setpoint_hz

      FROM pumps

      WHERE pumpId = ?

      LIMIT 1
      `,
      [pumpId],
    );

  return rows[0] ?? null;
}

// ============================================================
// GET — READ SETPOINT BY PUMP ID
// ============================================================

export async function GET(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);

  const pumpId = parsePumpId(
    url.searchParams.get("pumpId"),
  );

  if (!pumpId) {
    return errorResponse(
      "pumpId wajib diisi",
      422,
    );
  }

  try {
    const pump = await findPump(pumpId);

    if (!pump) {
      return errorResponse(
        "Pump tidak ditemukan",
        404,
      );
    }

    return jsonResponse({
      ok: true,
      data: pump,

      capabilities: {
        pumpSetpointWrite: canWrite(request),
      },
    });
  } catch (error) {
    console.error(
      "[PumpSetpoint][GET]",
      error,
    );

    return errorResponse(
      "Gagal membaca konfigurasi pompa",
      500,
    );
  }
}

// ============================================================
// PATCH — SET / UPDATE / CLEAR FREQUENCY SETPOINT
// ============================================================

export async function PATCH(
  request: Request,
): Promise<Response> {
  if (!canWrite(request)) {
    return errorResponse(
      "Write access tidak diizinkan",
      403,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "Body JSON tidak valid",
      400,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return errorResponse(
      "Body harus berupa JSON object",
      400,
    );
  }

  const payload = body as Record<string, unknown>;

  const pumpId = parsePumpId(payload.pumpId);

  if (!pumpId) {
    return errorResponse(
      "pumpId tidak valid",
      422,
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      payload,
      "frequency_setpoint_hz",
    )
  ) {
    return errorResponse(
      "frequency_setpoint_hz wajib disertakan",
      422,
    );
  }

  const frequency = parseFrequency(
    payload.frequency_setpoint_hz,
  );

  if (frequency === undefined) {
    return errorResponse(
      "Frequency Setpoint harus positif, maksimal 2 desimal",
      422,
    );
  }

  const connection =
    await getPool().getConnection();

  let inTransaction = false;

  try {
    await connection.beginTransaction();
    inTransaction = true;

    // Kunci baris pompa selama proses perubahan.
    const [rows] =
      await connection.execute<PumpSetpointRow[]>(
        `
        SELECT
          pumpId,
          flowhead_capacity,
          vsd_type_id,
          frequency_setpoint_hz

        FROM pumps

        WHERE pumpId = ?

        LIMIT 1
        FOR UPDATE
        `,
        [pumpId],
      );

    if (!rows[0]) {
      await connection.rollback();
      inTransaction = false;

      return errorResponse(
        "Pump tidak ditemukan",
        404,
      );
    }

    // Parameter sudah divalidasi.
    // Query tidak mengubah identitas pompa.
    await connection.execute(
      `
      UPDATE pumps

      SET frequency_setpoint_hz = ?

      WHERE pumpId = ?
      `,
      [frequency, pumpId],
    );

    const [updated] =
      await connection.execute<PumpSetpointRow[]>(
        `
        SELECT
          pumpId,
          flowhead_capacity,
          vsd_type_id,
          frequency_setpoint_hz

        FROM pumps

        WHERE pumpId = ?

        LIMIT 1
        `,
        [pumpId],
      );

    await connection.commit();
    inTransaction = false;

    return jsonResponse({
      ok: true,
      data: updated[0],
    });
  } catch (error) {
    if (inTransaction) {
      await connection.rollback().catch(
        () => undefined,
      );
    }

    console.error(
      "[PumpSetpoint][PATCH]",
      error,
    );

    return errorResponse(
      "Gagal menyimpan Frequency Setpoint",
      500,
    );
  } finally {
    connection.release();
  }
}