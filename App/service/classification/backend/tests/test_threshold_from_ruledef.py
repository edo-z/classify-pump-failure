"""Threshold dari rule_def, bukan literal (Fase 2).

Evaluator wajib membaca ambang PTS (freq/torque/rpm) dan DRY torque
dari rule_def dengan default = nilai lama (10/110/100/70). Test ini
membuktikan ambang benar-benar berasal dari rule_def: salinan rules
dengan threshold berbeda mengubah keputusan, tanpa menyentuh rumus.
"""

import json
from datetime import datetime, timezone

from app.classification.engine import RULES_FILE, RulesEngine
from app.classification.models import PumpConfig
from app.classification.setpoints import resolve_effective_setpoint

from .conftest import make_reading


def _engine_with_pts(freq_thr=None, torque_thr=None, rpm_thr=None):
    rules = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    for tier in ("500", "3000", "5000"):
        for cond in rules["tiers"][tier]["rules"]["POMPA_TERSANGKUT_SAMPAH"][
            "conditions"
        ]:
            if freq_thr is not None and cond["field"] == "output_frequency":
                cond["value"] = freq_thr
            if torque_thr is not None and cond["field"] == "motor_torque":
                cond["value"] = torque_thr
            if rpm_thr is not None and cond["field"] == "motor_speed":
                cond["value"] = rpm_thr
    eng = RulesEngine.__new__(RulesEngine)
    eng._rules = rules
    import threading

    eng._trigger_counters = {}
    eng._lock = threading.Lock()
    eng._rules_path = RULES_FILE
    return eng


def _pts_eval(engine, rpm):
    pc = PumpConfig(pump_id=5000, capacity_lps=5000)
    sp = resolve_effective_setpoint("5000_lps")
    reading = make_reading(
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        motor_speed=rpm,
        output_frequency=5.0,
        output_power=500.0,
        motor_current=900.0,
        motor_torque=100.0,
    )
    result = engine.classify(
        readings=[reading],
        pump_config=pc,
        operating_setpoint=sp,
        trigger_namespace="test:thr",
    )
    return next(
        ev.evaluation
        for ev in result.rule_evaluations
        if ev.trouble_type.value == "pompa_tersangkut_sampah"
    )


def test_pts_torque_threshold_comes_from_ruledef(engine):
    # torque=100, rpm=50 (MISS): kw+A MATCH (500>=400, 900>=867).
    # -> 3/4 MATCH bila ambang 90, 2/4 NO_MATCH bila ambang 110.
    assert _pts_eval(_engine_with_pts(torque_thr=90), 50.0) == "MATCH"
    assert _pts_eval(_engine_with_pts(torque_thr=110), 50.0) == "NO_MATCH"


def test_pts_rpm_threshold_comes_from_ruledef(engine):
    # rpm=100: MATCH bila ambang 100, NO_MATCH bila ambang 101.
    assert _pts_eval(_engine_with_pts(rpm_thr=100), 100.0) == "MATCH"
    assert _pts_eval(_engine_with_pts(rpm_thr=101), 100.0) == "NO_MATCH"
