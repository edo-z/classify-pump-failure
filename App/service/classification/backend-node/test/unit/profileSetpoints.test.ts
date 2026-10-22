/** PUT /profile-setpoints semantics + non-finite hardening. */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseUpdate } from "../../src/application/setpoints.ts";
import {
  loadProfileSetpoints,
  saveProfileSetpoint,
  type ProfileSetpoint,
} from "../../src/engine/setpoints.ts";

const CURRENT: ProfileSetpoint = { frequency_hz: 40, rpm: 990, torque: 90 };

test("absent fields keep the stored value (no silent wipe)", () => {
  assert.deepEqual(parseUpdate({ frequency_hz: 41 }, CURRENT), {
    frequency_hz: 41,
    rpm: 990,
    torque: 90,
  });
  assert.deepEqual(parseUpdate({}, CURRENT), CURRENT);
});

test("explicit null clears only that field", () => {
  assert.deepEqual(parseUpdate({ rpm: null }, CURRENT), {
    frequency_hz: 40,
    rpm: null,
    torque: 90,
  });
});

test("numeric strings and zero are accepted; non-finite is rejected", () => {
  assert.equal(parseUpdate({ frequency_hz: "41.5" }, CURRENT).frequency_hz, 41.5);
  assert.equal(parseUpdate({ frequency_hz: 0 }, CURRENT).frequency_hz, 0);
  for (const bad of [Infinity, -Infinity, NaN, "Infinity", "1e999", -1, "abc", true]) {
    assert.throws(() => parseUpdate({ frequency_hz: bad }, CURRENT));
  }
});

test("save rejects non-finite values before touching the file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cls-setpoints-"));
  const file = path.join(dir, "profile_setpoints.json");
  writeFileSync(file, "{}", "utf-8");
  assert.throws(
    () =>
      saveProfileSetpoint(
        "5000_lps",
        { frequency_hz: Infinity, rpm: null, torque: null },
        file,
      ),
    RangeError,
  );
  assert.equal(readFileSync(file, "utf-8"), "{}");
});

test("saved file stays valid JSON and round-trips", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cls-setpoints-"));
  const file = path.join(dir, "profile_setpoints.json");
  writeFileSync(file, "{}", "utf-8");
  saveProfileSetpoint("5000_lps", { frequency_hz: 41, rpm: null, torque: 90 }, file);
  const raw = readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, ProfileSetpoint>;
  assert.deepEqual(parsed["5000_lps"], { frequency_hz: 41, rpm: null, torque: 90 });
  assert.deepEqual(loadProfileSetpoints(file)["5000_lps"], {
    frequency_hz: 41,
    rpm: null,
    torque: 90,
  });
});
