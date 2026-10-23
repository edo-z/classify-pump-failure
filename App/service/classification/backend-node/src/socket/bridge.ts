import { io as createClient } from "socket.io-client";

import type { Server } from "socket.io";

import { serializeIso } from "../util/timestamp.ts";
import { normalizePumpUpdate } from "./telemetry.ts";
import { loadDbConfig } from "../config/db.ts";
import { getPool } from "../db/pool.ts";
import { getOrCreate as createPump } from "../repositories/pumpRepo.ts";
import { getIdMap as getParamIdMap } from "../repositories/parameterRepo.ts";
import { upsertLatest } from "../repositories/realtimeRepo.ts";
import {
  initRetryBuffer,
  enqueue,
  remove,
  processQueue,
} from "./realtimeBuffer.ts";

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

let persistenceEnabled = false;

function tryEnablePersistence(): void {
  try {
    getPool();
    persistenceEnabled = true;
    console.log("[dex-socket] persistence enabled");
  } catch {
    persistenceEnabled = false;
  }
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

  let dbConfig;
  try {
    dbConfig = loadDbConfig();
  } catch {
    console.warn("[dex-socket] DB config missing, persistence disabled");
    dbConfig = null;
  }
  if (dbConfig) {
    initRetryBuffer(dbConfig);
    tryEnablePersistence();
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
    if (!persistenceEnabled) {
      tryEnablePersistence();
    }
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

    if (!persistenceEnabled) {
      return;
    }

    try {
      for (const [paramKey, value] of Object.entries(fields)) {
        if (paramKey === "timestamp" || value === null) continue;

        const paramDefId = getParamIdMap().get(paramKey);
        if (!paramDefId) {
          console.warn(`[dex] unknown parameter ${paramKey} for pump ${telemetry.pump_id}`);
          continue;
        }

        const pump = await createPump(telemetry.pump_id, null);
        const eventTime = new Date(telemetry.reading.timestamp.epochMs);
        await upsertLatest(pump.id, paramDefId, String(value), eventTime);
        remove(telemetry.pump_id, paramKey);
      }
    } catch (e) {
      console.error("[dex] persistence error:", e);
      persistenceEnabled = false;
      const eventTime = new Date(telemetry.reading.timestamp.epochMs);
      for (const [paramKey, value] of Object.entries(fields)) {
        if (paramKey === "timestamp" || value === null) continue;
        enqueue(telemetry.pump_id, paramKey, String(value), eventTime);
      }
      processQueue(
        async (dpId) => {
          try {
            return await createPump(dpId, null);
          } catch {
            return null;
          }
        },
        (pKey) => getParamIdMap().get(pKey) ?? null,
        async (pId, pDefId, val, ts) => {
          await upsertLatest(pId, pDefId, val, ts);
        }
      );
    }
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