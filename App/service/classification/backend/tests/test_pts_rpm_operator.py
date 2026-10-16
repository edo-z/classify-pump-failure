"""Regression RPM PTS (Fase 0): operator harus >= 100 di semua profil.

pump_profiles.json sempat memakai `< 100` untuk RPM pompa_tersangkut_sampah,
sementara rules.json + evaluator.py memakai `>= 100`. Test ini mengunci:
1. Konsistensi dokumen: ketiga profil (500/3000/5000) ber-operator `>=`.
2. Keputusan diagnosis desisif: dengan freq/kW/A MATCH dan torque MISS
   (100% < 110%), RPM menjadi penentu tunggal PTS_Count 3/4 vs 2/4:
   rpm=100 -> PTS MATCH, rpm=99 -> PTS NO_MATCH.
   Asertasi pada RuleEvaluation PTS (bukan trouble_type final) agar
   tidak tercampur rule lain (mis. BANYAK_SAMPAH yang juga bisa MATCH).
"""

import json
from datetime import datetime, timezone

from app.classification.engine import RULES_FILE
from app.classification.models import PumpConfig, TroubleType
from app.classification.setpoints import resolve_effective_setpoint

from .conftest import make_reading

PROFILES_FILE = RULES_FILE.parent / "pump_profiles.json"


def _profiles() -> dict:
    return json.loads(PROFILES_FILE.read_text(encoding="utf-8"))


def test_pts_rpm_operator_consistent_ge():
    profiles = _profiles()["profiles"]
    assert set(profiles) == {"500_lps", "3000_lps", "5000_lps"}
    for profile_id, profile in profiles.items():
        rpm = profile["thresholds"]["pompa_tersangkut_sampah"]["rpm"]
        assert rpm["operator"] == ">=", profile_id
        assert rpm["value"] == 100, profile_id


def _pts_evaluation(engine, rpm: float, namespace: str) -> str | None:
    pc = PumpConfig(pump_id=5000, capacity_lps=5000)
    sp = resolve_effective_setpoint("5000_lps")
    reading = make_reading(
        # freq<=10 (PTS_F), kW>=400, A>=867 MATCH; torque 100 < 110 MISS.
        # RPM satu-satunya penentu: 100 -> 3/4 MATCH, 99 -> 2/4 NO_MATCH.
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
        trigger_namespace=namespace,
    )
    for ev in result.rule_evaluations:
        if ev.trouble_type == TroubleType.POMPA_TERSANGKUT_SAMPAH:
            return ev.evaluation
    return None


def test_pts_rpm_100_match(engine):
    assert _pts_evaluation(engine, 100.0, "test:pts-rpm:100") == "MATCH"


def test_pts_rpm_99_no_match(engine):
    assert _pts_evaluation(engine, 99.0, "test:pts-rpm:99") == "NO_MATCH"
