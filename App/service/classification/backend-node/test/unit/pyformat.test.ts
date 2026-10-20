/** Python-compatible formatting helpers (string-exact contract). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { fixed, general, numRepr, plusFixed, reprFloat } from "../../src/util/pyformat.ts";

test("fixed matches Python f-string formatting", () => {
  assert.equal(fixed(8, 1), "8.0");
  assert.equal(fixed(450, 1), "450.0");
  assert.equal(fixed(40, 2), "40.00");
  assert.equal(fixed(266.8, 1), "266.8");
  assert.equal(fixed(0, 2), "0.00");
  assert.equal(fixed(13.333333, 2), "13.33");
  assert.equal(fixed(-5.25, 1), "-5.2");
});

test("plusFixed always shows a sign", () => {
  assert.equal(plusFixed(65, 1), "+65.0");
  assert.equal(plusFixed(-5, 1), "-5.0");
  assert.equal(plusFixed(0, 1), "+0.0");
});

test("reprFloat keeps Python's trailing .0 for integral floats", () => {
  assert.equal(reprFloat(40), "40.0");
  assert.equal(reprFloat(38), "38.0");
  assert.equal(reprFloat(46.1), "46.1");
});

test("general matches Python :g", () => {
  assert.equal(general(10), "10");
  assert.equal(general(90), "90");
  assert.equal(general(100), "100");
  assert.equal(general(400.0), "400");
  assert.equal(general(517), "517");
});

test("numRepr renders JSON integers without a decimal suffix", () => {
  assert.equal(numRepr(400), "400");
  assert.equal(numRepr(867), "867");
});
