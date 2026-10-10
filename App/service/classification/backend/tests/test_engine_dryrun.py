"""C6 — DRY_RUN: DR_F kesetaraan 2 desimal + DR_C penuh (tier 5000)."""

from app.classification.engine import RulesEngine, RULES_FILE
from app.classification.models import TroubleType

from .conftest import make_reading


def test_freq_eq_2dp_boundaries():
    eng = RulesEngine(RULES_FILE)
    assert eng._freq_eq_2dp(40.004, 40.0) is True
    assert eng._freq_eq_2dp(40.005, 40.0) is False
    assert eng._freq_eq_2dp(None, 40.0) is False
    assert eng._freq_eq_2dp(40.0, 0) is False
    assert eng._freq_eq_2dp(40.0, None) is False


def test_dryrun_full_match(engine, pump_5000, base_ts, setpoint_40):
    # Tier 5000: DR_KW=0.667*400=266.8, DR_A=0.64*867=554.88, T<70.
    r = make_reading(base_ts, output_frequency=40.0, output_power=111.0,
                     motor_current=246.0, motor_torque=40.0)
    res = engine.classify([r], pump_5000, setpoint_40, trigger_namespace="test:dry-ok")
    assert res.trouble_type == TroubleType.DRY_RUN


def test_dryrun_freq_off_kills_match(engine, pump_5000, base_ts, setpoint_40):
    r = make_reading(base_ts, output_frequency=40.01, output_power=111.0,
                     motor_current=246.0, motor_torque=40.0)
    res = engine.classify([r], pump_5000, setpoint_40, trigger_namespace="test:dry-freq")
    assert res.trouble_type != TroubleType.DRY_RUN
