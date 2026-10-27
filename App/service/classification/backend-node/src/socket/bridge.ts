import { io as createClient } from "socket.io-client";

import type { Server } from "socket.io";
import type { RawTelemetryPayload } from "../engine/models.ts";

import { serializeIso } from "../util/timestamp.ts";
import { normalizePumpUpdate } from "./telemetry.ts";

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function toRawTelemetryPayload(payload: unknown): RawTelemetryPayload | null {
  const telemetry = normalizePumpUpdate(payload);
  if (!telemetry) {
    return null;
  }

  const { timestamp, ...fields } = telemetry.reading;
  return {
    pump_id: telemetry.pump_id,
    flowhead: null,
    flowhead_id: null,
    vsdTypeId: null,
    received_at: serializeIso(timestamp).replace("T", " ").split(".")[0],
    data: fields,
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
    const rawPayload = toRawTelemetryPayload(payload);
    if (!rawPayload) {
      console.warn("[dex] invalid or unexpected telemetry ignored");
      return;
    }

    io.emit("telemetry-update", rawPayload);

    console.log(
      "[classify] telemetry-update:",
      rawPayload.pump_id,
      rawPayload.received_at,
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