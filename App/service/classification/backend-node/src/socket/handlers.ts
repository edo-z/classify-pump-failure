import type { Server } from "socket.io";

import {
  classifyRequest,
  type ClassifyResponseBody,
} from "../application/classify.ts";
import { NotFoundError, ValidationError } from "../application/errors.ts";
import { getHealthStatus, type HealthStatus } from "../application/health.ts";
import {
  listProfileSetpoints,
  readProfileSetpoint,
  updateProfileSetpoint,
  type ProfileSetpoint,
} from "../application/setpoints.ts";
import {
  getEffectiveConfig,
  updateFlowheadConfig,
  updateVfdConfig,
  updateGlobalConfig,
  updatePumpConfig,
  getFlowheadConfig,
  getVfdConfig,
  getGlobalConfigData,
  getPumpConfigData,
  type EffectiveConfigResponse,
  type FlowheadConfigResponse,
  type VfdConfigResponse,
  type GlobalConfigResponse,
  type PumpConfigResponse,
} from "../application/configManagement.ts";

export type SocketErrorCode = "VALIDATION" | "NOT_FOUND" | "INTERNAL";

export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: SocketErrorCode; message: string } };

export interface SocketHandlerDeps {
  classify?: (payload: unknown) => Promise<ClassifyResponseBody>;
  health?: () => Promise<HealthStatus>;
  listSetpoints?: () => Promise<Record<string, ProfileSetpoint>>;
  readSetpoint?: (profileId: string) => Promise<ProfileSetpoint>;
  updateSetpoint?: (profileId: string, body: unknown) => Promise<ProfileSetpoint>;
  getEffectiveConfig?: (dexPumpId: string) => Promise<EffectiveConfigResponse>;
  updateFlowheadConfig?: (capacity: number, parameterId: number, value: unknown) => Promise<{ effective_value: number | null; source: string }>;
  updateVfdConfig?: (vsdTypeId: number, parameterId: number, value: unknown) => Promise<{ effective_value: number | null; source: string }>;
  updateGlobalConfig?: (parameterId: number, value: unknown) => Promise<{ effective_value: number | null; source: string }>;
  updatePumpConfig?: (dexPumpId: string, parameterId: number, value: unknown) => Promise<{ effective_value: number | null; source: string }>;
  getFlowheadConfig?: (capacity: number) => Promise<FlowheadConfigResponse[]>;
  getVfdConfig?: (vsdTypeId: number) => Promise<VfdConfigResponse[]>;
  getGlobalConfig?: () => Promise<GlobalConfigResponse[]>;
  getPumpConfig?: (pumpId: number) => Promise<PumpConfigResponse[]>;
}

function socketError(exc: unknown): { code: SocketErrorCode; message: string } {
  if (exc instanceof ValidationError) {
    return { code: "VALIDATION", message: exc.message };
  }
  if (exc instanceof NotFoundError) {
    return { code: "NOT_FOUND", message: exc.message };
  }
  console.error("[classify] socket internal error:", exc);
  return { code: "INTERNAL", message: "Internal Server Error" };
}

async function respond<T>(ack: unknown, run: () => Promise<T>): Promise<void> {
  if (typeof ack !== "function") return;
  try {
    ack({ ok: true, data: await run() } satisfies SocketAck<T>);
  } catch (exc) {
    ack({ ok: false, error: socketError(exc) } satisfies SocketAck<T>);
  }
}

function ackFrom(payload: unknown, ack: unknown): unknown {
  if (typeof ack === "function") return ack;
  if (typeof payload === "function") return payload;
  return undefined;
}

function flowheadIdFrom(payload: unknown): string | null {
  if (typeof payload === "function") return null;
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("body: request body must be an object");
  }
  const flowhead = (payload as Record<string, unknown>).flowhead;
  if (flowhead === undefined || flowhead === null) return null;
  return String(flowhead);
}

function dexPumpIdFrom(payload: unknown): string {
  if (typeof payload === "function") throw new ValidationError("ack: not a function");
  if (payload === null || payload === undefined) throw new ValidationError("body: required");
  if (typeof payload !== "object" || Array.isArray(payload)) throw new ValidationError("body: must be an object");
  const dexPumpId = (payload as Record<string, unknown>).dexPumpId;
  if (dexPumpId === undefined || dexPumpId === null) throw new ValidationError("dexPumpId: field required");
  return String(dexPumpId);
}

function configUpdatePayload(payload: unknown): { parameterId: number; value: unknown } {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = payload as Record<string, unknown>;
  const parameterId = body.parameterId;
  if (parameterId === undefined || parameterId === null) throw new ValidationError("parameterId: field required");
  const value = body.value;
  return { parameterId: Number(parameterId), value };
}

function flowheadCapacityFrom(payload: unknown): number {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = payload as Record<string, unknown>;
  const capacity = body.capacity;
  if (capacity === undefined || capacity === null) throw new ValidationError("capacity: field required");
  return Number(capacity);
}

function vsdTypeIdFrom(payload: unknown): number {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = payload as Record<string, unknown>;
  const vsdTypeId = body.vsdTypeId;
  if (vsdTypeId === undefined || vsdTypeId === null) throw new ValidationError("vsdTypeId: field required");
  return Number(vsdTypeId);
}

function pumpIdFrom(payload: unknown): number {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = payload as Record<string, unknown>;
  const pumpId = body.pumpId;
  if (pumpId === undefined || pumpId === null) throw new ValidationError("pumpId: field required");
  return Number(pumpId);
}

export function registerSocketHandlers(
  io: Server,
  deps: SocketHandlerDeps = {},
): void {
  const classify = deps.classify ?? classifyRequest;
  const health = deps.health ?? getHealthStatus;
  const listSetpoints = deps.listSetpoints ?? listProfileSetpoints;
  const readSetpoint = deps.readSetpoint ?? readProfileSetpoint;
  const updateSetpoint = deps.updateSetpoint ?? updateProfileSetpoint;
  const getEffectiveConfigFn = deps.getEffectiveConfig ?? getEffectiveConfig;
  const updateFlowheadConfigFn = deps.updateFlowheadConfig ?? updateFlowheadConfig;
  const updateVfdConfigFn = deps.updateVfdConfig ?? updateVfdConfig;
  const updateGlobalConfigFn = deps.updateGlobalConfig ?? updateGlobalConfig;
  const updatePumpConfigFn = deps.updatePumpConfig ?? updatePumpConfig;
  const getFlowheadConfigFn = deps.getFlowheadConfig ?? getFlowheadConfig;
  const getVfdConfigFn = deps.getVfdConfig ?? getVfdConfig;
  const getGlobalConfigFn = deps.getGlobalConfig ?? getGlobalConfigData;
  const getPumpConfigFn = deps.getPumpConfig ?? getPumpConfigData;

  io.on("connection", (socket) => {
    console.log("[classify] socket connected:", socket.id);

    socket.on("classify", (payload: unknown, ack: unknown) => {
      console.log("[classify] incoming request payload:", JSON.stringify(payload, null, 2));
      respond(ack, () => classify(payload));
    });

    socket.on("health", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), health);
    });

    socket.on("profile-setpoints:get", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), async () => {
        const flowheadId = flowheadIdFrom(payload);
        return flowheadId === null ? listSetpoints() : readSetpoint(flowheadId);
      });
    });

    socket.on("profile-setpoints:update", (payload: unknown, ack: unknown) => {
      respond(ack, async () => {
        if (
          payload === null ||
          typeof payload !== "object" ||
          Array.isArray(payload)
        ) {
          throw new ValidationError("body: request body must be an object");
        }
        const body = payload as Record<string, unknown>;
        const flowhead = body.flowhead;
        if (flowhead === undefined || flowhead === null) {
          throw new ValidationError("flowhead: field required");
        }
        return updateSetpoint(String(flowhead), body);
      });
    });

    socket.on("config:effective", (payload: unknown, ack: unknown) => {
      respond(ack, async () => {
        const dexPumpId = dexPumpIdFrom(payload);
        return getEffectiveConfigFn(dexPumpId);
      });
    });

    socket.on("config:flowhead:get", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), async () => {
        const capacity = flowheadCapacityFrom(payload);
        return getFlowheadConfigFn(capacity);
      });
    });

    socket.on("config:vfd:get", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), async () => {
        const vsdTypeId = vsdTypeIdFrom(payload);
        return getVfdConfigFn(vsdTypeId);
      });
    });

    socket.on("config:global:get", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), getGlobalConfigFn);
    });

    socket.on("config:pump:get", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), async () => {
        const pumpId = pumpIdFrom(payload);
        return getPumpConfigFn(pumpId);
      });
    });

    socket.on("config:flowhead:update", (payload: unknown, ack: unknown) => {
      respond(ack, async () => {
        const capacity = flowheadCapacityFrom(payload);
        const { parameterId, value } = configUpdatePayload(payload);
        return updateFlowheadConfigFn(capacity, parameterId, value);
      });
    });

    socket.on("config:vfd:update", (payload: unknown, ack: unknown) => {
      respond(ack, async () => {
        const vsdTypeId = vsdTypeIdFrom(payload);
        const { parameterId, value } = configUpdatePayload(payload);
        return updateVfdConfigFn(vsdTypeId, parameterId, value);
      });
    });

    socket.on("config:global:update", (payload: unknown, ack: unknown) => {
      respond(ack, async () => {
        const { parameterId, value } = configUpdatePayload(payload);
        return updateGlobalConfigFn(parameterId, value);
      });
    });

    socket.on("config:pump:update", (payload: unknown, ack: unknown) => {
      respond(ack, async () => {
        const dexPumpId = dexPumpIdFrom(payload);
        const { parameterId, value } = configUpdatePayload(payload);
        return updatePumpConfigFn(dexPumpId, parameterId, value);
      });
    });

    socket.on("disconnect", (reason) => {
      console.log("[classify] socket disconnected:", socket.id, reason);
    });
  });
}