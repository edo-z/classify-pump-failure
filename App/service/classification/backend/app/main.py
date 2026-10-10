from fastapi import FastAPI
from fastapi.middleware.cors import (
    CORSMiddleware,
)
import logging

logger = logging.getLogger(__name__)

from app.api.classification import (
    router as classification_router,
)
from app.api.documents import (
    router as documents_router,
)
from app.api.normalization import (
    router as normalization_router,
)
from app.api.profile_setpoints import router as profile_setpoints_router
from app.classification.engine import (
    RULES_FILE,
)

app = FastAPI(
    title="Pump Trouble Classification Service",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    documents_router
)
app.include_router(
    normalization_router
)
app.include_router(
    classification_router
)

app.include_router(
    profile_setpoints_router
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
            "documents": "/documents",
            "normalization": (
                "/normalization"
            ),
            "classification": (
                "/classification"
            ),
            "health": "/health",
            "docs": "/docs",
        },
    }



from app.api.telemetry import router as telemetry_router

app.include_router(telemetry_router)
