import "dotenv/config";

import Fastify, { type FastifyInstance } from "fastify";
import { Server, type ServerOptions } from "socket.io";

import { registerClassifyRoutes } from "./api/classify.ts";
import { registerProfileSetpointRoutes } from "./api/profileSetpoints.ts";
import { getHealthStatus } from "./application/health.ts";
import { registerApiKey } from "./middleware/apiKey.ts";
import { startSocketBridge } from "./socket/bridge.ts";
import {
  registerSocketHandlers,
  type SocketHandlerDeps,
} from "./socket/handlers.ts";

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

  app.get("/health", async () => getHealthStatus());

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

function socketOptions(): Partial<ServerOptions> {
  const origin = (process.env.CLASSIFICATION_SOCKET_ORIGIN ?? "").trim();
  return {
    path: "/socket.io",
    serveClient: false,
    maxHttpBufferSize: 1_000_000,
    ...(origin
      ? {
          cors: {
            origin: origin
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          },
        }
      : {}),
  };
}

export interface StartServerOptions {
  port?: number;
  host?: string;
  startBridge?: boolean;
  socketDeps?: SocketHandlerDeps;
}

export interface RunningServer {
  app: FastifyInstance;
  io: Server;
  upstream: ReturnType<typeof startSocketBridge>;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const app = buildApp();
  const io = new Server(app.server, socketOptions());
  registerSocketHandlers(io, options.socketDeps);

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.PORT ?? 3031);

  await app.listen({ port: requestedPort, host });

  const address = app.server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : requestedPort;

  const upstream = options.startBridge ? startSocketBridge(io) : null;
  let closing = false;

  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    upstream?.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    try {
      await app.close();
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        throw exc;
      }
    }
  };

  return { app, io, upstream, host, port, close };
}

async function main(): Promise<void> {
  const server = await startServer({ startBridge: true });
  console.log(
    `[classify] listening on http://${server.host}:${server.port} (HTTP + Socket.IO)`,
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("[classify] shutdown error:", err);
        process.exit(1);
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
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
