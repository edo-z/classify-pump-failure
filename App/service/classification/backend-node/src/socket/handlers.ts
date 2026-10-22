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
} from "../application/setpoints.ts";
import { ProfileNotFoundError } from "../engine/profiles.ts";
import type { ProfileSetpoint } from "../engine/setpoints.ts";

export type SocketErrorCode = "VALIDATION" | "NOT_FOUND" | "INTERNAL";

export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: SocketErrorCode; message: string } };

export interface SocketHandlerDeps {
  classify?: (payload: unknown) => ClassifyResponseBody;
  health?: () => HealthStatus;
  listSetpoints?: () => Record<string, ProfileSetpoint>;
  readSetpoint?: (profileId: string) => ProfileSetpoint;
  updateSetpoint?: (profileId: string, body: unknown) => ProfileSetpoint;
}

function socketError(exc: unknown): { code: SocketErrorCode; message: string } {
  if (exc instanceof ValidationError) {
    return { code: "VALIDATION", message: exc.message };
  }
  if (exc instanceof NotFoundError) {
    return { code: "NOT_FOUND", message: exc.message };
  }
  if (exc instanceof ProfileNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: `Unknown pump profile: ${exc.message}`,
    };
  }
  console.error("[classify] socket internal error:", exc);
  return { code: "INTERNAL", message: "Internal Server Error" };
}

function respond<T>(ack: unknown, run: () => T): void {
  if (typeof ack !== "function") return;
  try {
    ack({ ok: true, data: run() } satisfies SocketAck<T>);
  } catch (exc) {
    ack({ ok: false, error: socketError(exc) } satisfies SocketAck<T>);
  }
}

function ackFrom(payload: unknown, ack: unknown): unknown {
  if (typeof ack === "function") return ack;
  if (typeof payload === "function") return payload;
  return undefined;
}

function profileIdFrom(payload: unknown): string | null {
  if (typeof payload === "function") return null;
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("body: request body must be an object");
  }
  const flowhead = (payload as Record<string, unknown>).flowhead;
  if (flowhead === undefined || flowhead === null) return null;
  return String(flowhead);
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

  io.on("connection", (socket) => {
    console.log("[classify] socket connected:", socket.id);

    socket.on("classify", (payload: unknown, ack: unknown) => {
      respond(ack, () => classify(payload));
    });

    socket.on("health", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), health);
    });

    socket.on("profile-setpoints:get", (payload: unknown, ack: unknown) => {
      respond(ackFrom(payload, ack), () => {
        const profileId = profileIdFrom(payload);
        return profileId === null ? listSetpoints() : readSetpoint(profileId);
      });
    });

    socket.on("profile-setpoints:update", (payload: unknown, ack: unknown) => {
      respond(ack, () => {
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

    socket.on("disconnect", (reason) => {
      console.log("[classify] socket disconnected:", socket.id, reason);
    });
  });
}
