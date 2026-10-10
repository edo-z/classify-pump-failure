"""C4 — Batas voltage eksklusif: under <360, over >410 (rules.json)."""

from app.classification.models import TroubleType

from .conftest import make_reading


def _classify_voltage(engine, pump_5000, setpoint_40, base_ts, volts):
    r = make_reading(base_ts, input_voltage=volts, motor_current=100.0,
                     output_frequency=40.0, output_power=300.0, motor_torque=80.0,
                     arus_rms_u=100.0, arus_rms_v=100.0, arus_rms_w=100.0)
    return engine.classify([r], pump_5000, setpoint_40, trigger_namespace="test:voltage")


def test_undervoltage_boundary(engine, pump_5000, setpoint_40, base_ts):
    assert _classify_voltage(engine, pump_5000, setpoint_40, base_ts, 355).trouble_type == TroubleType.UNDERVOLTAGE
    assert _classify_voltage(engine, pump_5000, setpoint_40, base_ts, 359.99).trouble_type == TroubleType.UNDERVOLTAGE
    res = _classify_voltage(engine, pump_5000, setpoint_40, base_ts, 360)
    assert res.trouble_type != TroubleType.UNDERVOLTAGE


def test_overvoltage_boundary(engine, pump_5000, setpoint_40, base_ts):
    assert _classify_voltage(engine, pump_5000, setpoint_40, base_ts, 420).trouble_type == TroubleType.OVERVOLTAGE
    assert _classify_voltage(engine, pump_5000, setpoint_40, base_ts, 410.01).trouble_type == TroubleType.OVERVOLTAGE
    res = _classify_voltage(engine, pump_5000, setpoint_40, base_ts, 410)
    assert res.trouble_type != TroubleType.OVERVOLTAGE


def test_voltage_none_no_crash(engine, pump_5000, setpoint_40, base_ts):
    res = _classify_voltage(engine, pump_5000, setpoint_40, base_ts, None)
    assert res.trouble_type != TroubleType.UNDERVOLTAGE
    assert res.trouble_type != TroubleType.OVERVOLTAGE
