from __future__ import annotations

import json
from pathlib import Path


PUMP_PROFILES_FILE = (
    Path(__file__).resolve().parent
    / "pump_profiles.json"
)


def get_profile_capacity(
    profile_id: str,
    path: Path = PUMP_PROFILES_FILE,
) -> int:
    raw = json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )

    profile = (
        raw.get("profiles", {})
        .get(profile_id)
    )

    if profile is None:
        raise KeyError(profile_id)

    capacity = profile.get(
        "capacity_lps"
    )

    if (
        not isinstance(capacity, int)
        or capacity <= 0
    ):
        raise ValueError(
            "Invalid capacity for profile: "
            f"{profile_id}"
        )

    return capacity
