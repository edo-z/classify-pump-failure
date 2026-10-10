"""v1 — kontrak stabil untuk tim BE (apps/web).

Satu-satunya endpoint klasifikasi yang dijamin stabil: single-shot,
stateless, tanpa CSV/storage/session. Aturan 100% milik engine ini
(`rules.json` + `RulesEngine`); tim BE hanya memetakan payload MQTT
mereka ke reading kanonis dan mengirim jendela mentah terakhir —
server yang memangkas evidensi (trailing 31 pasca-gap 10 dtk).
"""

from __future__ import annotations

import functools
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.classification.engine import RULES_FILE
from app.classification.evidence import (
    EVIDENCE_MAXLEN,
    LIVE_GAP_THRESHOLD_MS,
    build_trailing_evidence,
)
from app.classification.models import (
    ClassificationResult,
    PumpConfig,
    SensorReading,
)
from app.classification.profiles import get_profile_capacity
from app.classification.service import get_engine
from app.classification.setpoints import resolve_effective_setpoint

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["v1"])

# Batas jendela per panggilan: cukup untuk evidensi 31 + toleransi,
# kecil untuk menolak penyalahgunaan payload raksasa.
MAX_WINDOW_READINGS = 40


@functools.lru_cache(maxsize=1)
def get_rules_version() -> str:
    """Versi rules.json — deteksi drift aturan dari sisi BE."""
    try:
        raw = json.loads(RULES_FILE.read_text(encoding="utf-8"))
        version = raw.get("version")
        return str(version) if version is not None else "unknown"
    except Exception as exc:
        logger.warning("rules version read failed: %s", exc)
        return "unknown"


class V1Reading(BaseModel):
    """Satu sampel sensor — nama kanonis, hilang = null (jangan 0)."""

    timestamp: datetime
    motor_speed: float | None = None
    output_frequency: float | None = None
    motor_current: float | None = None
    motor_torque: float | None = None
    output_power: float | None = None
    hours_run: float | None = None
    output_voltage: float | None = None
    ambient_temperature: float | None = None
    control_board_temperature: float | None = None
    inverter_temperature: float | None = None
    input_voltage: float | None = None
    flux_actual: float | None = None
    motor_estimated_temperature: float | None = None
    arus_rms_u: float | None = None
    arus_rms_v: float | None = None
    arus_rms_w: float | None = None

    model_config = {"extra": "ignore"}


class V1ClassifyRequest(BaseModel):
    profile_id: str = Field(examples=["5000_lps"])
    setpoint_freq: float | None = Field(default=None, examples=[40.0])
    namespace: str = Field(
        min_length=1,
        max_length=64,
        description="ID site BE (mis. '96') — isolasi counter antar-site",
        examples=["96"],
    )
    readings: list[V1Reading] = Field(min_length=1, max_length=MAX_WINDOW_READINGS)


class V1ClassifyResponse(BaseModel):
    profile_id: str
    namespace: str
    rules_version: str
    evidence_size: int
    classification: ClassificationResult


def _to_sensor_reading(raw: V1Reading) -> SensorReading:
    if raw.timestamp.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="timestamp must be timezone-aware ISO-8601 (event-time wajib zona waktu)",
        )
    return SensorReading.model_validate(raw.model_dump())


@router.post("/classify", response_model=V1ClassifyResponse)
def classify_single_shot(req: V1ClassifyRequest) -> V1ClassifyResponse:
    """Vonis satu jendela: pembacaan terakhir + evidensi trailing 31 pasca-gap."""
    readings = [_to_sensor_reading(r) for r in req.readings]
    ordered = sorted(readings, key=lambda r: r.timestamp)
    evidence = build_trailing_evidence(
        ordered, len(ordered) - 1, LIVE_GAP_THRESHOLD_MS, EVIDENCE_MAXLEN
    )
    if not evidence:
        raise HTTPException(
            status_code=422, detail="No usable readings after gap trimming"
        )

    try:
        capacity_lps = get_profile_capacity(req.profile_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"Unknown pump profile: {req.profile_id}"
        ) from exc

    pump_config = PumpConfig(pump_id=capacity_lps, capacity_lps=capacity_lps)
    operating_setpoint = resolve_effective_setpoint(
        req.profile_id, override_freq=req.setpoint_freq
    )
    engine = get_engine()
    classification = engine.classify(
        readings=evidence,
        pump_config=pump_config,
        operating_setpoint=operating_setpoint,
        trigger_namespace=f"site:{req.namespace}",
    )
    return V1ClassifyResponse(
        profile_id=req.profile_id,
        namespace=req.namespace,
        rules_version=get_rules_version(),
        evidence_size=len(evidence),
        classification=classification,
    )
