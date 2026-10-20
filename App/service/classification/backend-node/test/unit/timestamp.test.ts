/** Strict timestamp parity — calendar validation + Python-style output. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseIso, serializeIso } from "../../src/util/timestamp.ts";

function roundTrip(value: string): string | null {
  const parsed = parseIso(value);
  return parsed === null ? null : serializeIso(parsed);
}

test("preserves non-UTC offsets and normalises the separator", () => {
  assert.equal(roundTrip("2026-10-19T10:00:00+07:00"), "2026-10-19T10:00:00+07:00");
  assert.equal(roundTrip("2026-10-19T10:00:00+05:30"), "2026-10-19T10:00:00+05:30");
  assert.equal(roundTrip("2026-10-19T10:00:00-03:30"), "2026-10-19T10:00:00-03:30");
  assert.equal(roundTrip("2026-10-19 10:00:00+07:00"), "2026-10-19T10:00:00+07:00");
  assert.equal(roundTrip("2026-10-19T10:00+07:00"), "2026-10-19T10:00:00+07:00");
});

test("UTC is serialized as Z (Pydantic style)", () => {
  assert.equal(roundTrip("2026-10-19T03:00:00Z"), "2026-10-19T03:00:00Z");
  assert.equal(roundTrip("2026-10-19T03:00:00+00:00"), "2026-10-19T03:00:00Z");
});

test("fractional seconds are normalised to microseconds", () => {
  assert.equal(roundTrip("2026-10-19T10:00:00.123+07:00"), "2026-10-19T10:00:00.123000+07:00");
  assert.equal(
    roundTrip("2026-10-19T10:00:00.123456789+07:00"),
    "2026-10-19T10:00:00.123456+07:00",
  );
});

test("rejects invalid calendar components instead of normalising", () => {
  for (const bad of [
    "2026-02-30T10:00:00+07:00",
    "2026-13-01T10:00:00+07:00",
    "2026-00-10T10:00:00+07:00",
    "2026-01-00T10:00:00+07:00",
    "2026-01-01T24:00:00+07:00",
    "2026-01-01T10:60:00+07:00",
    "2026-01-01T10:00:60+07:00",
    "0000-01-01T10:00:00+07:00",
    "2026-01-01T10:00:00+25:00",
    "2026-01-01T10:00:00+23:60",
    "2026-01-01T10:00:00",
    "not-a-date",
  ]) {
    assert.equal(parseIso(bad), null, bad);
  }
  assert.notEqual(parseIso("2024-02-29T10:00:00Z"), null);
  assert.equal(parseIso("2023-02-29T10:00:00Z"), null);
});

test("years below 100 are not remapped to 1900", () => {
  assert.equal(roundTrip("0026-01-01T00:00:00Z"), "0026-01-01T00:00:00Z");
});

test("same instant compares equal across offsets", () => {
  const a = parseIso("2026-10-19T10:00:00+07:00");
  const b = parseIso("2026-10-19T03:00:00Z");
  assert.ok(a && b);
  assert.equal(a.epochMs, b.epochMs);
});
