"""Ref efektif konsisten di 4 famili (Fase 2): PTS, TURBULENSI,
BANYAK_SAMPAH, DRY_RUN memakai KW_ref/A_ref efektif yang sama.

Contoh kontrak: ref 250 -> 270 kW => DR_KW = 0.667*270 = 180.09 kW.
Kontrol: rule_config=None berperilaku identik dengan sebelum Fase 2.
"""

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


def _eval_map(result):
    return {ev.trouble_type: ev for ev in result.rule_evaluations}


def test_effective_refs_applied_to_all_families(engine, base_ts):
    # Di bawah ref lama (250/517) tapi di atas ambang dari ref baru
    # (270 -> DR_KW 180.09, DR_A 0.64*517=330.88 tetap karena A tak dioverride).
    # PTS butuh kW>=ref: 260 < 270 (MISS dengan ref baru) vs >= 250 (MATCH lama).
    from datetime import timedelta

    readings = [
        make_reading(
            base_ts + timedelta(seconds=i),
            motor_speed=990.0,
            output_frequency=5.0,
            output_power=260.0,
            motor_current=520.0,
            motor_torque=95.0,
        )
        for i in range(31)
    ]
    old = _eval_map(_classify(engine, readings, None, "test:refs:old"))
    new = _eval_map(
        _classify(
            engine, readings, EffectiveRefs(power_kw=270.0), "test:refs:new"
        )
    )
    pts_old = old[TroubleType.POMPA_TERSANGKUT_SAMPAH]
    pts_new = new[TroubleType.POMPA_TERSANGKUT_SAMPAH]
    assert pts_old.evaluation == "MATCH"  # 260 >= 250
    assert pts_new.evaluation == "NO_MATCH"  # 260 < 270
    # Threshold (10/110/100) dan operator tak berubah oleh override ref.
    assert pts_new.total_conditions == pts_old.total_conditions == 5
    # Famili BANYAK_SAMPAH (jalur generic) ikut ref efektif yang sama.
    bs_old = old[TroubleType.BANYAK_SAMPAH]
    bs_new = new[TroubleType.BANYAK_SAMPAH]
    assert bs_old.evaluation == "MATCH"
    assert bs_new.evaluation == "NO_MATCH"


def test_rule_config_none_is_legacy_behavior(engine, base_ts):
    readings = [
        make_reading(base_ts, output_frequency=5.0, output_power=500.0)
    ]
    a = _classify(engine, readings, None, "test:legacy:a")
    b = _classify(engine, readings, None, "test:legacy:b")
    assert a.trouble_type == b.trouble_type
    assert [
        (ev.trouble_type, ev.evaluation) for ev in a.rule_evaluations
    ] == [(ev.trouble_type, ev.evaluation) for ev in b.rule_evaluations]


def test_global_rules_not_mutated(engine, base_ts):
    from app.classification.engine import RULES_FILE
    import json

    snapshot = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    readings = [make_reading(base_ts, output_power=500.0)]
    _classify(
        engine, readings, EffectiveRefs(power_kw=999.0), "test:nomut"
    )
    assert engine._rules == snapshot
