/**
 * HTTP adapter for the per-profile setpoint application contract.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  listProfileSetpoints,
  readProfileSetpoint,
  updateProfileSetpoint,
} from "../application/setpoints.ts";
import { ValidationError } from "../application/errors.ts";
import { ProfileNotFoundError } from "../engine/profiles.ts";

export { parseUpdate } from "../application/setpoints.ts";

export function registerProfileSetpointRoutes(app: FastifyInstance): void {
  app.get("/profile-setpoints", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(listProfileSetpoints());
  });

  app.get(
    "/profile-setpoints/:profile_id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { profile_id } = request.params as { profile_id: string };
      try {
        return reply.code(200).send(readProfileSetpoint(profile_id));
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
        return reply.code(200).send(updateProfileSetpoint(profile_id, request.body));
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
