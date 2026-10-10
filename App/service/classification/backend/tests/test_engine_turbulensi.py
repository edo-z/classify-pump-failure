"""C5 — Turbulensi strict 4/4 + referensi adaptif CMA (selaras spek).

T_F ∧ T_KW ∧ T_A ∧ T_T. T_A memakai MA30 bila histori ≥30,
CMA_n (rata-rata n histori valid) bila 1 ≤ n < 30; n = 0 → insufficient.
"""

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


def test_turbulensi_cma29_match_with_30(engine, pump_5000, setpoint_40, base_ts):
    # 29 histori + jump Δ15 vs CMA29=850 → MATCH (dulu insufficient).
    readings = _steady(base_ts, 29)
    readings.append(make_reading(base_ts + timedelta(seconds=29), motor_current=865.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-cma29")
    assert res.trouble_type == TroubleType.TURBULENSI
    assert any("CMA29" in m for r in res.matched_rules for m in r.matched_conditions)


def test_turbulensi_cma5_match_spec_example(engine, pump_5000, setpoint_40, base_ts):
    # Contoh spek: 5 histori + jump → CMA_5 → MATCH.
    readings = _steady(base_ts, 5)
    readings.append(make_reading(base_ts + timedelta(seconds=5), motor_current=865.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-cma5")
    assert res.trouble_type == TroubleType.TURBULENSI
    assert any("CMA5" in m for r in res.matched_rules for m in r.matched_conditions)


def test_turbulensi_cma1_match(engine, pump_5000, setpoint_40, base_ts):
    readings = _steady(base_ts, 1)
    readings.append(make_reading(base_ts + timedelta(seconds=1), motor_current=865.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-cma1")
    assert res.trouble_type == TroubleType.TURBULENSI


def test_turbulensi_cma_boundary(engine, pump_5000, setpoint_40, base_ts):
    # Δ tepat 10 vs CMA5 → MATCH; Δ 9.9 → NO_MATCH.
    readings = _steady(base_ts, 5)
    readings.append(make_reading(base_ts + timedelta(seconds=5), motor_current=860.0,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-cma10")
    assert res.trouble_type == TroubleType.TURBULENSI
    readings = _steady(base_ts, 5)
    readings.append(make_reading(base_ts + timedelta(seconds=5), motor_current=859.9,
                                 output_frequency=35.0, output_power=405.0, motor_torque=95.0))
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-cma99")
    assert res.trouble_type != TroubleType.TURBULENSI


def test_turbulensi_insufficient_with_zero_history(engine, pump_5000, setpoint_40, base_ts):
    # Hanya current (n=0, mis. trail len 1 pasca-gap) → tetap NO_MATCH.
    readings = [make_reading(base_ts, motor_current=865.0,
                             output_frequency=35.0, output_power=405.0, motor_torque=95.0)]
    res = engine.classify(readings, pump_5000, setpoint_40, trigger_namespace="test:turb-zero")
    assert res.trouble_type != TroubleType.TURBULENSI
    assert any("need_30_got_0" in lim for lim in res.limitations)


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
