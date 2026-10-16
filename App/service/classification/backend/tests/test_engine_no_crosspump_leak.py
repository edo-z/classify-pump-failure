"""Isolasi antar-pompa (Fase 2): config + state satu pompa tidak boleh
memengaruhi pompa lain (kapasitas sama, namespace dan config beda).
"""

from datetime import datetime, timezone

from app.classification.configuration_resolver import EffectiveRefs
from app.classification.models import PumpConfig
from app.classification.setpoints import resolve_effective_setpoint

from .conftest import make_reading


def _run(engine, power, rule_config, namespace):
    pc = PumpConfig(pump_id=5000, capacity_lps=5000)
    sp = resolve_effective_setpoint("5000_lps")
    reading = make_reading(
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        motor_speed=990.0,
        output_frequency=5.0,
        output_power=power,
        motor_current=900.0,
        # torque 100 < 110 MISS: kW satu-satunya penentu
        # (A dan RPM selalu MATCH).
        motor_torque=100.0,
    )
    return engine.classify(
        readings=[reading],
        pump_config=pc,
        operating_setpoint=sp,
        trigger_namespace=namespace,
        rule_config=rule_config,
    )


def test_config_does_not_leak_across_namespaces(engine):
    # Pompa A: ref override 600 -> kW 500 MISS PTS (500 < 600).
    res_a = _run(engine, 500.0, EffectiveRefs(power_kw=600.0), "test:iso:A")
    # Pompa B: tanpa override -> ref 400, kW 500 MATCH PTS.
    res_b = _run(engine, 500.0, None, "test:iso:B")
    pts_a = next(
        ev
        for ev in res_a.rule_evaluations
        if ev.trouble_type.value == "pompa_tersangkut_sampah"
    )
    pts_b = next(
        ev
        for ev in res_b.rule_evaluations
        if ev.trouble_type.value == "pompa_tersangkut_sampah"
    )
    assert pts_a.evaluation == "NO_MATCH"
    assert pts_b.evaluation == "MATCH"
    # Ulangi B setelah A: hasil B tetap (tidak terkontaminasi salinan A).
    res_b2 = _run(engine, 500.0, None, "test:iso:B")
    pts_b2 = next(
        ev
        for ev in res_b2.rule_evaluations
        if ev.trouble_type.value == "pompa_tersangkut_sampah"
    )
    assert pts_b2.evaluation == "MATCH"
