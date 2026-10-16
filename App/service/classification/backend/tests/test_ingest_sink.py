"""Sink 9-baris + semantik normal/incomplete (tanpa MySQL).

- 1 tick = 8 evaluasi engine + 1 normal sintetis = 9 baris.
- normal ter-trigger HANYA bila FULL + tanpa MATCH + tanpa incomplete.
- INSUFFICIENT / UNSUPPORTED tercatat incomplete, BUKAN auto-normal.
"""

import json
from datetime import datetime, timezone

from app.classification.models import TroubleType
from app.ingest_db import sink as sink_mod

TS = datetime(2026, 10, 15, 15, 0, 5, tzinfo=timezone.utc)


class _Eval:
    def __init__(self, trouble, evaluation, capability="READY"):
        self.trouble_type = trouble
        self.evaluation = evaluation
        self.capability_status = capability
        self.matched_conditions = []
        self.total_conditions = 4
        self.missing_requirements = []


class _Result:
    def __init__(self, evals, status="FULL"):
        self.rule_evaluations = evals
        self.evaluation_status = status
        self.sensor_snapshot = {"frequency": 38.0}


def _all_troubles():
    return [
        TroubleType.POMPA_TERSANGKUT_SAMPAH,
        TroubleType.TURBULENSI,
        TroubleType.BANYAK_SAMPAH,
        TroubleType.UNBALANCE,
        TroubleType.UNDERVOLTAGE,
        TroubleType.OVERVOLTAGE,
        TroubleType.DRY_RUN,
        TroubleType.PANEL_OVERHEAT,
    ]


def test_nine_rows_with_triggered_and_normal_off():
    evals = [_Eval(t, "MATCH" if t == TroubleType.DRY_RUN else "NO_MATCH") for t in _all_troubles()]
    rows = sink_mod.build_rows(_Result(evals), 12, TS, {"refs": {}})
    assert len(rows) == 9
    by_type = {r["failure_type"]: r for r in rows}
    assert by_type["dry_run"]["is_triggered"] == 1  # MATCH
    assert by_type["normal"]["is_triggered"] == 0  # mati saat ada MATCH
    payload = json.loads(by_type["dry_run"]["raw_data"])
    assert payload["effective_config"] == {"refs": {}}
    assert payload["sensor_snapshot"] == {"frequency": 38.0}


def test_normal_triggered_only_when_full_and_clean():
    evals = [_Eval(t, "NO_MATCH") for t in _all_troubles()]
    rows = sink_mod.build_rows(_Result(evals, "FULL"), 12, TS, {})
    normal = next(r for r in rows if r["failure_type"] == "normal")
    assert normal["is_triggered"] == 1


def test_incomplete_is_not_auto_normal():
    evals = [_Eval(t, "NO_MATCH") for t in _all_troubles()]
    evals[0] = _Eval(_all_troubles()[0], None, "UNSUPPORTED")
    rows = sink_mod.build_rows(
        _Result(evals, "INSUFFICIENT_DATA"), 12, TS, {}
    )
    assert len(rows) == 9  # tetap tercatat semua
    normal = next(r for r in rows if r["failure_type"] == "normal")
    assert normal["is_triggered"] == 0
    payload = json.loads(normal["raw_data"])
    assert payload["incomplete"] is True
    assert payload["evaluation_status"] == "INSUFFICIENT_DATA"


def test_missing_sensor_fields_block_auto_normal():
    # Pompa B: torque (dan lainnya) hilang walau semua evaluasi NO_MATCH
    # dan status FULL -> tetap incomplete, normal FALSE.
    evals = [_Eval(t, "NO_MATCH") for t in _all_troubles()]
    rows = sink_mod.build_rows(
        _Result(evals, "FULL"),
        13,
        TS,
        {},
        missing_fields=["motor_torque", "motor_speed"],
    )
    assert len(rows) == 9
    normal = next(r for r in rows if r["failure_type"] == "normal")
    assert normal["is_triggered"] == 0
    payload = json.loads(normal["raw_data"])
    assert payload["incomplete"] is True
    assert payload["missing_fields"] == ["motor_speed", "motor_torque"]
    # Baris trouble ikut mencatat missing yang sama.
    dry = next(r for r in rows if r["failure_type"] == "dry_run")
    assert json.loads(dry["raw_data"])["missing_fields"] == [
        "motor_speed",
        "motor_torque",
    ]


def test_complete_data_can_be_normal():
    evals = [_Eval(t, "NO_MATCH") for t in _all_troubles()]
    rows = sink_mod.build_rows(
        _Result(evals, "FULL"), 12, TS, {},
        missing_fields=[],
    )
    normal = next(r for r in rows if r["failure_type"] == "normal")
    assert normal["is_triggered"] == 1
