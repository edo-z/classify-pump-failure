/**
 * Golden regression oracle — behavioral contract for the Node.js port.
 *
 * Each case is a frozen pair (``<name>.input.json`` POST body and
 * ``<name>.expected.json`` full Python response). This test is read-only:
 * it never regenerates expected output. If behaviour differs, fix the
 * port (or do a reviewed fixture regeneration) — never edit expected here.
 *
 * Comparison is structural deep equality on parsed JSON (not textual),
 * including exact ``matched_conditions`` strings.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classifyRequest } from "../../src/application/classify.ts";

const GOLDEN_DIR = path.dirname(fileURLToPath(import.meta.url));

const cases = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".input.json"))
  .sort();

test("golden fixtures exist", () => {
  assert.ok(cases.length >= 20, `expected at least 20 scenarios, got ${cases.length}`);
});

for (const file of cases) {
  const name = file.slice(0, -".input.json".length);
  test(`golden: ${name}`, async () => {
    const body = JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), "utf-8"));
    const expected = JSON.parse(
      readFileSync(path.join(GOLDEN_DIR, `${name}.expected.json`), "utf-8"),
    );
    const response = await classifyRequest(body);
    assert.deepStrictEqual(
      response,
      expected,
      `${name}: classification output changed`,
    );
  });
}
