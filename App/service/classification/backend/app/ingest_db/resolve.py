"""Resolve input klasifikasi per pompa (tanpa I/O — input dari reader).

profile: pumps.flowhead_id -> flowheads.type_flowhead -> profile_id.
Pemetaan EXACT yang dikenal + ekstraksi digit eksak (500/3000/5000);
nilai aktual type_flowhead dikunci via SELECT DISTINCT di 8.4.x —
JANGAN menebak varian baru di sini, pompa tak terpetakan dilewati
dengan warning (lebih aman daripada salah profil).
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.classification.configuration_resolver import (
    EffectiveRefs,
    resolve_effective_refs,
    resolve_layered_value,
)
from app.classification.models import OperatingSetpoint, PumpConfig
from app.classification.profiles import get_profile_capacity
from app.classification.setpoints import get_profile_setpoint

logger = logging.getLogger(__name__)

FLOWHEAD_PROFILE_MAP = {
    "500_lps": "500_lps",
    "3000_lps": "3000_lps",
    "5000_lps": "5000_lps",
}

_CAPACITY_TO_PROFILE = {
    500: "500_lps",
    3000: "3000_lps",
    5000: "5000_lps",
}


def flowhead_to_profile(flowhead_type: str | None) -> str | None:
    if not flowhead_type:
        return None
    exact = FLOWHEAD_PROFILE_MAP.get(flowhead_type.strip())
    if exact is not None:
        return exact
    digits = re.sub(r"\D", "", flowhead_type)
    if digits:
        return _CAPACITY_TO_PROFILE.get(int(digits))
    return None


def resolve_pump_inputs(
    pump_id: int,
    flowhead_type: str | None,
    flowhead_power_kw: Any,
    flowhead_current_a: Any,
    config_row: dict[str, Any] | None,
    tier_refs,
) -> tuple[str, PumpConfig, OperatingSetpoint, EffectiveRefs, dict] | None:
    """Kembalikan (profile_id, PumpConfig, setpoint, refs, provenance).

    None bila flowhead tak terpetakan (pompa dilewati worker).
    """
    profile_id = flowhead_to_profile(flowhead_type)
    if profile_id is None:
        logger.warning(
            "pump %s: unmapped flowhead_type %r, skipped", pump_id, flowhead_type
        )
        return None

    capacity = get_profile_capacity(profile_id)
    profile_sp = get_profile_setpoint(profile_id)
    cfg = config_row or {}

    setpoint = OperatingSetpoint(
        frequency=resolve_layered_value(
            cfg.get("operating_freq_hz"), profile_sp.frequency_hz
        ),
        rpm=resolve_layered_value(cfg.get("operating_rpm"), profile_sp.rpm),
        torque=resolve_layered_value(
            cfg.get("operating_torque_pct"), profile_sp.torque
        ),
    )

    tier = tier_refs.tiers.get(str(capacity))
    refs = resolve_effective_refs(
        profile_power_kw=getattr(tier, "kw_ref", None),
        profile_current_a=getattr(tier, "amp_ref", None),
        flowhead_power_kw=flowhead_power_kw,
        flowhead_current_a=flowhead_current_a,
        override_power_kw=cfg.get("ref_power_kw"),
        override_current_a=cfg.get("ref_current_a"),
    )

    def _source(override, flowhead, profile):
        if override is not None and resolve_layered_value(override) is not None:
            return "override"
        if flowhead is not None and resolve_layered_value(flowhead) is not None:
            return "flowhead"
        return "profile"

    provenance = {
        "profile_id": profile_id,
        "ref_power_kw": _source(
            cfg.get("ref_power_kw"), flowhead_power_kw, getattr(tier, "kw_ref", None)
        ),
        "ref_current_a": _source(
            cfg.get("ref_current_a"),
            flowhead_current_a,
            getattr(tier, "amp_ref", None),
        ),
        "frequency_hz": _source(
            cfg.get("operating_freq_hz"), None, profile_sp.frequency_hz
        ),
    }
    pump_config = PumpConfig(pump_id=capacity, capacity_lps=capacity)
    return profile_id, pump_config, setpoint, refs, provenance
