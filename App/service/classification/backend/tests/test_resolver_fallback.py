"""Resolver fallback per kolom (Fase 2): override -> flowhead -> profil.

Tidak ada record / kolom NULL = warisi level berikutnya (NULL),
bukan nol. Tanpa I/O: semua input diberikan eksplisit.
"""

from app.classification.configuration_resolver import (
    EffectiveRefs,
    apply_effective_refs,
    clean_positive,
    resolve_effective_refs,
    resolve_layered_value,
)


def test_clean_positive_semantics():
    assert clean_positive(None) is None
    assert clean_positive(0) is None
    assert clean_positive(-5) is None
    assert clean_positive("abc") is None
    assert clean_positive(40) == 40.0
    assert clean_positive("46.1") == 46.1


def test_layered_override_wins():
    assert resolve_layered_value(40.0, 38.0, 38.0) == 40.0


def test_layered_null_falls_through():
    assert resolve_layered_value(None, 250.0, 250.0) == 250.0
    assert resolve_layered_value(None, None, 400.0) == 400.0
    assert resolve_layered_value(None, None, None) is None


def test_layered_invalid_falls_through():
    assert resolve_layered_value(0, -3, 38.0) == 38.0


def test_effective_refs_priority_per_column():
    refs = resolve_effective_refs(
        profile_power_kw=250.0,
        profile_current_a=517.0,
        flowhead_power_kw=260.0,
        flowhead_current_a=None,
        override_power_kw=None,
        override_current_a=500.0,
    )
    assert refs == EffectiveRefs(power_kw=260.0, current_a=500.0)


def test_effective_refs_all_missing():
    refs = resolve_effective_refs(None, None)
    assert refs == EffectiveRefs(power_kw=None, current_a=None)


def test_apply_effective_refs_copies_and_overrides():
    tier_rules = {
        "rules": {
            "POMPA_TERSANGKUT_SAMPAH": {
                "conditions": [
                    {"field": "output_frequency", "op": "<=", "value": 10},
                    {"field": "output_power", "op": ">=", "value": 250},
                    {"field": "motor_current", "op": ">=", "value": 517},
                    {"field": "motor_torque", "op": ">=", "value": 110},
                ]
            },
            "TURBULENSI": {
                "conditions": [
                    {"field": "output_power", "op": ">=", "value": 250},
                ]
            },
        }
    }
    out = apply_effective_refs(
        tier_rules, EffectiveRefs(power_kw=270.0, current_a=None)
    )
    # Input tidak dimutasi.
    assert tier_rules["rules"]["POMPA_TERSANGKUT_SAMPAH"]["conditions"][1][
        "value"
    ] == 250
    # Semua kondisi output_power tertimpa, current dibiarkan.
    for rule_def in out["rules"].values():
        for cond in rule_def["conditions"]:
            if cond["field"] == "output_power":
                assert cond["value"] == 270.0
            if cond["field"] == "motor_current":
                assert cond["value"] == 517
    # Threshold/operator tak tersentuh.
    assert out["rules"]["POMPA_TERSANGKUT_SAMPAH"]["conditions"][0] == {
        "field": "output_frequency",
        "op": "<=",
        "value": 10,
    }
