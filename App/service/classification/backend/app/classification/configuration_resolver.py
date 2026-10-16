"""configuration_resolver — penyatuan sumber nilai konfigurasi (Fase 2).

Reference & Setpoint adalah konfigurasi yang dapat diubah user; persamaan
dan struktur logika klasifikasi tetap milik Classification Engine.

Prioritas per parameter (fallback per kolom, bukan per baris):
    override pompa (pump_classification_config, non-NULL)
    -> referensi flowhead (flowheads.references_*, bila ada)
    -> default profil (rules.json / profile_setpoints.json)

Tidak ada record / kolom NULL = warisi level berikutnya.
Tidak ada kolom prioritas rule: semua trouble_type setara.

Modul ini MURNI: tanpa I/O database, tanpa state, tanpa thread.
Pembacaan DB (pump_classification_config, flowheads) adalah tugas
caller (service / DB ingest worker); resolver hanya menggabungkan
nilai yang diberikan. Threshold PTS (10/110/100) dan DRY (70%) BUKAN
bagian modul ini — tetap milik rules.json dan dibaca evaluator
dari rule_def.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any


@dataclass
class EffectiveRefs:
    """Reference power/current efektif untuk satu evaluasi.

    None = tidak ada override; engine memakai nilai rules.json.
    """

    power_kw: float | None = None
    current_a: float | None = None


def clean_positive(value: Any) -> float | None:
    """Samakan semantik setpoints._clean: None/invalid/<=0 -> None."""
    try:
        number = float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    if number is None or number <= 0:
        return None
    return number


def resolve_layered_value(*levels: Any) -> float | None:
    """Kembalikan level valid pertama (override -> ... -> default).

    Tiap level dibersihkan dulu via clean_positive, sehingga
    None / invalid / <=0 otomatis jatuh ke level berikutnya.
    """
    for level in levels:
        cleaned = clean_positive(level)
        if cleaned is not None:
            return cleaned
    return None


def resolve_effective_refs(
    profile_power_kw: Any,
    profile_current_a: Any,
    flowhead_power_kw: Any = None,
    flowhead_current_a: Any = None,
    override_power_kw: Any = None,
    override_current_a: Any = None,
) -> EffectiveRefs:
    """Gabungkan reference tiga tingkat menjadi nilai efektif.

    Mengembalikan EffectiveRefs; field None berarti engine tetap
    memakai nilai rules.json untuk field tersebut.
    """
    return EffectiveRefs(
        power_kw=resolve_layered_value(
            override_power_kw,
            flowhead_power_kw,
            profile_power_kw,
        ),
        current_a=resolve_layered_value(
            override_current_a,
            flowhead_current_a,
            profile_current_a,
        ),
    )


_REF_FIELDS = {
    "output_power": "power_kw",
    "motor_current": "current_a",
}


def apply_effective_refs(
    tier_rules: dict[str, Any],
    refs: EffectiveRefs,
) -> dict[str, Any]:
    """Terapkan refs efektif ke SALINAN tier rules (tidak mutasi input).

    Menimpa `value` kondisi output_power/motor_current di semua rule
    tier (PTS, TURBULENSI, BANYAK_SAMPAH, DRY_RUN) sehingga keempat
    famili memakai reference efektif yang SAMA. Threshold, operator,
    dan logika tidak diubah. Field refs yang None = tidak ditimpa.
    """
    effective = deepcopy(tier_rules)
    overrides = {
        "output_power": refs.power_kw,
        "motor_current": refs.current_a,
    }
    for rule_def in effective.get("rules", {}).values():
        if not isinstance(rule_def, dict):
            continue
        for cond in rule_def.get("conditions", []):
            if not isinstance(cond, dict):
                continue
            replacement = overrides.get(cond.get("field"))
            if replacement is not None:
                cond["value"] = replacement
    return effective
