
/**
 * DEXMIN — Configuration API
 *
 * Stage 7A: GET  — Read Configuration
 * Stage 7B: PATCH — Update Configuration
 *
 * Framework : Next.js App Router
 * Database  : MySQL dexmin
 *
 * No schema modifications.
 * No classification formula modifications.
 * No additional token.
 */

import {
  getPumps,
  getFailureDefinitions,
  getFlowheadConfig,
  getVfdConfig,
  getRuntimeConfig,
  getEffectiveConfig,
  updateFlowheadConfig,
  updateVfdConfig,
  updateRuntimeConfig,
  createFlowheadConfig,
  deleteFlowheadConfig,
  createVfdConfig,
  deleteVfdConfig,
  createRuntimeConfig,
  deleteRuntimeConfig,
  type CreateConfigInput,
} from "../../../../application/configManagement.ts";

import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../application/errors.ts";

// ============================================================
// NEXT.JS CONFIGURATION
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// TYPES
// ============================================================

interface RouteContext {
  params: Promise<{
    resource: string;
  }>;
}

interface UpdatePayload {
  code: string;
  numeric_value: number | string;
}

// ============================================================
// RESPONSE HELPERS
// ============================================================

function success(
  data: unknown,
  status = 200,
): Response {
  return Response.json(
    {
      ok: true,
      data,
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

function failure(
  status: number,
  message: string,
): Response {
  return Response.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

// ============================================================
// REQUEST VALIDATION
// ============================================================

function parsePositiveInteger(
  value: string | null,
  field: string,
): number {

  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new ValidationError(
      `${field}: must be a positive integer`,
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(
      `${field}: exceeds safe integer range`,
    );
  }

  return parsed;
}

function parsePumpId(
  value: string | null,
): string {

  if (
    value === null ||
    value.trim().length === 0 ||
    value.length > 64
  ) {
    throw new ValidationError(
      "pumpId: must be a non-empty string (max 64 characters)",
    );
  }

  return value;
}

// ============================================================
// ERROR HANDLING
// ============================================================

function handleError(
  error: unknown,
): Response {

  if (error instanceof ValidationError) {
    return failure(422, error.message);
  }

  if (error instanceof NotFoundError) {
    return failure(404, error.message);
  }
  if (error instanceof ConflictError) {
    return failure(409, error.message);
  }

  console.error(
    "[DEXMIN Configuration API]",
    error,
  );

  return failure(
    500,
    "Internal server error",
  );
}

// ============================================================
// GET — CONFIGURATION READ API
// ============================================================

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {

  try {

    const { resource } = await context.params;
    const params = new URL(request.url).searchParams;

    switch (resource) {

      case "failures":
        return success(
          await getFailureDefinitions(),
        );

      case "pumps":
        return success(
          await getPumps(),
        );

      case "flowhead": {
        const capacity = parsePositiveInteger(
          params.get("capacity"),
          "capacity",
        );

        return success(
          await getFlowheadConfig(capacity),
        );
      }

      case "vsd": {
        const vsdTypeId = parsePositiveInteger(
          params.get("vsdTypeId"),
          "vsdTypeId",
        );

        return success(
          await getVfdConfig(vsdTypeId),
        );
      }

      case "runtime":
        return success(
          await getRuntimeConfig(),
        );

      case "effective": {
        const pumpId = parsePumpId(
          params.get("pumpId"),
        );

        return success(
          await getEffectiveConfig(pumpId),
        );
      }

      default:
        return failure(
          404,
          `Unknown configuration resource: ${resource}`,
        );
    }

  } catch (error) {
    return handleError(error);
  }
}


/**
 * Local Development Write Guard
 *
 * Stage 7B — DEXMIN Configuration Management
 *
 * Hanya mengizinkan PATCH pada lingkungan development lokal.
 *
 * Tidak menambahkan token.
 * Tidak mengubah database.
 * Tidak menggunakan request.url.host yang dapat
 * berbeda dari Host header dalam runtime Next.js.
 *
 * Ini pembatasan development, bukan autentikasi pengguna.
 */
function isLocalDevelopmentWrite(
  request: Request,
): boolean {

  // PATCH tidak boleh aktif di production.
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  const host = request.headers.get("host");

  const allowedHosts = new Set([
    "127.0.0.1:3030",
    "localhost:3030",
    "https://classify.aldozeno.my.id/config"
  ]);

  if (!host || !allowedHosts.has(host)) {
    return false;
  }

  // Tolak Origin yang berbeda.
  // curl biasanya tidak mengirimkan header Origin.
  const origin = request.headers.get("origin");

  if (
    origin !== null &&
    origin !== `http://${host}`
  ) {
    return false;
  }

  // Tolak request browser lintas origin.
  const fetchSite = request.headers.get(
    "sec-fetch-site",
  );

  if (
    fetchSite !== null &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return false;
  }

  return true;
}


// ============================================================
// PATCH — REQUEST BODY VALIDATION
// ============================================================

async function parseUpdatePayload(
  request: Request,
): Promise<UpdatePayload> {

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    ?.toLowerCase();

  if (contentType !== "application/json") {
    throw new ValidationError(
      "Content-Type must be application/json",
    );
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? 0,
  );

  if (contentLength > 4096) {
    throw new ValidationError(
      "Request body exceeds 4096 bytes",
    );
  }

  let raw: unknown;

  try {
    const text = await request.text();

    if (
      new TextEncoder().encode(text).byteLength > 4096
    ) {
      throw new ValidationError(
        "Request body exceeds 4096 bytes",
      );
    }

    raw = JSON.parse(text);

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    throw new ValidationError(
      "Invalid JSON request body",
    );
  }

  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new ValidationError(
      "Request body must be a JSON object",
    );
  }

  const body = raw as Record<string, unknown>;

  if (
    typeof body.code !== "string" ||
    body.code.trim() === ""
  ) {
    throw new ValidationError(
      "code: must be a non-empty string",
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      body,
      "numeric_value",
    )
  ) {
    throw new ValidationError(
      "numeric_value: required",
    );
  }

  if (
    typeof body.numeric_value !== "number" &&
    typeof body.numeric_value !== "string"
  ) {
    throw new ValidationError(
      "numeric_value: must be number or numeric string",
    );
  }

  return {
    code: body.code,
    numeric_value: body.numeric_value,
  };
}

// ============================================================
// PATCH — CONFIGURATION UPDATE API
// ============================================================

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {

  // Deny writes outside the local development server.
  if (!isLocalDevelopmentWrite(request)) {
    return failure(
      403,
      "Configuration updates are disabled in this environment",
    );
  }

  try {

    const { resource } = await context.params;

    // Only the three approved resources can be updated.
    if (
      resource !== "flowhead" &&
      resource !== "vsd" &&
      resource !== "runtime"
    ) {
      return failure(
        405,
        "PATCH is not supported for this resource",
      );
    }

    const params = new URL(request.url).searchParams;

    // Validate JSON payload before modifying data.
    const payload = await parseUpdatePayload(request);

    switch (resource) {

      // ------------------------------------------------------
      // FLOWHEAD UPDATE
      // ------------------------------------------------------

      case "flowhead": {

        const capacity = parsePositiveInteger(
          params.get("capacity"),
          "capacity",
        );

        const result = await updateFlowheadConfig(
          capacity,
          payload.code,
          payload.numeric_value,
        );

        return success(result);
      }

      // ------------------------------------------------------
      // VSD UPDATE
      // ------------------------------------------------------

      case "vsd": {

        const vsdTypeId = parsePositiveInteger(
          params.get("vsdTypeId"),
          "vsdTypeId",
        );

        const result = await updateVfdConfig(
          vsdTypeId,
          payload.code,
          payload.numeric_value,
        );

        return success(result);
      }

      // ------------------------------------------------------
      // RUNTIME UPDATE
      // ------------------------------------------------------

      case "runtime": {

        const result = await updateRuntimeConfig(
          payload.code,
          payload.numeric_value,
        );

        return success(result);
      }
    }

  } catch (error) {
    return handleError(error);
  }
}


/**
 * DEXMIN — Stage 7C.2
 * POST / DELETE Configuration API
 *
 * Uses the existing:
 * - RouteContext
 * - success()
 * - failure()
 * - handleError()
 * - parsePositiveInteger()
 * - isLocalDevelopmentWrite()
 *
 * No changes to GET/PATCH.
 */

async function parseCreateBody(
  request: Request,
): Promise<CreateConfigInput> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    ?.toLowerCase();

  if (contentType !== "application/json") {
    throw new ValidationError(
      "Content-Type must be application/json",
    );
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? 0,
  );

  if (contentLength > 4096) {
    throw new ValidationError(
      "Request body exceeds 4096 bytes",
    );
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > 4096) {
    throw new ValidationError(
      "Request body exceeds 4096 bytes",
    );
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError(
      "Invalid JSON request body",
    );
  }

  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new ValidationError(
      "Request body must be a JSON object",
    );
  }

  const body = raw as Record<string, unknown>;

  const allowedFields = new Set([
    "code",
    "name",
    "failure_id",
    "numeric_value",
    "unit",
  ]);

  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      throw new ValidationError(
        `Unsupported request field: ${field}`,
      );
    }
  }

  return {
    code: body.code,
    name: body.name,
    failure_id: body.failure_id,
    numeric_value: body.numeric_value,
    unit: body.unit,
  };
}

// ============================================================
// POST — CREATE CONFIGURATION
// ============================================================

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!isLocalDevelopmentWrite(request)) {
    return failure(
      403,
      "Configuration writes are disabled in this environment",
    );
  }

  try {
    const { resource } = await context.params;

    if (
      resource !== "flowhead" &&
      resource !== "vsd" &&
      resource !== "runtime"
    ) {
      return failure(
        405,
        "POST is not supported for this resource",
      );
    }

    const params = new URL(request.url).searchParams;
    const input = await parseCreateBody(request);

    switch (resource) {
      case "flowhead": {
        const capacity = parsePositiveInteger(
          params.get("capacity"),
          "capacity",
        );

        const result = await createFlowheadConfig(
          capacity,
          input,
        );

        return success(result, 201);
      }

      case "vsd": {
        const vsdTypeId = parsePositiveInteger(
          params.get("vsdTypeId"),
          "vsdTypeId",
        );

        const result = await createVfdConfig(
          vsdTypeId,
          input,
        );

        return success(result, 201);
      }

      case "runtime": {
        // Runtime has no name or failure_id columns.
        if (
          input.name !== undefined ||
          input.failure_id !== undefined
        ) {
          throw new ValidationError(
            "Runtime configuration does not accept name or failure_id",
          );
        }

        const result = await createRuntimeConfig(input);

        return success(result, 201);
      }
    }
  } catch (error) {
    return handleError(error);
  }
}

// ============================================================
// DELETE — REMOVE CONFIGURATION
// ============================================================

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!isLocalDevelopmentWrite(request)) {
    return failure(
      403,
      "Configuration writes are disabled in this environment",
    );
  }

  try {
    const { resource } = await context.params;

    if (
      resource !== "flowhead" &&
      resource !== "vsd" &&
      resource !== "runtime"
    ) {
      return failure(
        405,
        "DELETE is not supported for this resource",
      );
    }

    const params = new URL(request.url).searchParams;
    const code = params.get("code");

    if (!code || code.trim() === "") {
      throw new ValidationError(
        "code: required",
      );
    }

    switch (resource) {
      case "flowhead": {
        const capacity = parsePositiveInteger(
          params.get("capacity"),
          "capacity",
        );

        const result = await deleteFlowheadConfig(
          capacity,
          code,
        );

        return success(result);
      }

      case "vsd": {
        const vsdTypeId = parsePositiveInteger(
          params.get("vsdTypeId"),
          "vsdTypeId",
        );

        const result = await deleteVfdConfig(
          vsdTypeId,
          code,
        );

        return success(result);
      }

      case "runtime": {
        const result = await deleteRuntimeConfig(code);
        return success(result);
      }
    }
  } catch (error) {
    return handleError(error);
  }
}
