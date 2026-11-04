
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool } from "../../../../db/index.ts";
import { NextResponse } from "next/dist/server/web/exports/index.js";
import { canWriteConfiguration } from "../../../../security/configWriteGuard.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureRow = RowDataPacket & {
  id: number;
  failure: string;
  name: string;
};

type CountRow = RowDataPacket & {
  flowhead_count: number;
  vsd_count: number;
};

// Identitas yang digunakan Classification Engine saat ini.
const CORE_FAILURES = new Set([
  "pompa_tersangkut_sampah",
  "turbulensi",
  "banyak_sampah",
  "unbalance",
  "undervoltage",
  "overvoltage",
  "dry_run",
  "panel_overheat",
  "normal",
]);

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function jsonResponse(
  data: unknown,
  init: {
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

// Pembatasan development lokal, BUKAN autentikasi.
// Untuk saat ini domain publik tetap read-only.
function canWrite(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") 
  return canWriteConfiguration(request);

  if (
    process.env.DEXMIN_ENABLE_LOCAL_FAILURE_CRUD !== "1"
  ) {
    return false;
  }

  const host = request.headers.get("host") ?? "";

  if (
    host !== "127.0.0.1:3030" &&
    host !== "localhost:3030"
  ) {
    return false;
  }

  const forwarded = request.headers.get("x-forwarded-host");

  if (forwarded && forwarded !== host) return false;

  const origin = request.headers.get("origin");

  if (origin && origin !== `http://${host}`) {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return false;
  }

  return true;
}

type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body | null> {
  const contentType =
    request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const body: unknown = await request.json();

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return null;
    }

    return body as Body;
  } catch {
    return null;
  }
}

function validId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function validCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9_]{2,63}$/.test(value)
  );
}

function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 100
  );
}

function databaseError(error: unknown) {
  console.error("[Failure Registry]", error);
  return jsonError("Operasi database gagal", 500);
}

function mysqlCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error
  ) {
    return String(error.code);
  }

  return "";
}

// ============================================================
// GET — LIST FAILURE DEFINITIONS
// ============================================================

export async function GET(request: Request) {
  try {
    const [rows] = await getPool().execute<FailureRow[]>(
      `SELECT id, failure, name
       FROM failure_definitions
       ORDER BY id ASC`,
    );

    return NextResponse.json(
      {
        ok: true,
        data: rows,
        capabilities: {
          failureCrud: canWrite(request),
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return databaseError(error);
  }
}

// ============================================================
// POST — CREATE FAILURE
// ============================================================

export async function POST(request: Request) {
  if (!canWrite(request)) {
    return jsonError("Write access tidak diizinkan", 403);
  }

  const body = await readBody(request);

  if (!body) {
    return jsonError("Body JSON tidak valid", 400);
  }

  const failure = body.failure;
  const name = body.name;

  if (!validCode(failure) || !validName(name)) {
    return jsonError(
      "Failure code harus snake_case (3-64 karakter) dan name wajib 1-100 karakter",
      422,
    );
  }

  if (CORE_FAILURES.has(failure)) {
    return jsonError("Failure bawaan sudah terdaftar", 409);
  }

  try {
    const [existing] = await getPool().execute<FailureRow[]>(
      `SELECT id, failure, name
       FROM failure_definitions
       WHERE failure = ?
       LIMIT 1`,
      [failure],
    );

    if (existing.length > 0) {
      return jsonError("Failure code sudah digunakan", 409);
    }

    const [result] = await getPool().execute<ResultSetHeader>(
      `INSERT INTO failure_definitions
       (failure, name)
       VALUES (?, ?)`,
      [failure, name.trim()],
    );

    return NextResponse.json(
      {
        ok: true,
        data: {
          id: result.insertId,
          failure,
          name: name.trim(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (mysqlCode(error) === "ER_DUP_ENTRY") {
      return jsonError("Failure code sudah digunakan", 409);
    }

    return databaseError(error);
  }
}

// ============================================================
// PATCH — UPDATE FAILURE NAME
// ============================================================

export async function PATCH(request: Request) {
  if (!canWrite(request)) {
    return jsonError("Write access tidak diizinkan", 403);
  }

  const body = await readBody(request);

  if (!body) {
    return jsonError("Body JSON tidak valid", 400);
  }

  if (!validId(body.id) || !validName(body.name)) {
    return jsonError("id atau name tidak valid", 422);
  }

  if (body.failure !== undefined) {
    return jsonError(
      "Failure code tidak boleh diubah",
      422,
    );
  }

  try {
    const [rows] = await getPool().execute<FailureRow[]>(
      `SELECT id, failure, name
       FROM failure_definitions
       WHERE id = ?
       LIMIT 1`,
      [body.id],
    );

    if (rows.length === 0) {
      return jsonError("Failure tidak ditemukan", 404);
    }

    const updatedName = body.name.trim();

    await getPool().execute<ResultSetHeader>(
      `UPDATE failure_definitions
       SET name = ?
       WHERE id = ?`,
      [updatedName, body.id],
    );

    return NextResponse.json({
      ok: true,
      data: {
        ...rows[0],
        name: updatedName,
      },
    });
  } catch (error) {
    return databaseError(error);
  }
}

// ============================================================
// DELETE — DELETE NON-CORE, UNREFERENCED FAILURE
// ============================================================

export async function DELETE(request: Request) {
  if (!canWrite(request)) {
    return jsonError("Write access tidak diizinkan", 403);
  }

  const body = await readBody(request);

  if (!body) {
    return jsonError("Body JSON tidak valid", 400);
  }

  if (!validId(body.id)) {
    return jsonError("id tidak valid", 422);
  }

  let connection: PoolConnection | undefined;

  try {
    connection = await getPool().getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute<FailureRow[]>(
      `SELECT id, failure, name
       FROM failure_definitions
       WHERE id = ?
       FOR UPDATE`,
      [body.id],
    );

    const failure = rows[0];

    if (!failure) {
      await connection.rollback();
      return jsonError("Failure tidak ditemukan", 404);
    }

    if (CORE_FAILURES.has(failure.failure)) {
      await connection.rollback();
      return jsonError(
        "Failure bawaan tidak boleh dihapus",
        409,
      );
    }

    const [counts] = await connection.execute<CountRow[]>(
      `SELECT
         (SELECT COUNT(*)
          FROM flowhead_config
          WHERE failure_id = ?) AS flowhead_count,
         (SELECT COUNT(*)
          FROM vsd_config
          WHERE failure_id = ?) AS vsd_count`,
      [failure.id, failure.id],
    );

    const used =
      Number(counts[0]?.flowhead_count ?? 0) +
      Number(counts[0]?.vsd_count ?? 0);

    if (used > 0) {
      await connection.rollback();

      return jsonError(
        "Failure masih digunakan oleh konfigurasi",
        409,
      );
    }

    await connection.execute<ResultSetHeader>(
      `DELETE FROM failure_definitions
       WHERE id = ?`,
      [failure.id],
    );

    await connection.commit();

    return NextResponse.json({
      ok: true,
      data: {
        id: failure.id,
        failure: failure.failure,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => undefined);
    }

    if (
      mysqlCode(error) === "ER_ROW_IS_REFERENCED_2" ||
      mysqlCode(error) === "ER_ROW_IS_REFERENCED"
    ) {
      return jsonError(
        "Failure masih direferensikan oleh data lain",
        409,
      );
    }

    return databaseError(error);
  } finally {
    connection?.release();
  }
}
