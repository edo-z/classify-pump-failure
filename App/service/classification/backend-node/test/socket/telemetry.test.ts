import assert from "node:assert/strict";
import { test } from "node:test";

import { serializeIso, parseIso } from "../../src/util/timestamp.ts";
import { toTelemetryPayload } from "../../src/socket/bridge.ts";
import { normalizePumpUpdate } from "../../src/socket/telemetry.ts";

const PAYLOAD = {
  pump_id: "21",
  data: {
    pump_id: "21",
    received_at: "2026-10-22T10:00:00+07:00",
    motor_speed: "990",
    output_frequency: 40,
    motor_current: 246,
    motor_torque: "40.0",
    output_power: 111,
    input_voltage: 380,
  },
};

test("normalizePumpUpdate maps DEX fields into SensorReading", () => {
  const telemetry = normalizePumpUpdate(PAYLOAD);

  assert.ok(telemetry);
  assert.equal(telemetry.pump_id, "21");
  assert.equal(telemetry.reading.motor_speed, 990);
  assert.equal(telemetry.reading.motor_torque, 40);
  assert.equal(telemetry.reading.control_board_temperature, null);
});

test("toTelemetryPayload emits the flat telemetry-update payload", () => {
  const data = toTelemetryPayload(PAYLOAD, "21");
  const timestamp = parseIso("2026-10-22T10:00:00+07:00");

  assert.ok(data);
  assert.equal(data.pump_id, "21");
  assert.equal(data.timestamp, serializeIso(timestamp!));
  assert.equal(data.motor_speed, 990);
  assert.equal(data.output_frequency, 40);
});

test("toTelemetryPayload rejects malformed and other-pump payloads", () => {
  assert.equal(toTelemetryPayload(null, "21"), null);
  assert.equal(toTelemetryPayload({ data: {} }, "21"), null);
  assert.equal(toTelemetryPayload(PAYLOAD, "22"), null);
  assert.equal(
    toTelemetryPayload(
      { ...PAYLOAD, pump_id: "22" },
      "21",
    ),
    null,
  );
});
