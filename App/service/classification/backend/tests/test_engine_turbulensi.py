"""C5 — Turbulensi butuh 31 kontigu (30 histori + jump Δ≥10A)."""

from datetime import timedelta

from app.classification.evidence import build_trailing_evidence
from app.classification.models import TroubleType

from .conftest import make_reading


def _steady(base_ts, n, current=850.0):
    return [make_reading(base_ts + timedelta(seconds=i), motor_current=current,
                         output_frequency=35.0, output_power=405.0,
                         motor_torque=95.0) for i in range(n)]


def test_turbulensi_match_with_31_contiguous(engine, pump_5000, setpoint_40, base_ts):
    readings = _steady(base_ts, 30)
    readings.append(make_reading(base_ts + timedelta(seconds=30), motor_current=865.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-ok")
    assert res.trouble_type == TroubleType.TURBULENSI


def test_turbulensi_insufficient_with_29(engine, pump_5000, setpoint_40, base_ts):
    readings = _steady(base_ts, 29)
    readings.append(make_reading(base_ts + timedelta(seconds=29), motor_current=865.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-short")
    assert res.trouble_type != TroubleType.TURBULENSI
    assert any("30" in lim for lim in res.limitations)


def test_turbulensi_delta_below_threshold(engine, pump_5000, setpoint_40, base_ts):
    readings = _steady(base_ts, 30)
    readings.append(make_reading(base_ts + timedelta(seconds=30), motor_current=859.9,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-delta")
    assert res.trouble_type != TroubleType.TURBULENSI


def test_turbulensi_gap_resets_evidence(engine, pump_5000, setpoint_40, base_ts):
    readings = _steady(base_ts, 30)
    readings.append(make_reading(base_ts + timedelta(seconds=30 + 60), motor_current=865.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    trail = build_trailing_evidence(readings, len(readings) - 1, 10000)
    assert len(trail) == 1
    res = engine.classify(trail, pump_5000, setpoint_40, trigger_namespace="test:turb-gap")
    assert res.trouble_type != TroubleType.TURBULENSI
