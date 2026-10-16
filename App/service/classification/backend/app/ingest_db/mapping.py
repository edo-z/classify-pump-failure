"""Mapping parameter_definitions.key -> field kanonis SensorReading.

Key production belum tentu sama dengan nama di bawah: daftar ini
best-effort dan dapat dioverride via env CLASSIFICATION_DB_KEYMAP
(JSON {"param_key": "sensor_field"}). Key yang tidak terpetakan
diabaikan (debug log) — JANGAN menebak nilai. Key final dikunci
setelah `SELECT DISTINCT key FROM parameter_definitions` di 8.4.x.

Nilai VARCHAR diparse toleran (koma-desimal Indonesia, himpunan NULL):
  "2,25" -> 2.25 ; "1.234,56" -> 1234.56
  {"", "null", "na", "n/a", "nan", "none", "-", "--"} -> None
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any

from app.classification.models import SensorReading

logger = logging.getLogger(__name__)

NULL_TOKENS = {"", "null", "na", "n/a", "nan", "none", "-", "--"}

DEFAULT_KEY_MAPPING: dict[str, str] = {
    # Canonical engine fields (V1Reading / SensorReading).
    "motor_speed": "motor_speed",
    "rpm": "motor_speed",
    "output_frequency": "output_frequency",
    "frequency": "output_frequency",
    "frekuensi": "output_frequency",
    "motor_current": "motor_current",
    "current": "motor_current",
    "arus": "motor_current",
    "motor_torque": "motor_torque",
    "torque": "motor_torque",
    "torsi": "motor_torque",
    "output_power": "output_power",
    "power": "output_power",
    "daya": "output_power",
    "hours_run": "hours_run",
    "output_voltage": "output_voltage",
    "ambient_temperature": "ambient_temperature",
    "control_board_temperature": "control_board_temperature",
    "inverter_temperature": "inverter_temperature",
    "input_voltage": "input_voltage",
    "flux_actual": "flux_actual",
    "motor_estimated_temperature": "motor_estimated_temperature",
    "arus_rms_u": "arus_rms_u",
    "arus_rms_v": "arus_rms_v",
    "arus_rms_w": "arus_rms_w",
}


def load_key_mapping() -> dict[str, str]:
    mapping = dict(DEFAULT_KEY_MAPPING)
    raw = os.getenv("CLASSIFICATION_DB_KEYMAP")
    if raw:
        try:
            extra = json.loads(raw)
            if isinstance(extra, dict):
                mapping.update({str(k): str(v) for k, v in extra.items()})
        except ValueError as exc:
            logger.warning("CLASSIFICATION_DB_KEYMAP invalid JSON: %s", exc)
    return mapping


def parse_decimal(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.lower() in NULL_TOKENS:
        return None
    try:
        if "," in text:
            # "1.234,56" -> "1234.56" ; "2,25" -> "2.25"
            text = text.replace(".", "").replace(",", ".")
        return float(text)
    except ValueError:
        return None


def to_sensor_reading(
    params: list,
    evaluated_at: datetime,
    mapping: dict[str, str] | None = None,
) -> SensorReading:
    """Bentuk satu SensorReading dari snapshot parameter.

    Field yang tidak terpetakan / tidak terparse = None (jangan 0).
    Timestamp = evaluated_at (event-time), bukan waktu polling.
    """
    mapping = mapping if mapping is not None else load_key_mapping()
    payload: dict[str, Any] = {"timestamp": evaluated_at}
    for sample in params:
        if isinstance(sample, dict):
            key = sample.get("key")
            raw = sample.get("value")
        else:
            key = getattr(sample, "key", None)
            raw = getattr(sample, "value", None)
        field = mapping.get(str(key)) if key is not None else None
        if field is None:
            logger.debug("unmapped parameter key: %r", key)
            continue
        if field not in payload:
            payload[field] = parse_decimal(raw)
    return SensorReading.model_validate(payload)
