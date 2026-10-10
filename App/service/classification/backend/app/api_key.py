"""API-key gate untuk konsumen luar (tim BE).

Bila CLASSIFICATION_API_KEY kosong (default DEV): terbuka + warning sekali
saat startup. Bila di-set: semua endpoint wajib header X-API-Key yang cocok,
kecuali health/akar/dokumentasi.
"""

from __future__ import annotations

import logging
import os

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger(__name__)

API_KEY_HEADER = "X-API-Key"
API_KEY_ENV = "CLASSIFICATION_API_KEY"

EXEMPT_PREFIXES = ("/health", "/docs", "/openapi.json", "/redoc")
EXEMPT_EXACT = frozenset({"/"})

_warned_open = False


def _expected_key() -> str:
    return os.getenv(API_KEY_ENV, "").strip()


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        global _warned_open
        path = request.url.path
        if path in EXEMPT_EXACT or path.startswith(EXEMPT_PREFIXES):
            return await call_next(request)
        expected = _expected_key()
        if not expected:
            if not _warned_open:
                _warned_open = True
                logger.warning(
                    "CLASSIFICATION_API_KEY empty — API terbuka (DEV saja)"
                )
            return await call_next(request)
        provided = request.headers.get(API_KEY_HEADER, "")
        if not provided or provided != expected:
            return JSONResponse(
                status_code=401, content={"detail": "Invalid or missing API key"}
            )
        return await call_next(request)
