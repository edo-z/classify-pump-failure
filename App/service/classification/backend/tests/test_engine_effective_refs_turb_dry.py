"""Ref efektif di TURBULENSI + DRY_RUN, power dan arus (Tahap 1 gap-test).

Melengkapi test_engine_effective_refs.py (yang baru membuktikan PTS +
BANYAK_SAMPAH + ref power). Tier 3000, ref lama 250 kW / 517 A.
Semua asertasi pada RuleEvaluation per trouble (bukan trouble_type
final) karena engine bisa match lebih dari satu famili sekaligus.
"""

from datetime import timedelta

from app.classification.configuration_resolver import EffectiveRefs
from app.classification.models import PumpConfig, TroubleType
from app.classification.setpoints import resolve_effective_setpoint

from .conftest import make_reading


def _classify(engine, readings, rule_config, namespace):
    pc = PumpConfig(pump_id=3000, capacity_lps=3000)
    sp = resolve_effective_setpoint("3000_lps")
    return engine.classify(
        readings=readings,
        pump_config=pc,
        operating_setpoint=sp,
        trigger_namespace=namespace,
        rule_config=rule_config,
    )


def _eval(result, trouble):
    return next(
        ev.evaluation
        for ev in result.rule_evaluations
        if ev.trouble_type == trouble
    )


def test_turbulensi_uses_effective_power_ref(engine, base_ts):
    # 30x current=500 + terakhir 520 -> T_A Δ20>=10 MATCH di kedua config.
    # freq 30 < sp 38, torque 95 >= 90 MATCH. kW=260 penentu:
    # lama (250) T_KW MATCH -> 4/4 MATCH; baru (270) MISS -> NO_MATCH.
    readings = [
        make_reading(
            base_ts + timedelta(seconds=i),
            motor_speed=990.0,
            output_frequency=30.0,
            output_power=260.0,
            motor_current=500.0 if i < 30 else 520.0,
            motor_torque=95.0,
        )
        for i in range(31)
    ]
    old = _classify(engine, readings, None, "test:turb:old")
    new = _classify(
        engine, readings, EffectiveRefs(power_kw=270.0), "test:turb:new"
    )
    assert _eval(old, TroubleType.TURBULENSI) == "MATCH"
    assert _eval(new, TroubleType.TURBULENSI) == "NO_MATCH"


def test_dry_run_uses_effective_power_ref(engine, base_ts):
    # DR_F: freq 38.00 == sp. DR_C: current 300 <= 330.88 (kedua config),
    # torque 60 < 70. kW=175 penentu: lama (DR_KW 166.75) MISS,
    # baru (DR_KW 0.667*270=180.09) MATCH.
    reading = make_reading(
        base_ts,
        motor_speed=990.0,
        output_frequency=38.0,
        output_power=175.0,
        motor_current=300.0,
        motor_torque=60.0,
    )
    old = _classify(engine, [reading], None, "test:drykw:old")
    new = _classify(
        engine, [reading], EffectiveRefs(power_kw=270.0), "test:drykw:new"
    )
    assert _eval(old, TroubleType.DRY_RUN) == "NO_MATCH"
    assert _eval(new, TroubleType.DRY_RUN) == "MATCH"


def test_dry_run_uses_effective_current_ref(engine, base_ts):
    # Koreksi: power 150 kW (<= 166.75 lama maupun 180.09 baru) sehingga
    # kondisi daya MATCH di kedua config; hanya referensi arus penentu.
    # current=300: lama (DR_A 0.64*517=330.88) MATCH, baru
    # (DR_A 0.64*400=256.0) MISS. DR_F + torque 60 < 70 MATCH keduanya.
    reading = make_reading(
        base_ts,
        motor_speed=990.0,
        output_frequency=38.0,
        output_power=150.0,
        motor_current=300.0,
        motor_torque=60.0,
    )
    old = _classify(engine, [reading], None, "test:drya:old")
    new = _classify(
        engine, [reading], EffectiveRefs(current_a=400.0), "test:drya:new"
    )
    assert _eval(old, TroubleType.DRY_RUN) == "MATCH"
    assert _eval(new, TroubleType.DRY_RUN) == "NO_MATCH"
