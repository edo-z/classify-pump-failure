#!/usr/bin/env bash
set -euo pipefail

# Jalankan backend klasifikasi Node.js (TypeScript + Fastify).
# Produksi memakai systemd user `classify-pump-node` (:3031); skrip ini untuk
# pemakaian manual/dev. Lingkungan: HOST (default 127.0.0.1), PORT (default 3031),
# CLASSIFICATION_API_KEY (kosong = terbuka, DEV saja).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend-node"
NODE_BIN="${NODE_BIN:-node}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
    echo "ERROR: node runtime not found: $NODE_BIN" >&2
    exit 1
fi

cd "$BACKEND_DIR"

exec "$NODE_BIN" src/server.ts "$@"
