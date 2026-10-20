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

import { buildApp } from "../../src/server.ts";

interface FrozenCase {
  request: Record<string, unknown>;
  status: number;
  body: unknown;
}

const fixtures = JSON.parse(
  readFileSync(new URL("./frozen.json", import.meta.url), "utf-8"),
) as FrozenCase[];

const app = buildApp();

test("400 frozen differential cases match the Python oracle", async () => {
  assert.equal(fixtures.length, 400);
  for (const [i, fixture] of fixtures.entries()) {
    const response = await app.inject({
      method: "POST",
      url: "/classify",
      payload: fixture.request,
    });
    assert.equal(response.statusCode, fixture.status, `case ${i}: status`);
    if (fixture.status === 200) {
      assert.deepEqual(response.json(), fixture.body, `case ${i}: body`);
    }
  }
});
