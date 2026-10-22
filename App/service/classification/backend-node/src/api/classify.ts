/**
 * HTTP adapter for the classification application contract.
 *
 * ``POST /classify`` is the stable, single-shot, stateless contract for the
 * BE team: the server trims evidence (trailing 31 after a 10 s gap).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { classifyRequest } from "../application/classify.ts";
import { NotFoundError, ValidationError } from "../application/errors.ts";

export { classifyRequest } from "../application/classify.ts";
export type { ClassifyResponseBody } from "../application/classify.ts";
export { NotFoundError, ValidationError } from "../application/errors.ts";

export function registerClassifyRoutes(app: FastifyInstance): void {
  app.post("/classify", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = classifyRequest(request.body);
      return reply.code(200).send(result);
    } catch (exc) {
      if (exc instanceof NotFoundError) {
        return reply.code(404).send({ detail: exc.message });
      }
      if (exc instanceof ValidationError) {
        return reply.code(422).send({ detail: exc.message });
      }
      throw exc;
    }
  });
}
