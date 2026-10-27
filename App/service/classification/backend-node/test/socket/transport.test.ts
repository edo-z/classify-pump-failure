import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { io as createClient, type Socket } from "socket.io-client";

import type { ClassifyResponseBody } from "../../src/application/classify.ts";
import type { HealthStatus } from "../../src/application/health.ts";
import { listProfileSetpoints, readProfileSetpoint, updateProfileSetpoint } from "../../src/application/setpoints.ts";
import { startServer, type RunningServer } from "../../src/server.ts";
import type { SocketAck } from "../../src/socket/handlers.ts";
import { ClassificationEngine, RULES_FILE } from "../../src/engine/engine.ts";
import { getDefaultConfigurationProvider } from "../../src/engine/configuration-provider.ts";
import type { RawTelemetryPayload } from "../../src/engine/models.ts";
import { parseIso, serializeIso, type ZonedTimestamp } from "../../src/util/timestamp.ts";
import { NotFoundError, ValidationError } from "../../src/application/errors.ts";
import { readFile } from "node:fs/promises";

const GOLDEN = new URL("../golden/01_normal.input.json", import.meta.url);
const SEED = {
  "5000_lps": { frequency_hz: 40, rpm: 990, torque: 90 },
};

let testServer: RunningServer;
let testClient: Socket;
let tempDir: string;

const PROFILES_FILE = new URL("../engine/pump_profiles.json", import.meta.url);
const MAX_WINDOW_READINGS = 40;

const NUMERIC_FIELDS = [
  "motor_speed",
  "output_frequency",
  "motor_current",
  "motor_torque",
  "output_power",
  "hours_run",
  "output_voltage",
  "ambient_temperature",
  "control_board_temperature",
  "inverter_temperature",
  "input_voltage",
  "flux_actual",
  "motor_estimated_temperature",
  "arus_rms_u",
  "arus_rms_v",
  "arus_rms_w",
] as const;

const NAIVE_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

function coerceFloat(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${field}: value must be a finite number`);
    }
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new ValidationError(`${field}: value is not a valid number`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field}: field required`);
  }
  return value;
}

function parseReading(raw: unknown): any {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("readings: each item must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const tsRaw = obj.timestamp;
  if (typeof tsRaw !== "string") {
    throw new ValidationError("timestamp: field required");
  }
  let timestamp: ZonedTimestamp | null = parseIso(tsRaw);
  if (timestamp === null) {
    if (NAIVE_RE.test(tsRaw)) {
      throw new ValidationError(
        "timestamp must be timezone-aware ISO-8601 (event-time wajib zona waktu)",
      );
    }
    throw new ValidationError("timestamp: invalid datetime");
  }
  const numeric: Record<string, number | null> = {};
  for (const field of NUMERIC_FIELDS) {
    numeric[field] = coerceFloat(obj[field], field);
  }
  return {
    timestamp,
    motor_speed: numeric.motor_speed as number | null,
    output_frequency: numeric.output_frequency as number | null,
    motor_current: numeric.motor_current as number | null,
    motor_torque: numeric.motor_torque as number | null,
    output_power: numeric.output_power as number | null,
    hours_run: numeric.hours_run as number | null,
    output_voltage: numeric.output_voltage as number | null,
    ambient_temperature: numeric.ambient_temperature as number | null,
    control_board_temperature: numeric.control_board_temperature as number | null,
    inverter_temperature: numeric.inverter_temperature as number | null,
    input_voltage: numeric.input_voltage as number | null,
    flux_actual: numeric.flux_actual as number | null,
    motor_estimated_temperature: numeric.motor_estimated_temperature as number | null,
    arus_rms_u: numeric.arus_rms_u as number | null,
    arus_rms_v: numeric.arus_rms_v as number | null,
    arus_rms_w: numeric.arus_rms_w as number | null,
  };
}

const TroubleType = {
  POMPA_TERSANGKUT_SAMPAH: "pompa_tersangkut_sampah",
  TURBULENSI: "turbulensi",
  BANYAK_SAMPAH: "banyak_sampah",
  UNBALANCE: "unbalance",
  UNDERVOLTAGE: "undervoltage",
  OVERVOLTAGE: "overvoltage",
  DRY_RUN: "dry_run",
  PANEL_OVERHEAT: "panel_overheat",
  NORMAL: "normal",
} as const;

async function validateProfile(profileId: string): Promise<void> {
  try {
    const content = await readFile(PROFILES_FILE, "utf-8");
    const data = JSON.parse(content);
    const profiles = data.profiles ?? {};
    if (!profiles[profileId]) {
      throw new NotFoundError(`Unknown pump profile: ${profileId}`);
    }
  } catch (exc) {
    if (exc instanceof NotFoundError) throw exc;
    if ((exc as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Unknown pump profile: ${profileId}`);
    }
    throw exc;
  }
}

const testIsPumpOff = (raw: RawTelemetryPayload): boolean => {
  const d = raw.data ?? {};
  return (d.output_frequency === 0 || d.motor_speed === 0) &&
         (d.motor_current === 0 || d.output_power === 0);
};

function toRawPayload(
  readings: any[],
  profileId: string,
  pumpId: string,
): RawTelemetryPayload {
  const latest = readings[readings.length - 1];
  const data: Record<string, unknown> = {};
  for (const f of NUMERIC_FIELDS) {
    data[f] = latest[f];
  }
  const flowheadNum = Number(profileId.replace("_lps", ""));
  return {
    pump_id: pumpId,
    flowhead: Number.isFinite(flowheadNum) ? flowheadNum : null,
    flowhead_id: null,
    vsdTypeId: null,
    received_at: serializeIso(latest.timestamp).replace("T", " ").split(".")[0],
    data,
  };
}

function transformOutput(
  output: any,
  flowhead: string,
  pumpId: string,
  evidenceSize: number,
): ClassifyResponseBody {
  const priority = [
    TroubleType.POMPA_TERSANGKUT_SAMPAH,
    TroubleType.TURBULENSI,
    TroubleType.BANYAK_SAMPAH,
    TroubleType.DRY_RUN,
    TroubleType.UNBALANCE,
    TroubleType.OVERVOLTAGE,
    TroubleType.UNDERVOLTAGE,
    TroubleType.PANEL_OVERHEAT,
    TroubleType.NORMAL,
  ];
  const detected = output.results.find((r: any) => r.detected);
  const troubleType = detected?.troubleType ?? TroubleType.NORMAL;

  return {
    flowhead,
    pump_id: pumpId,
    evidence_size: evidenceSize,
    classification: {
      pump_id: output.pumpId,
      timestamp: output.receivedAt,
      trouble_type: troubleType,
      matched_rules: output.results
        .filter((r: any) => r.detected)
        .map((r: any) => ({
          trouble_type: r.troubleType,
          matched_conditions: [],
          total_conditions: 0,
        })),
      sensor_snapshot: {},
      readings_count: evidenceSize,
      limitations: output.missingData,
      evaluation_status: "completed",
      rule_evaluations: output.results.map((r: any) => ({
        trouble_type: r.troubleType,
        capability_status: "ready",
        evaluation: r.detected ? "triggered" : "not_triggered",
        missing_requirements: output.missingData[r.troubleType] ?? [],
        matched_conditions: [],
        total_conditions: 0,
      })),
    },
  };
}

// Test-specific classify function using JsonFileConfigurationProvider
const testConfigProvider = getDefaultConfigurationProvider();
const testEngine = new ClassificationEngine(RULES_FILE, {
  outputMode: "poc",
  isPumpOff: testIsPumpOff,
  configProvider: testConfigProvider,
});

async function testClassifyRequest(rawBody: unknown): Promise<ClassifyResponseBody> {
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = rawBody as Record<string, unknown>;

  const flowheadRaw = body.flowhead;
  if (flowheadRaw === undefined || flowheadRaw === null) {
    throw new ValidationError("flowhead: field required");
  }
  const profile_id = String(flowheadRaw);
  await validateProfile(profile_id);
  const pump_id_val = requireString(body.pump_id, "pump_id");
  if (pump_id_val.length < 1) throw new ValidationError("pump_id: too short");
  if (pump_id_val.length > 64) throw new ValidationError("pump_id: too long");

  const rawReadings = body.readings;
  if (!Array.isArray(rawReadings)) {
    throw new ValidationError("readings: field required");
  }
  if (rawReadings.length < 1) {
    throw new ValidationError("readings: at least 1 reading required");
  }
  if (rawReadings.length > MAX_WINDOW_READINGS) {
    throw new ValidationError(`readings: at most ${MAX_WINDOW_READINGS} readings allowed`);
  }

  const readings = rawReadings.map(parseReading);
  const ordered = [...readings].sort(
    (a, b) => a.timestamp.epochMs - b.timestamp.epochMs,
  );

  const rawPayload = toRawPayload(ordered, profile_id, pump_id_val);

  let output: any;
  try {
    output = await testEngine.classify(rawPayload);
  } catch (exc) {
    if (exc instanceof Error) {
      throw new ValidationError(exc.message);
    }
    throw exc;
  }

  return transformOutput(output, profile_id, pump_id_val, ordered.length);
}

function connectClient(port: number): Promise<Socket> {
  const socket = createClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("socket connect timeout"));
    }, 3000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });
  });
}

function request<T>(event: string, payload: unknown): Promise<SocketAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${event} ack timeout`)),
      3000,
    );
    testClient.emit(event, payload, (response: SocketAck<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function requestAckOnly<T>(event: string): Promise<SocketAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${event} ack timeout`)),
      3000,
    );
    testClient.emit(event, (response: SocketAck<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "classify-socket-"));
  const setpointsFile = path.join(tempDir, "profile_setpoints.json");
  writeFileSync(setpointsFile, JSON.stringify(SEED), "utf-8");

  testServer = await startServer({
    port: 0,
    host: "127.0.0.1",
    startBridge: false,
    socketDeps: {
      classify: testClassifyRequest,
      listSetpoints: () => listProfileSetpoints(setpointsFile),
      readSetpoint: (profileId) => readProfileSetpoint(profileId, setpointsFile),
      updateSetpoint: (profileId, body) =>
        updateProfileSetpoint(profileId, body, setpointsFile),
    },
  });
  testClient = await connectClient(testServer.port);
});

after(async () => {
  testClient?.disconnect();
  await testServer?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("classify event returns the application response", async () => {
  const input = JSON.parse(readFileSync(GOLDEN, "utf-8"));
  const response = await request<ClassifyResponseBody>("classify", input);

  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data.flowhead, "5000_lps");
    assert.equal(response.data.pump_id, "golden-normal");
    assert.ok(
      typeof response.data.classification.trouble_type === "string",
    );
  }
});

test("classify event maps validation errors", async () => {
    const response = await request("classify", {
      flowhead: "5000_lps",
      pump_id: "socket-test",
      readings: [],
    });

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, "VALIDATION");
    assert.match(response.error.message, /readings/);
  }
});

test("classify event maps unknown profiles to NOT_FOUND", async () => {
  const input = JSON.parse(readFileSync(GOLDEN, "utf-8"));
  input.flowhead = "unknown_lps";
  const response = await request("classify", input);

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, "NOT_FOUND");
    assert.match(response.error.message, /Unknown pump profile/);
  }
});

test("health event exposes the existing health status", async () => {
  const response = await request<HealthStatus>("health", {});

  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data.status, "ok");
    assert.equal(response.data.rules_loaded, true);
    assert.equal(response.data.setpoints_loaded, true);
  }
});

test("profile-setpoints:get supports list and single profile", async () => {
  const list = await request<Record<string, unknown>>(
    "profile-setpoints:get",
    {},
  );
  assert.equal(list.ok, true);
  if (list.ok) assert.ok("5000_lps" in list.data);

  const single = await request<{ frequency_hz: number }>(
    "profile-setpoints:get",
    { flowhead: "5000_lps" },
  );
  assert.equal(single.ok, true);
  if (single.ok) assert.equal(single.data.frequency_hz, 40);
});

test("profile-setpoints:get supports callback-only list requests", async () => {
  const response = await requestAckOnly<Record<string, unknown>>(
    "profile-setpoints:get",
  );

  assert.equal(response.ok, true);
  if (response.ok) assert.ok("5000_lps" in response.data);
});

test("profile-setpoints:update uses merge semantics", async () => {
  const updated = await request<{ frequency_hz: number; rpm: number }>(
    "profile-setpoints:update",
    { flowhead: "5000_lps", frequency_hz: 42 },
  );

  assert.equal(updated.ok, true);
  if (updated.ok) {
    assert.equal(updated.data.frequency_hz, 42);
    assert.equal(updated.data.rpm, 990);
  }

  const read = await request<{ frequency_hz: number }>(
    "profile-setpoints:get",
    { flowhead: "5000_lps" },
  );
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.data.frequency_hz, 42);
});

test("profile-setpoints:update maps validation and not-found errors", async () => {
  const missingProfile = await request("profile-setpoints:update", {
    flowhead: "unknown_lps",
    frequency_hz: 42,
  });
  assert.equal(missingProfile.ok, false);
  if (!missingProfile.ok) {
    assert.equal(missingProfile.error.code, "NOT_FOUND");
  }

  const badBody = await request("profile-setpoints:update", {
    flowhead: "5000_lps",
    not_a_field: 123,
  });
  assert.equal(badBody.ok, false);
  if (!badBody.ok) {
    assert.equal(badBody.error.code, "VALIDATION");
  }
});

test("HTTP remains available on the same server", async () => {
  const res = await fetch(`http://127.0.0.1:${testServer.port}/health`);
  assert.equal(res.status, 200);
});

test("missing ack does not crash and the socket can reconnect", async () => {
  testClient.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
  testClient = await connectClient(testServer.port);
  const response = await request("health", {});
  assert.equal(response.ok, true);
});