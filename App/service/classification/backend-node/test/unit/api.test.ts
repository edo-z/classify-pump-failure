/**
 * C8/C7 — HTTP contract port of ``test_contract.py`` + ``test_smoke_health.py``.
 * Locks request/response shape, evidence trimming, namespace echo,
 * reject codes, and the API-key gate.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildApp } from "../../src/server.ts";
import { API_KEY_ENV } from "../../src/middleware/apiKey.ts";

const app = buildApp();
const originalKey = process.env[API_KEY_ENV];

afterEach(() => {
  if (originalKey === undefined) delete process.env[API_KEY_ENV];
  else process.env[API_KEY_ENV] = originalKey;
});

function window_(n = 5, freq = 40.0, start = "2026-06-12T14:33:56+07:00") {
  const base = Date.parse(start);
  return Array.from({ length: n }, (_v, i) => ({
    timestamp: new Date(base + 5000 * i).toISOString().replace("Z", "+00:00"),
    motor_speed: 990.0,
    output_frequency: freq,
    motor_current: 246.0,
    motor_torque: 40.0,
    output_power: 111.0,
    input_voltage: 380.0,
    ambient_temperature: 30.0,
    control_board_temperature: 40.0,
    inverter_temperature: 45.0,
  }));
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/classify", payload: body as object, headers });
}

test("classify happy path shape", async () => {
  const r = await post({
    profile_id: "5000_lps",
    setpoint_freq: 40.0,
    namespace: "96",
    readings: window_(),
  });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.profile_id, "5000_lps");
  assert.equal(body.namespace, "96");
  assert.equal(body.evidence_size, 5);
  const cls = body.classification;
  assert.ok(
    [
      "pompa_tersangkut_sampah",
      "turbulensi",
      "banyak_sampah",
      "unbalance",
      "undervoltage",
      "overvoltage",
      "dry_run",
      "panel_overheat",
      "normal",
    ].includes(cls.trouble_type),
  );
  assert.ok(Array.isArray(cls.matched_rules));
  assert.equal(typeof cls.sensor_snapshot, "object");
  assert.ok(Array.isArray(cls.limitations));
  assert.ok(["FULL", "PARTIAL", "INSUFFICIENT_DATA"].includes(cls.evaluation_status));
});

test("classify trims evidence server-side to 31", async () => {
  const r = await post({ profile_id: "5000_lps", namespace: "96", readings: window_(40) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().evidence_size <= 31);
});

test("classify gap resets evidence", async () => {
  const w = window_(3);
  w[1]!.timestamp = "2026-06-12T15:33:56+07:00";
  w[2]!.timestamp = "2026-06-12T15:34:01+07:00";
  const r = await post({ profile_id: "5000_lps", namespace: "96", readings: w });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().evidence_size, 2);
});

test("classify rejects", async () => {
  const ok = { profile_id: "5000_lps", namespace: "96", readings: window_() };
  assert.equal((await post({ ...ok, readings: [] })).statusCode, 422);
  assert.equal((await post({ ...ok, readings: window_(41) })).statusCode, 422);
  const naive = window_();
  naive[0]!.timestamp = "2026-06-12T14:33:56";
  assert.equal((await post({ ...ok, readings: naive })).statusCode, 422);
  assert.equal((await post({ ...ok, profile_id: "nope_lps" })).statusCode, 404);
});

test("classify API-key gate", async () => {
  const body = { profile_id: "5000_lps", namespace: "96", readings: window_() };
  delete process.env[API_KEY_ENV];
  assert.equal((await post(body)).statusCode, 200);

  process.env[API_KEY_ENV] = "be-secret-1";
  assert.equal((await post(body)).statusCode, 401);
  assert.equal((await post(body, { "x-api-key": "salah" })).statusCode, 401);
  assert.equal((await post(body, { "x-api-key": "be-secret-1" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
});

test("health shape and honest status", async () => {
  const r = await app.inject({ method: "GET", url: "/health" });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  for (const key of [
    "status",
    "rules_exists",
    "rules_loaded",
    "rules_error",
    "setpoints_exists",
    "setpoints_loaded",
    "setpoints_error",
  ]) {
    assert.ok(key in body, `missing ${key}`);
  }
  assert.equal(body.rules_loaded, true);
  assert.equal(body.setpoints_loaded, true);
  assert.equal(body.status, "ok");
});

test("exempt paths are exact matches only", async () => {
  process.env[API_KEY_ENV] = "be-secret-1";
  const healthz = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(healthz.statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/" })).statusCode, 200);
});

test("classify rejects non-finite numbers (1e999)", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/classify",
    headers: { "content-type": "application/json" },
    payload:
      '{"profile_id":"5000_lps","namespace":"x","readings":[{"timestamp":"2026-10-19T10:00:00+07:00","motor_current":1e999}]}',
  });
  assert.equal(r.statusCode, 422);
});

test("internal errors do not leak details", async () => {
  const isolated = buildApp();
  isolated.get("/__boom", async () => {
    throw new Error("secret path /etc/passwd");
  });
  const r = await isolated.inject({ method: "GET", url: "/__boom" });
  assert.equal(r.statusCode, 500);
  assert.equal(r.json().detail, "Internal Server Error");
  assert.ok(!r.body.includes("secret"));
});

test("root advertises interfaces", async () => {
  const r = await app.inject({ method: "GET", url: "/" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().interfaces.classify, "/classify");
});
