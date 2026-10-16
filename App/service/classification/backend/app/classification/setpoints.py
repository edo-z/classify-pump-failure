import json
import logging
from pathlib import Path

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


CLASSIFICATION_DIR = (
    Path(__file__).resolve().parent
)

PROFILE_SETPOINTS_FILE = (
    CLASSIFICATION_DIR
    / "profile_setpoints.json"
)

PUMP_PROFILES_FILE = (
    CLASSIFICATION_DIR
    / "pump_profiles.json"
)


class ProfileSetpoint(BaseModel):
    frequency_hz: float | None = Field(default=None, ge=0)
    rpm: float | None = Field(default=None, ge=0)
    torque: float | None = Field(default=None, ge=0, description="persentase %")


def load_profile_ids(
    path: Path = PUMP_PROFILES_FILE,
) -> set[str]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return set(raw.get("profiles", {}).keys())


def load_profile_setpoints(
    path: Path = PROFILE_SETPOINTS_FILE,
) -> dict[str, ProfileSetpoint]:
    profile_ids = load_profile_ids()

    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
    else:
        raw = {}

    return {
        profile_id: ProfileSetpoint.model_validate(
            raw.get(profile_id, {})
        )
        for profile_id in sorted(profile_ids)
    }


def get_profile_setpoint(
    profile_id: str,
    path: Path = PROFILE_SETPOINTS_FILE,
) -> ProfileSetpoint:
    profile_ids = load_profile_ids()

    if profile_id not in profile_ids:
        raise KeyError(profile_id)

    return load_profile_setpoints(path)[profile_id]


def save_profile_setpoint(
    profile_id: str,
    setpoint: ProfileSetpoint,
    path: Path = PROFILE_SETPOINTS_FILE,
) -> ProfileSetpoint:
    profile_ids = load_profile_ids()

    if profile_id not in profile_ids:
        raise KeyError(profile_id)

    current = load_profile_setpoints(path)
    current[profile_id] = setpoint

    serializable = {
        key: current[key].model_dump()
        for key in sorted(current)
    }

    temp_path = path.with_name(path.name + ".tmp")

    temp_path.write_text(
        json.dumps(
            serializable,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    temp_path.replace(path)

    return setpoint


def resolve_effective_setpoint(
    profile_id: str,
    override_freq: float | None = None,
):
    """Single source of truth setpoint (FMEA F8, 5R Rawat).

    Prioritas: override_freq (per-analisis/dokumen) > profil.
    Nilai <=0 / None / invalid diabaikan ke level berikutnya.
    Mengembalikan OperatingSetpoint (rpm/torque selalu dari profil).

    Lapisan fallback didelegasikan ke configuration_resolver agar
    identik dengan resolver DB Fase 2 (tanpa I/O di sini).
    """
    from app.classification.configuration_resolver import (
        resolve_layered_value,
    )
    from app.classification.models import OperatingSetpoint

    try:
        profile_sp = get_profile_setpoint(profile_id)
    except Exception as exc:
        logger.warning("resolve setpoint profile load failed %s: %s", profile_id, exc)
        raise

    freq = resolve_layered_value(override_freq, profile_sp.frequency_hz)
    return OperatingSetpoint(frequency=freq, rpm=profile_sp.rpm, torque=profile_sp.torque)
