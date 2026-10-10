"""Stateless helpers untuk RulesEngine — diekstrak dari engine.py (5R Rapi).

Fungsi murni tanpa akses state engine; RulesEngine mendelegasikan ke sini
agar impor lama (`engine._freq_eq_2dp`, dsb.) tetap kompatibel.
Rumus/persamaan TIDAK diubah — hanya relokasi.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from app.classification.models import OperatingSetpoint, SensorReading



def get_count_trigger(rule_def: dict) -> int:
    try:
        v = rule_def.get("count_trigger", 1)
        iv = int(v)
        return iv if iv >= 1 else 1
    except Exception:
        return 1

@staticmethod


def freq_eq_2dp(actual: float | None, sp: float | None) -> bool:
    """DR_F: kesetaraan raw 2 desimal, tanpa normalisasi.

    Decimal(str(x)) + ROUND_HALF_UP agar deterministik
    (hindari banker's rounding float). None/sp<=0 -> False.
    """
    if actual is None or sp is None:
        return False
    try:
        if float(sp) <= 0:
            return False
        q = Decimal("0.01")
        a = Decimal(str(actual)).quantize(q, rounding=ROUND_HALF_UP)
        s = Decimal(str(sp)).quantize(q, rounding=ROUND_HALF_UP)
        return a == s
    except Exception:
        return False


def get_t_a_params(rule_def: dict) -> tuple[int, float]:
    """Ambil (window, threshold) T_A dari rule_def, default (30, 10.0)."""
    window = 30
    threshold = 10.0
    for c in rule_def.get("conditions", []):
        if c.get("field") == "motor_current" and c.get("op") == "deviation_from_ma":
            try:
                w = int(c.get("window", 30))
                if w >= 1:
                    window = w
            except Exception:
                pass
            try:
                t = float(c.get("threshold", 10.0))
                if t > 0:
                    threshold = t
            except Exception:
                pass
            break
    return window, threshold


def compute_t_a(readings: list[SensorReading], window: int = 30, threshold: float = 10.0
) -> dict[str, Any]:
    """Trailing moving average T_A: |A_i - MA_i| >= threshold.

    MA_i = mean dari `window` nilai motor_current valid sebelumnya
    (exclude current, trailing, bukan n->n+30). Caller menjamin readings
    sudah kontigu event-time (gap -> evidence di-clear).
    Kumpulkan mundur dari i-1 hingga `window` nilai valid terkumpul.
    Kurang dari window / A_i None -> insufficient (T_A FALSE).
    """
    if not readings:
        return {"T_A": False, "insufficient": True, "reason": "no_readings"}
    current_reading = readings[-1]
    current = getattr(current_reading, "motor_current", None)
    if current is None:
        return {"A": None, "T_A": False, "insufficient": True, "reason": "current_none"}
    prev_values: list[float] = []
    # kumpulkan mundur, skip None, hingga window terpenuhi
    for r in reversed(readings[:-1]):
        v = getattr(r, "motor_current", None)
        if v is not None:
            prev_values.append(float(v))
            if len(prev_values) >= window:
                break
    if len(prev_values) < window:
        return {
            "A": float(current),
            "collected": len(prev_values),
            "need": window,
            "T_A": False,
            "insufficient": True,
            "reason": f"need_{window}_got_{len(prev_values)}",
        }
    # prev_values saat ini urutan mundur; mean tidak peduli urutan
    ma = sum(prev_values) / window
    delta = float(current) - ma
    t_a = abs(delta) >= threshold
    return {
        "A": float(current),
        "MA_A": ma,
        "Delta_A": delta,
        "Abs_Delta_A": abs(delta),
        "threshold": threshold,
        "window": window,
        "T_A": bool(t_a),
        "insufficient": False,
    }


def get_missing_requirements(        readings: list[SensorReading],
    agg: dict,
    rule_def: dict,
    operating_setpoint: OperatingSetpoint,
) -> list[str]:
    missing: list[str] = []

    setpoint_ops = {
        "reaching_setpoint",
        "not_reaching_setpoint",
        "not_exceeding_setpoint",
        "near_setpoint",
    }

    for condition in rule_def.get(
        "conditions",
        [],
    ):
        field = condition.get(
            "field"
        )

        op = condition.get("op")

        if (
            field
            and agg.get(field)
            is None
        ):
            missing.append(field)

        if op == "fluctuating":
            values = [
                getattr(
                    reading,
                    field,
                )
                for reading
                in readings
                if (
                    field
                    and getattr(
                        reading,
                        field,
                    )
                    is not None
                )
            ]

            if len(values) < 4:
                missing.append(
                    (
                        f"{field}:"
                        "minimum_4_samples"
                    )
                )

        if op in setpoint_ops:
            ref_field = condition.get(
                "ref"
            )

            setpoint = (
                resolve_operating_setpoint(
                    operating_setpoint,
                    ref_field,
                )
            )

            if (
                setpoint is None
                or setpoint <= 0
            ):
                missing.append(
                    ref_field
                    or "operating_setpoint"
                )

    return list(
        dict.fromkeys(
            missing
        )
    )


def get_missing_or_requirements(        agg: dict,
    rule_def: dict,
) -> list[str]:
    missing: list[str] = []

    for condition in rule_def.get(
        "conditions",
        [],
    ):
        field = condition.get(
            "field"
        )

        if (
            field
            and agg.get(field)
            is None
        ):
            missing.append(
                field
            )

    return list(
        dict.fromkeys(
            missing
        )
    )


def get_tier_key(rules: dict, capacity_lps: int) -> str | None:
    tier_key = str(capacity_lps)
    tier = rules.get("tiers", {}).get(tier_key, {})

    if tier.get("rules"):
        return tier_key

    return None


def aggregate_readings(readings: list[SensorReading]) -> dict:
    # Raw per-sample: tanpa mean/window, langsung last reading
    if not readings:
        return {}
    last = readings[-1]
    numeric_fields = [
        "output_frequency",
        "output_power",
        "motor_current",
        "motor_torque",
        "motor_speed",
        "ambient_temperature",
        "control_board_temperature",
        "inverter_temperature",
        "motor_estimated_temperature",
        "input_voltage",
        "flux_actual",
    ]
    agg = {}
    for field in numeric_fields:
        value = getattr(last, field, None)
        if value is not None:
            agg[field] = value
    return agg


def resolve_operating_setpoint(
    setpoints: OperatingSetpoint,
    ref_field: str,
) -> float | None:
    field_map = {
        "setpoint_freq": "frequency",
        "setpoint_rpm": "rpm",
        "setpoint_torque": "torque",
    }

    field = field_map.get(ref_field)

    if field is None:
        return None

    return getattr(setpoints, field)


def check_fluctuation(        readings: list[SensorReading],
    field: str,
    threshold: float,
    center: float | None = None,
) -> bool:
    """Check fluctuating: normal 1-2A filtered, trigger +-threshold.
    If center provided (mid 157/517/867), require inside [center-threshold, center+threshold] + reversals.
    """
    values = [
        value
        for reading in readings
        if (value := getattr(reading, field)) is not None
    ]

    if len(values) < 4:
        return False

    # inside [mid±threshold] band check (studi kasus turbulensi per tier)
    if center is not None:
        try:
            c = float(center)
            t = float(threshold)
            # all 4 must be inside band, else not turbulensi (strict inside)
            if not all(c - t <= v <= c + t for v in values):
                return False
        except Exception:
            pass

    directions = []

    for previous, current in zip(values, values[1:]):
        delta = current - previous
        # 1-2A normal di-filter: hanya >=threshold (20) yang jadi direction
        if delta >= threshold:
            directions.append(1)
        elif delta <= -threshold:
            directions.append(-1)

    if len(directions) < 3:
        return False

    reversals = sum(
        current != previous
        for previous, current
        in zip(directions, directions[1:])
    )

    return reversals >= 2
