/**
 * Frozen differential oracle.
 *
 * `frozen.json` holds 400 deterministic `/classify` cases together with the
 * responses produced by the (now removed) Python reference implementation.
 * Replaying them here keeps the strongest regression guard after the Python
 * backend was deleted — without needing a Python runtime.
 *
 * Regenerating requires the old Python oracle; see docs/20-migrasi-nodejs.md.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { classifyRequest } from "../../src/application/classify.ts";
import { NotFoundError, ValidationError } from "../../src/application/errors.ts";

interface FrozenCase {
  request: Record<string, unknown>;
  status: number;
  body: unknown;
}

const fixtures = JSON.parse(
  readFileSync(new URL("./frozen.json", import.meta.url), "utf-8"),
) as FrozenCase[];

test("400 frozen differential cases match the Python oracle", () => {
  assert.equal(fixtures.length, 400);
  for (const [i, fixture] of fixtures.entries()) {
    let status = 200;
    let body: unknown;
    try {
      body = classifyRequest(fixture.request);
    } catch (exc) {
      if (exc instanceof NotFoundError || exc instanceof ValidationError) {
        status = exc.status;
        body = { detail: exc.message };
      } else {
        throw exc;
      }
    }
    assert.equal(status, fixture.status, `case ${i}: status`);
    if (status === 200) {
      assert.deepEqual(body, fixture.body, `case ${i}: body`);
    }
  }
});
