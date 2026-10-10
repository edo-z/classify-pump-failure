"""Referensi ambang per-tier dari rules.json untuk visualisasi (keputusan produk #3).

Sumber tunggal: POMPA_TERSANGKUT_SAMPAH (kw_ref/amp_ref), TURBULENSI
(T_KW + window/threshold T_A), capability_rules (voltage/unbalance),
panel_overheat (>=60C). Frontend menggambar markLine DRY per-tier dari sini
agar tak duplikat rumus 0.667/0.64.
"""

from __future__ import annotations

import json

from pydantic import BaseModel

from app.classification.engine import RULES_FILE


class TierRuleRefs(BaseModel):
    capacity_lps: int
    kw_ref: float
    amp_ref: float
    dr_kw: float
    dr_amp: float
    t_kw: float
    t_window: int
    t_threshold: float


class CapabilityRefs(BaseModel):
    undervoltage_v: float
    overvoltage_v: float
    unbalance_pct: float
    panel_overheat_c: float


class TierRefsResponse(BaseModel):
    tiers: dict[str, TierRuleRefs]
    capabilities: CapabilityRefs
    profiles: dict[str, str]


def _load_rules() -> dict:
    with open(RULES_FILE, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Invalid rules.json")
    return data


def load_tier_refs() -> TierRefsResponse:
    data = _load_rules()
    tiers: dict[str, TierRuleRefs] = {}
    for tier_key, tier in (data.get("tiers") or {}).items():
        rules = (tier or {}).get("rules") or {}
        if not isinstance(tier_key, str) or not tier_key.isdigit() or not rules:
            continue
        pompa = rules.get("POMPA_TERSANGKUT_SAMPAH", {}).get("conditions", [])
        kw_ref = next((float(c["value"]) for c in pompa if c.get("field") == "output_power"), None)
        amp_ref = next((float(c["value"]) for c in pompa if c.get("field") == "motor_current"), None)
        turb = rules.get("TURBULENSI", {}).get("conditions", [])
        t_kw = next((float(c["value"]) for c in turb if str(c.get("note", "")).startswith("T_KW")), None)
        t_a = next((c for c in turb if c.get("op") == "deviation_from_ma"), {})
        if kw_ref is None or amp_ref is None or t_kw is None:
            continue
        tiers[tier_key] = TierRuleRefs(
            capacity_lps=int(tier_key),
            kw_ref=kw_ref,
            amp_ref=amp_ref,
            dr_kw=kw_ref * 0.667,
            dr_amp=amp_ref * 0.64,
            t_kw=t_kw,
            t_window=int(t_a.get("window", 30)),
            t_threshold=float(t_a.get("threshold", 10.0)),
        )
    cap = data.get("capability_rules") or {}
    under = cap.get("UNDERVOLTAGE") or {}
    over = cap.get("OVERVOLTAGE") or {}
    unbal = cap.get("UNBALANCE") or {}
    panel_rules = ((data.get("tiers") or {}).get("panel_overheat") or {}).get("rules") or {}
    panel_vals = [
        c.get("value") for r in panel_rules.values()
        for c in (r.get("conditions") or []) if isinstance(c.get("value"), (int, float))
    ]
    from app.classification.profiles import PUMP_PROFILES_FILE

    try:
        profiles_raw = json.loads(PUMP_PROFILES_FILE.read_text(encoding="utf-8")).get("profiles", {})
    except (OSError, ValueError):
        profiles_raw = {}
    profiles = {
        pid: str(cfg.get("capacity_lps"))
        for pid, cfg in profiles_raw.items()
        if isinstance(cfg, dict) and str(cfg.get("capacity_lps")) in tiers
    }
    return TierRefsResponse(
        tiers=tiers,
        profiles=profiles,
        capabilities=CapabilityRefs(
            undervoltage_v=float(under.get("threshold_v", 360.0)),
            overvoltage_v=float(over.get("threshold_v", 410.0)),
            unbalance_pct=float(unbal.get("threshold_pct", 10.0)),
            panel_overheat_c=float(min(panel_vals)) if panel_vals else 60.0,
        ),
    )
