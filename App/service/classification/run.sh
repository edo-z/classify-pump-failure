#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_DIR="$SCRIPT_DIR/backend"
PYTHON="$BACKEND_DIR/venv/bin/python"

if [ ! -x "$PYTHON" ]; then
    echo "ERROR: backend Python not found: $PYTHON" >&2
    exit 1
fi

cd "$BACKEND_DIR"

exec "$PYTHON" -m app.cli "$@"
