"""Sink audit: 1 tick evaluasi -> 9 baris raw_classifications.

8 baris dari RuleEvaluation engine + 1 baris `normal` yang disintesis
sink (engine TIDAK mengeluarkan evaluasi normal — NORMAL hanya
ClassificationResult turunan). Baris normal:
  is_triggered = (evaluation_status == "FULL" dan tidak ada MATCH
                  dan tidak ada evaluasi incomplete).
Incomplete (UNSUPPORTED / evaluation None / status INSUFFICIENT_DATA)
tercatat apa adanya sebagai tidak lengkap — BUKAN auto-normal.

raw_data per baris = fakta teknis + snapshot effective_config, sehingga
histori tetap bermakna walau setpoint diubah kemudian hari.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

TROUBLE_COUNT = 9

# Field sensor kanonis yang dibaca rule engine (tier + kapabilitas).
# Daftar ini menentukan kelengkapan data: field yang None pada reading
# yang dievaluasi dicatat sebagai missing dan membuat tick INCOMPLETE
# (tidak boleh auto-normal) — walau semua evaluasi NO_MATCH.
SENSOR_FIELDS = [
    "motor_speed",
    "output_frequency",
    "motor_current",
    "motor_torque",
    "output_power",
    "hours_run",
    "output_voltage",
    "ambient_temperature",
    "control_board_temperature",
    "inverter_temperature",
    "input_voltage",
    "flux_actual",
    "motor_estimated_temperature",
    "arus_rms_u",
    "arus_rms_v",
    "arus_rms_w",
]

_INSERT_SQL = """
INSERT INTO raw_classifications
  (pump_id, failure_category_id, namespace, evaluated_at, is_triggered, raw_data)
VALUES (%(pump_id)s, %(failure_category_id)s, %(namespace)s,
        %(evaluated_at)s, %(is_triggered)s, %(raw_data)s)
"""


def _slug_of(trouble_type) -> str:
    return trouble_type.value


def build_rows(
    result,
    pump_id: int,
    namespace: str,
    evaluated_at: datetime,
    category_ids: dict[str, int],
    effective_config: dict[str, Any],
    missing_fields: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Bentuk 9 baris siap executemany dari satu ClassificationResult.

    missing_fields: field sensor yang None pada reading yang dievaluasi
    (dihitung worker dari evidence[-1]). Bila non-kosong, tick dianggap
    INCOMPLETE: tercatat apa adanya, dan baris normal TIDAK ter-trigger
    (data tak lengkap bukan bukti normal).
    """
    missing_fields = sorted(set(missing_fields or []))
    per_slug: dict[str, dict] = {}
    incomplete = (
        result.evaluation_status != "FULL" or bool(missing_fields)
    )
    any_match = False

    for ev in result.rule_evaluations:
        slug = _slug_of(ev.trouble_type)
        matched = ev.evaluation == "MATCH"
        any_match = any_match or matched
        if ev.evaluation is None or ev.capability_status != "READY":
            incomplete = True
        entry = {
            "evaluation": ev.evaluation,
            "capability_status": ev.capability_status,
            "matched_conditions": list(ev.matched_conditions),
            "total_conditions": ev.total_conditions,
            "missing_requirements": list(ev.missing_requirements),
        }
        # MATCH menang bila satu slug muncul ganda (mis. alias dry_run).
        if slug not in per_slug or matched:
            per_slug[slug] = entry

    rows: list[dict[str, Any]] = []
    for slug, entry in sorted(per_slug.items()):
        if slug not in category_ids:
            logger.warning("unknown failure category slug %r, skipped", slug)
            continue
        rows.append(
            {
                "pump_id": pump_id,
                "failure_category_id": category_ids[slug],
                "namespace": namespace,
                "evaluated_at": evaluated_at,
                "is_triggered": 1 if entry["evaluation"] == "MATCH" else 0,
                "raw_data": json.dumps(
                    {
                        "trouble": slug,
                        "evaluation_status": result.evaluation_status,
                        **entry,
                        "missing_fields": missing_fields,
                        "effective_config": effective_config,
                        "sensor_snapshot": result.sensor_snapshot,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            }
        )

    # Baris ke-9: normal (disintesis, bukan dari engine).
    if "normal" not in category_ids:
        logger.warning("failure category 'normal' missing, skipped")
    else:
        normal_triggered = (
            result.evaluation_status == "FULL"
            and not any_match
            and not incomplete
        )
        rows.append(
            {
                "pump_id": pump_id,
                "failure_category_id": category_ids["normal"],
                "namespace": namespace,
                "evaluated_at": evaluated_at,
                "is_triggered": 1 if normal_triggered else 0,
                "raw_data": json.dumps(
                    {
                        "trouble": "normal",
                        "evaluation_status": result.evaluation_status,
                        "incomplete": incomplete,
                        "missing_fields": missing_fields,
                        "effective_config": effective_config,
                        "sensor_snapshot": result.sensor_snapshot,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            }
        )
    return rows


def insert_rows(conn, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(_INSERT_SQL, rows)
    return len(rows)
