import "dotenv/config";

import { createServer } from "node:http";
import { Server, type ServerOptions } from "socket.io";

import { getHealthStatus } from "./application/health.ts";
import { startSocketBridge } from "./socket/bridge.ts";
import {
  registerSocketHandlers,
  type SocketHandlerDeps,
} from "./socket/handlers.ts";

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
  io: Server;
  upstream: ReturnType<typeof startSocketBridge>;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const httpServer = createServer();
  const io = new Server(httpServer, socketOptions());
  registerSocketHandlers(io, options.socketDeps);

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.PORT ?? 3031);

  await new Promise<void>((resolve) => {
    httpServer.listen(requestedPort, host, () => {
      resolve();
    });
  });

  const address = httpServer.address();
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
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
  };

  return { io, upstream, host, port, close };
}

async function main(): Promise<void> {
  const server = await startServer({ startBridge: true });
  console.log(
    `[classify] listening on http://${server.host}:${server.port} (Socket.IO)`,
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
