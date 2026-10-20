/**
 * API-key gate — 1:1 port of ``app/api_key.py``.
 *
 * When CLASSIFICATION_API_KEY is empty (default DEV) the API is open with a
 * one-time warning. When set, every endpoint requires a matching X-API-Key
 * header except health/root/documentation.
 *
 * NOTE: the prefix exemptions below intentionally preserve the Python
 * behaviour (``startsWith``). Tightening this is a separate security change
 * (decision Q6/C5), tracked outside the engine port.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";

export const API_KEY_HEADER = "x-api-key";
export const API_KEY_ENV = "CLASSIFICATION_API_KEY";

// Exact-match only: a path like /healthz must not inherit the exemption
// (the Python prefix match was too permissive). Only real routes are exempt.
const EXEMPT_EXACT = new Set(["/", "/health"]);

let warnedOpen = false;

function expectedKey(): string {
  return (process.env[API_KEY_ENV] ?? "").trim();
}

export function isExempt(path: string): boolean {
  return EXEMPT_EXACT.has(path);
}

/** Constant-time comparison on fixed-size digests (no length leak). */
function keysMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function registerApiKey(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const path = (request.raw.url ?? "").split("?")[0] ?? "";
    if (isExempt(path)) return;
    const expected = expectedKey();
    if (!expected) {
      if (!warnedOpen) {
        warnedOpen = true;
        app.log.warn("CLASSIFICATION_API_KEY empty — API terbuka (DEV saja)");
      }
      return;
    }
    const provided = request.headers[API_KEY_HEADER];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (!value || !keysMatch(value, expected)) {
      return reply.code(401).send({ detail: "Invalid or missing API key" });
    }
  });
}
