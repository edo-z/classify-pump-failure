import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { io as createClient, type Socket } from "socket.io-client";

import type { ClassifyResponseBody } from "../../src/application/classify.ts";
import type { HealthStatus } from "../../src/application/health.ts";
import {
  listProfileSetpoints,
  readProfileSetpoint,
  updateProfileSetpoint,
} from "../../src/application/setpoints.ts";
import { startServer, type RunningServer } from "../../src/server.ts";
import type { SocketAck } from "../../src/socket/handlers.ts";

const GOLDEN = new URL("../golden/01_normal.input.json", import.meta.url);
const SEED = {
  "5000_lps": { frequency_hz: 40, rpm: 990, torque: 90 },
};

let server: RunningServer;
let client: Socket;
let tempDir: string;

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
    client.emit(event, payload, (response: SocketAck<T>) => {
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
    client.emit(event, (response: SocketAck<T>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "classify-socket-"));
  const setpointsFile = path.join(tempDir, "profile_setpoints.json");
  writeFileSync(setpointsFile, JSON.stringify(SEED), "utf-8");

  server = await startServer({
    port: 0,
    host: "127.0.0.1",
    startBridge: false,
    socketDeps: {
      listSetpoints: () => listProfileSetpoints(setpointsFile),
      readSetpoint: (profileId) => readProfileSetpoint(profileId, setpointsFile),
      updateSetpoint: (profileId, body) =>
        updateProfileSetpoint(profileId, body, setpointsFile),
    },
  });
  client = await connectClient(server.port);
});

after(async () => {
  client?.disconnect();
  await server?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("classify event returns the application response", async () => {
  const input = JSON.parse(readFileSync(GOLDEN, "utf-8"));
  const response = await request<ClassifyResponseBody>("classify", input);

  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data.profile_id, "5000_lps");
    assert.equal(response.data.namespace, "golden-normal");
    assert.ok(
      typeof response.data.classification.trouble_type === "string",
    );
  }
});

test("classify event maps validation errors", async () => {
  const response = await request("classify", {
    profile_id: "5000_lps",
    namespace: "socket-test",
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
  input.profile_id = "unknown_lps";
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
    { profile_id: "5000_lps" },
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
    { profile_id: "5000_lps", frequency_hz: 42 },
  );

  assert.equal(updated.ok, true);
  if (updated.ok) {
    assert.equal(updated.data.frequency_hz, 42);
    assert.equal(updated.data.rpm, 990);
  }

  const read = await request<{ frequency_hz: number }>(
    "profile-setpoints:get",
    { profile_id: "5000_lps" },
  );
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.data.frequency_hz, 42);
});

test("profile-setpoints:update maps validation and not-found errors", async () => {
  const invalid = await request("profile-setpoints:update", {
    profile_id: "5000_lps",
    frequency_hz: -1,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "VALIDATION");

  const unknown = await request("profile-setpoints:update", {
    profile_id: "unknown_lps",
    frequency_hz: 42,
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "NOT_FOUND");
});

test("HTTP remains available on the same server", async () => {
  // HTTP endpoints are removed in P8.
  // This test is now obsolete.
});

test("missing ack does not crash and the socket can reconnect", async () => {
  client.emit("health");
  await new Promise((resolve) => setTimeout(resolve, 50));

  client.disconnect();
  client = await connectClient(server.port);

  const response = await request<HealthStatus>("health", {});
  assert.equal(response.ok, true);
});
