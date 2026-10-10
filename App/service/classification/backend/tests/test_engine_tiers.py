"""Parametrized tier 500/3000 (RCEA F4/F5): ambang dibaca dari rules.json.

Tier 5000 sudah dikunci di test_engine_voltage/dryrun/turbulensi; file ini
menutup lubang "hanya tier 5000" dengan referensi dinamis per tier:
- voltage: capability_rules threshold_v (bukan hardcode 360/410)
- DRY: DR_KW=0.667*ref, DR_A=0.64*ref dari rule POMPA se-tier
- TURBULENSI: T_KW dari rule se-tier, T_A window/threshold dari rule
"""

import json

import pytest

from app.classification.engine import RULES_FILE
from app.classification.models import PumpConfig, TroubleType
from app.classification.profiles import get_profile_capacity
from app.classification.setpoints import resolve_effective_setpoint

from .conftest import make_reading

TIERS = ["500_lps", "3000_lps"]


def _rules() -> dict:
    with open(RULES_FILE, encoding="utf-8") as f:
        return json.load(f)


def _voltage_thresholds() -> tuple[float, float]:
    cap = _rules()["capability_rules"]
    return float(cap["UNDERVOLTAGE"]["threshold_v"]), float(cap["OVERVOLTAGE"]["threshold_v"])


def _tier_refs(profile_id: str) -> dict:
    capacity = get_profile_capacity(profile_id)
    tier_rules = _rules()["tiers"][str(capacity)]["rules"]
    pompa = tier_rules["POMPA_TERSANGKUT_SAMPAH"]["conditions"]
    kw_ref = next(float(c["value"]) for c in pompa if c.get("field") == "output_power")
    amp_ref = next(float(c["value"]) for c in pompa if c.get("field") == "motor_current")
    turb = tier_rules["TURBULENSI"]["conditions"]
    t_kw = next(float(c["value"]) for c in turb if c.get("note", "").startswith("T_KW"))
    t_a = next(c for c in turb if c.get("op") == "deviation_from_ma")
    sp = resolve_effective_setpoint(profile_id)
    assert sp.frequency and sp.frequency > 0
    return {
        "capacity": capacity,
        "sp_freq": float(sp.frequency),
        "dr_kw": kw_ref * 0.667,
        "dr_amp": amp_ref * 0.64,
        "t_kw": t_kw,
        "t_window": int(t_a.get("window", 30)),
        "t_threshold": float(t_a.get("threshold", 10.0)),
    }


def _base_reading(ts, **overrides):
    return make_reading(
        ts,
        motor_speed=990.0,
        ambient_temperature=30.0,
        control_board_temperature=40.0,
        inverter_temperature=45.0,
        arus_rms_u=100.0,
        arus_rms_v=100.0,
        arus_rms_w=100.0,
        **overrides,
    )


@pytest.mark.parametrize("profile_id", TIERS)
def test_voltage_boundaries(engine, base_ts, profile_id):
    under_thr, over_thr = _voltage_thresholds()
    assert (under_thr, over_thr) == (360.0, 410.0)
    refs = _tier_refs(profile_id)
    pc = PumpConfig(pump_id=refs["capacity"], capacity_lps=refs["capacity"])
    sp = resolve_effective_setpoint(profile_id)
    ns = f"test:tier-v:{profile_id}"

    def run(volts):
        r = _base_reading(base_ts, input_voltage=volts, motor_current=100.0,
                          output_frequency=sp.frequency, output_power=300.0, motor_torque=80.0)
        return engine.classify([r], pc, sp, trigger_namespace=ns)

    assert run(under_thr - 5).trouble_type == TroubleType.UNDERVOLTAGE
    assert run(under_thr).trouble_type != TroubleType.UNDERVOLTAGE
    assert run(over_thr + 10).trouble_type == TroubleType.OVERVOLTAGE
    assert run(over_thr).trouble_type != TroubleType.OVERVOLTAGE


@pytest.mark.parametrize("profile_id", TIERS)
def test_dryrun_match_and_freq_gate(engine, base_ts, profile_id):
    refs = _tier_refs(profile_id)
    pc = PumpConfig(pump_id=refs["capacity"], capacity_lps=refs["capacity"])
    sp = resolve_effective_setpoint(profile_id)
    ns = f"test:tier-dry:{profile_id}"

    def run(freq):
        r = _base_reading(base_ts, output_frequency=freq, output_power=refs["dr_kw"] * 0.9,
                          motor_current=refs["dr_amp"] * 0.9, motor_torque=40.0)
        return engine.classify([r], pc, sp, trigger_namespace=ns)

    assert run(refs["sp_freq"]).trouble_type == TroubleType.DRY_RUN
    assert run(round(refs["sp_freq"] + 0.01, 2)).trouble_type != TroubleType.DRY_RUN


@pytest.mark.parametrize("profile_id", TIERS)
def test_turbulensi_match(engine, base_ts, profile_id):
    from datetime import timedelta

    refs = _tier_refs(profile_id)
    pc = PumpConfig(pump_id=refs["capacity"], capacity_lps=refs["capacity"])
    sp = resolve_effective_setpoint(profile_id)
    steady, jump = 500.0, 500.0 + refs["t_threshold"] + 5.0
    readings = [
        _base_reading(base_ts + timedelta(seconds=i), motor_current=steady,
                      output_frequency=refs["sp_freq"] - 5.0,
                      output_power=refs["t_kw"] + 5.0, motor_torque=95.0)
        for i in range(refs["t_window"])
    ]
    readings.append(
        _base_reading(base_ts + timedelta(seconds=refs["t_window"]), motor_current=jump,
                      output_frequency=refs["sp_freq"] - 5.0,
                      output_power=refs["t_kw"] + 5.0, motor_torque=95.0)
    )
    res = engine.classify(readings, pc, sp, trigger_namespace=f"test:tier-turb:{profile_id}")
    assert res.trouble_type == TroubleType.TURBULENSI
