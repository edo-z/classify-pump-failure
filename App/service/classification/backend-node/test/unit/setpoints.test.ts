/** Setpoint priority + layered resolver — ports of
 * ``tests/test_setpoints_priority.py`` and ``tests/test_resolver_fallback.py``.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanPositive,
  resolveEffectiveRefs,
  resolveLayeredValue,
} from "../../src/engine/configuration-resolver.ts";
import { ProfileNotFoundError } from "../../src/engine/profiles.ts";
import { resolveEffectiveSetpoint } from "../../src/engine/setpoints.ts";

test("setpoint priority: override > profile", () => {
  assert.equal(resolveEffectiveSetpoint("5000_lps", 43).frequency, 43);
  const sp = resolveEffectiveSetpoint("5000_lps");
  assert.equal(sp.frequency, 40.0);
  assert.equal(sp.rpm, 990);
  assert.equal(sp.torque, 90);
});

test("setpoint rejects non-positive / invalid override", () => {
  assert.equal(resolveEffectiveSetpoint("5000_lps", 0).frequency, 40.0);
  assert.equal(resolveEffectiveSetpoint("5000_lps", "abc").frequency, 40.0);
});

test("unknown profile raises", () => {
  assert.throws(() => resolveEffectiveSetpoint("nope_lps"), ProfileNotFoundError);
});

test("cleanPositive semantics", () => {
  assert.equal(cleanPositive(null), null);
  assert.equal(cleanPositive(0), null);
  assert.equal(cleanPositive(-5), null);
  assert.equal(cleanPositive("abc"), null);
  assert.equal(cleanPositive(40), 40.0);
  assert.equal(cleanPositive("46.1"), 46.1);
});

test("layered resolution", () => {
  assert.equal(resolveLayeredValue(40.0, 38.0, 38.0), 40.0);
  assert.equal(resolveLayeredValue(null, 250.0, 250.0), 250.0);
  assert.equal(resolveLayeredValue(null, null, 400.0), 400.0);
  assert.equal(resolveLayeredValue(null, null, null), null);
  assert.equal(resolveLayeredValue(0, -3, 38.0), 38.0);
});

test("effective refs priority per column", () => {
  const refs = resolveEffectiveRefs(250.0, 517.0, 260.0, null, null, 500.0);
  assert.deepEqual(refs, { power_kw: 260.0, current_a: 500.0 });
  assert.deepEqual(resolveEffectiveRefs(null, null), {
    power_kw: null,
    current_a: null,
  });
});
