from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.classification.setpoints import (
    ProfileSetpoint,
    get_profile_setpoint,
    load_profile_setpoints,
    save_profile_setpoint,
)

router = APIRouter(prefix="/profile-setpoints", tags=["profile_setpoints"])


class ProfileSetpointUpdate(BaseModel):
    frequency_hz: float | None = Field(default=None, ge=0)
    rpm: float | None = Field(default=None, ge=0)
    torque: float | None = Field(default=None, ge=0)


@router.get("", response_model=dict[str, ProfileSetpoint])
def list_profile_setpoints() -> dict[str, ProfileSetpoint]:
    return load_profile_setpoints()


@router.get("/{profile_id}", response_model=ProfileSetpoint)
def get_profile_setpoint_api(profile_id: str) -> ProfileSetpoint:
    try:
        return get_profile_setpoint(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown pump profile: {profile_id}") from exc


@router.put("/{profile_id}", response_model=ProfileSetpoint)
def update_profile_setpoint(profile_id: str, body: ProfileSetpointUpdate) -> ProfileSetpoint:
    try:
        setpoint = ProfileSetpoint.model_validate(body.model_dump())
        return save_profile_setpoint(profile_id, setpoint)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown pump profile: {profile_id}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
