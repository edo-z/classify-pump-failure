#!/usr/bin/env node
/**
 * Static landing server (stdlib only, no dependencies).
 *
 * Serves an allowlisted set of files for classify.aldozeno.my.id after the
 * Next.js app was removed. HOST=127.0.0.1, PORT=3030 (Cloudflare tunnel
 * maps the public hostname here).
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../public", import.meta.url));
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3030);

const ALLOWED = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/config", { file: "config.html", type: "text/html; charset=utf-8" }],
  ["/config.html", { file: "config.html", type: "text/html; charset=utf-8" }],
  ["/aturan", { file: "aturan.html", type: "text/html; charset=utf-8" }],
  ["/aturan.html", { file: "aturan.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/config.js", { file: "config.js", type: "text/javascript; charset=utf-8" }],
  ["/config.css", { file: "config.css", type: "text/css; charset=utf-8" }],
  ["/data.json", { file: "data.json", type: "application/json; charset=utf-8" }],
  ["/js/socket.io.min.js", { file: "js/socket.io.min.js", type: "text/javascript; charset=utf-8" }],
]);

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' https://class-api.aldozeno.my.id; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed", {
      "content-type": "text/plain; charset=utf-8",
      allow: "GET, HEAD",
    });
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    send(response, 400, "Bad Request", {
      "content-type": "text/plain; charset=utf-8",
    });
    return;
  }

  if (pathname === "/healthz") {
    send(response, 200, JSON.stringify({ status: "ok", service: "landing" }), {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    return;
  }

  if (pathname === "/favicon.ico") {
    send(response, 204, "");
    return;
  }

  const entry = ALLOWED.get(pathname);
  if (!entry) {
    send(response, 404, "Not Found", {
      "content-type": "text/plain; charset=utf-8",
    });
    return;
  }

  try {
    const body = await readFile(path.join(ROOT, entry.file));
    send(response, 200, request.method === "HEAD" ? "" : body, {
      "content-type": entry.type,
      "content-length": String(body.byteLength),
      "cache-control":
        entry.file.endsWith(".html") ||
        entry.file === "styles.css" ||
        entry.file === "app.js" ||
        entry.file === "config.js" ||
        entry.file === "config.css" ||
        entry.file === "data.json"
          ? "no-cache"
          : "public, max-age=3600",
    });
  } catch (error) {
    console.error("[landing] read failed:", error);
    send(response, 500, "Internal Server Error", {
      "content-type": "text/plain; charset=utf-8",
    });
  }
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[landing] listening on http://${HOST}:${PORT}`);
});