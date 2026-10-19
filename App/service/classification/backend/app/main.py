from fastapi import FastAPI
from fastapi.middleware.cors import (
    CORSMiddleware,
)
import logging

# 5R/Rawat: log proses wajib terlihat (root tanpa handler membuat
# logger.info aplikasi tenggelam).
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

from app.api.profile_setpoints import router as profile_setpoints_router
from app.api.v1 import router as v1_router
from app.api_key import ApiKeyMiddleware
from app.classification.engine import (
    RULES_FILE,
)

app = FastAPI(
    title="Pump Trouble Classification Service",
)

app.add_middleware(ApiKeyMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    profile_setpoints_router
)

# v1 — kontrak stabil tim BE (single-shot, stateless).
app.include_router(
    v1_router
)


@app.get("/health")
def health():
    import json

    rules_file = RULES_FILE
    exists = rules_file.exists()
    loaded = False
    error = None
    if exists:
        try:
            with open(rules_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            loaded = isinstance(data, dict) and "tiers" in data
            if not loaded:
                error = "invalid schema: missing 'tiers'"
        except Exception as exc:
            error = str(exc)
            logger.warning("health rules load failed: %s", exc)
    if not loaded:
        status = "degraded"
    else:
        status = "ok"
    return {
        "status": status,
        "rules_exists": exists,
        "rules_loaded": loaded,
        "rules_error": error,
    }


@app.get("/")
def root():
    return {
        "service": (
            "Pump Trouble Classification"
        ),
        "interfaces": {
            "v1": "/v1/classify",
            "profile_setpoints": (
                "/profile-setpoints"
            ),
            "health": "/health",
            "docs": "/docs",
        },
    }
