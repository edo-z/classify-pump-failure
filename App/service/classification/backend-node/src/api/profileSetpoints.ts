/**
 * Per-profile setpoint API — 1:1 port of ``app/api/profile_setpoints.py``.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  PROFILE_SETPOINTS_FILE,
  getProfileSetpoint,
  loadProfileSetpoints,
  saveProfileSetpoint,
  type ProfileSetpoint,
} from "../engine/setpoints.ts";
import { ProfileNotFoundError } from "../engine/profiles.ts";
import { ValidationError } from "./classify.ts";

function coerceGe0(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "") n = Number(value);
  else throw new ValidationError(`${field}: value is not a valid number`);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field}: value must be a finite number`);
  }
  if (n < 0) throw new ValidationError(`${field}: Input should be greater than or equal to 0`);
  return n;
}

/**
 * Merge a (possibly partial) update onto the current setpoint.
 *
 * An absent field keeps the stored value; an explicit ``null`` clears it.
 * This prevents a partial PUT from silently wiping ``rpm``/``torque``.
 */
export function parseUpdate(
  rawBody: unknown,
  current: ProfileSetpoint,
): ProfileSetpoint {
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new ValidationError("body: request body must be an object");
  }
  const body = rawBody as Record<string, unknown>;
  const pick = (field: keyof ProfileSetpoint): number | null =>
    Object.prototype.hasOwnProperty.call(body, field)
      ? coerceGe0(body[field], field)
      : current[field];
  return {
    frequency_hz: pick("frequency_hz"),
    rpm: pick("rpm"),
    torque: pick("torque"),
  };
}

export function registerProfileSetpointRoutes(app: FastifyInstance): void {
  app.get("/profile-setpoints", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(loadProfileSetpoints());
  });

  app.get(
    "/profile-setpoints/:profile_id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { profile_id } = request.params as { profile_id: string };
      try {
        return reply.code(200).send(getProfileSetpoint(profile_id));
      } catch (exc) {
        if (exc instanceof ProfileNotFoundError) {
          return reply.code(404).send({ detail: `Unknown pump profile: ${profile_id}` });
        }
        throw exc;
      }
    },
  );

  app.put(
    "/profile-setpoints/:profile_id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { profile_id } = request.params as { profile_id: string };
      try {
        const current = getProfileSetpoint(profile_id);
        const setpoint = parseUpdate(request.body, current);
        const saved = saveProfileSetpoint(profile_id, setpoint, PROFILE_SETPOINTS_FILE);
        return reply.code(200).send(saved);
      } catch (exc) {
        if (exc instanceof ProfileNotFoundError) {
          return reply.code(404).send({ detail: `Unknown pump profile: ${profile_id}` });
        }
        if (exc instanceof ValidationError) {
          return reply.code(422).send({ detail: exc.message });
        }
        throw exc;
      }
    },
  );
}
