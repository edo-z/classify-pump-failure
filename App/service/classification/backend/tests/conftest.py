"""Shared fixtures for classification contract tests (5R Rawat, FMEA F2/F3/F8)."""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

# 5R/Resik insiden 2026-10-12: pytest JANGAN PERNAH menyentuh folder
# data asli. Set env SEBELUM import app (root dibaca saat import).
_tmp_data = Path(tempfile.mkdtemp(prefix="classif-test-"))
os.environ.setdefault(
    "CLASSIFICATION_INPUT_DIR",
    str(_tmp_data / "classification-input"),
)
os.environ.setdefault(
    "CLASSIFICATION_NORMALIZED_DIR",
    str(_tmp_data / "classification-normalized"),
)

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.classification.engine import RULES_FILE, RulesEngine  # noqa: E402
from app.classification.models import OperatingSetpoint, PumpConfig, SensorReading  # noqa: E402


@pytest.fixture()
def engine() -> RulesEngine:
    return RulesEngine(RULES_FILE)


@pytest.fixture()
def pump_5000() -> PumpConfig:
    return PumpConfig(pump_id=5000, capacity_lps=5000)


@pytest.fixture()
def setpoint_40() -> OperatingSetpoint:
    return OperatingSetpoint(frequency=40.0, rpm=990, torque=90)


def make_reading(ts: datetime, **overrides) -> SensorReading:
    base = {
        "timestamp": ts,
        "motor_speed": 990.0,
        "output_frequency": 35.0,
        "motor_current": 850.0,
        "motor_torque": 95.0,
        "output_power": 405.0,
        "ambient_temperature": 30.0,
        "control_board_temperature": 40.0,
        "inverter_temperature": 45.0,
        "input_voltage": 380.0,
        "arus_rms_u": 100.0,
        "arus_rms_v": 100.0,
        "arus_rms_w": 100.0,
    }
    base.update(overrides)
    return SensorReading.model_validate(base)


@pytest.fixture()
def base_ts() -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc)


def series_1s(base: datetime, n: int, **overrides) -> list[SensorReading]:
    return [make_reading(base + timedelta(seconds=i), **overrides) for i in range(n)]
