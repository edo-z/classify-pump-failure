/** Evidence contract — port of ``tests/test_evidence_gap.py``. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVIDENCE_MAXLEN,
  LIVE_GAP_THRESHOLD_MS,
  buildTrailingEvidence,
  computeAdaptiveGapThresholdMs,
  gapExceeded,
} from "../../src/engine/evidence.ts";
import { BASE_TS_MS, reading, series1s, ts } from "./helpers.ts";

test("maxlen is 31 and gap threshold is 10s", () => {
  assert.equal(EVIDENCE_MAXLEN, 31);
  assert.equal(LIVE_GAP_THRESHOLD_MS, 10000);
});

test("fixed gap cuts the trail", () => {
  const readings = series1s(BASE_TS_MS, 32);
  assert.equal(buildTrailingEvidence(readings, 31, 10000).length, 31);
  const gapped = [...readings];
  gapped[31] = reading(BASE_TS_MS + (30 + 11) * 1000);
  assert.equal(buildTrailingEvidence(gapped, 31, 10000).length, 1);
});

test("gap boundary is strict (10000 ok, 10001 cuts)", () => {
  assert.equal(gapExceeded(ts(0), ts(10000), 10000), false);
  assert.equal(gapExceeded(ts(0), ts(10001), 10000), true);
});

test("adaptive threshold", () => {
  assert.equal(computeAdaptiveGapThresholdMs([0, 1000, 2000, 3000]), 2000);
  assert.equal(computeAdaptiveGapThresholdMs([0, 1000, 3000]), 3000);
  assert.equal(computeAdaptiveGapThresholdMs([0]), 0);
  assert.equal(computeAdaptiveGapThresholdMs([1000, 1000, 1000]), 0);
});
