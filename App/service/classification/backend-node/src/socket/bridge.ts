import { io as createClient } from "socket.io-client";

import type { Server } from "socket.io";

import { serializeIso } from "../util/timestamp.ts";
import { normalizePumpUpdate } from "./telemetry.ts";

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function toTelemetryPayload(
  payload: unknown,
  expectedPumpId: string,
): Record<string, unknown> | null {
  const telemetry = normalizePumpUpdate(payload);
  if (!telemetry || telemetry.pump_id !== expectedPumpId) {
    return null;
  }

  const { timestamp, ...fields } = telemetry.reading;
  return {
    pump_id: telemetry.pump_id,
    timestamp: serializeIso(timestamp),
    ...fields,
  };
}

export function startSocketBridge(io: Server) {
  const dexUrl = readEnv("DEX_SOCKET_URL");
  const dexToken = readEnv("DEX_SOCKET_TOKEN");
  const dexPumpId = readEnv("DEX_PUMP_ID");

  if (!dexUrl || !dexToken || !dexPumpId) {
    console.warn(
      "[dex-socket] disabled: DEX_SOCKET_URL, DEX_SOCKET_TOKEN, and DEX_PUMP_ID are required",
    );
    return null;
  }

  const upstream = createClient(dexUrl, {
    query: {
      token: dexToken,
      pumpId: dexPumpId,
    },

    transports: ["websocket", "polling"],

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,

    timeout: 10000,
  });

  upstream.on("connect", () => {
    console.log("[dex-socket] connected:", upstream.id);
  });

  upstream.on("connected", () => {
    console.log("[dex-socket] connection acknowledged");
  });

  upstream.on("pump-update", async (payload: unknown) => {
    const telemetry = normalizePumpUpdate(payload);
    if (!telemetry) {
      console.warn("[dex] invalid or unexpected telemetry ignored");
      return;
    }

    const { timestamp, ...fields } = telemetry.reading;
    const data = {
      pump_id: telemetry.pump_id,
      timestamp: serializeIso(timestamp),
      ...fields,
    };

    io.emit("telemetry-update", data);

    console.log(
      "[classify] telemetry-update:",
      data.pump_id,
      data.timestamp,
    );
  });

  upstream.on("connect_error", (error) => {
    console.error(
      "[dex-socket] connection error:",
      error.message,
    );
  });

  upstream.on("disconnect", (reason) => {
    console.warn("[dex-socket] disconnected:", reason);
  });

  return upstream;
}