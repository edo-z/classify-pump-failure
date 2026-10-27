import assert from "node:assert/strict";
import { test } from "node:test";

import { serializeIso, parseIso } from "../../src/util/timestamp.ts";
import { toRawTelemetryPayload } from "../../src/socket/bridge.ts";
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

test("toRawTelemetryPayload emits the RawTelemetryPayload format", () => {
  const data = toRawTelemetryPayload(PAYLOAD);

  assert.ok(data);
  assert.equal(data.pump_id, "21");
  assert.equal(data.received_at, "2026-10-22 10:00:00+07:00");
  assert.equal(data.data.motor_speed, 990);
  assert.equal(data.data.output_frequency, 40);
  assert.equal(data.flowhead, null);
  assert.equal(data.flowhead_id, null);
  assert.equal(data.vsdTypeId, null);
});

test("toRawTelemetryPayload rejects malformed payloads", () => {
  assert.equal(toRawTelemetryPayload(null), null);
  assert.equal(toRawTelemetryPayload({ data: {} }), null);
  assert.equal(toRawTelemetryPayload({ pump_id: "21", data: { pump_id: "22" } }), null);
});