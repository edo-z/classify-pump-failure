/**
 * Fastify server assembly — 1:1 port of ``app/main.py``.
 *
 * Endpoints: POST /classify, GET /profile-setpoints[/:id],
 * PUT /profile-setpoints/:id, GET /health, GET /.
 */

import { readFileSync } from "node:fs";

import Fastify, { type FastifyInstance } from "fastify";

import { registerClassifyRoutes } from "./api/classify.ts";
import { registerProfileSetpointRoutes } from "./api/profileSetpoints.ts";
import { RULES_FILE } from "./engine/engine.ts";
import {
  PROFILE_SETPOINTS_FILE,
  loadProfileSetpoints,
} from "./engine/setpoints.ts";
import { registerApiKey } from "./middleware/apiKey.ts";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  // CORS: allow all origins (mirrors CORSMiddleware(allow_origins=["*"])).
  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "*");
    reply.header("access-control-allow-headers", "*");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  registerApiKey(app);
  registerProfileSetpointRoutes(app);
  registerClassifyRoutes(app);

  app.get("/health", async () => {
    let rulesExists = false;
    let rulesLoaded = false;
    let rulesError: string | null = null;
    try {
      const data = JSON.parse(readFileSync(RULES_FILE, "utf-8")) as unknown;
      rulesExists = true;
      rulesLoaded =
        typeof data === "object" && data !== null && "tiers" in (data as object);
      if (!rulesLoaded) rulesError = "invalid schema: missing 'tiers'";
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code !== "ENOENT") {
        rulesExists = true;
        rulesError = exc instanceof SyntaxError ? "invalid JSON" : "unreadable";
      }
    }

    let setpointsExists = false;
    let setpointsLoaded = false;
    let setpointsError: string | null = null;
    try {
      readFileSync(PROFILE_SETPOINTS_FILE, "utf-8");
      setpointsExists = true;
      loadProfileSetpoints();
      setpointsLoaded = true;
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code !== "ENOENT") {
        setpointsExists = true;
        setpointsError =
          exc instanceof SyntaxError ? "invalid JSON" : "unreadable";
      } else {
        // Missing file is valid: defaults (null) apply.
        setpointsLoaded = true;
      }
    }

    return {
      status: rulesLoaded && setpointsLoaded ? "ok" : "degraded",
      rules_exists: rulesExists,
      rules_loaded: rulesLoaded,
      rules_error: rulesError,
      setpoints_exists: setpointsExists,
      setpoints_loaded: setpointsLoaded,
      setpoints_error: setpointsError,
    };
  });

  app.get("/", async () => ({
    service: "Pump Trouble Classification",
    interfaces: {
      classify: "/classify",
      profile_setpoints: "/profile-setpoints",
      health: "/health",
    },
  }));

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ detail: "Not Found" });
  });

  app.setErrorHandler(async (rawError, _request, reply) => {
    const error = rawError as { code?: string; statusCode?: number; message: string };
    if (error.code === "FST_ERR_CTP_INVALID_JSON" || error.statusCode === 400) {
      return reply.code(422).send({ detail: "Invalid JSON body" });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      // Never expose internal paths / file contents to clients.
      console.error("[classification-node] internal error:", rawError);
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
    return reply.code(status).send({ detail: error.message });
  });

  return app;
}

async function main(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3031);
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
