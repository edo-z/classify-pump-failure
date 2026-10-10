from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class UnsupportedPumpConfigurationError(ValueError):
    """Pump configuration has no supported classification rule tier."""


class TroubleType(str, Enum):
    POMPA_TERSANGKUT_SAMPAH = "pompa_tersangkut_sampah"
    TURBULENSI = "turbulensi"
    BANYAK_SAMPAH = "banyak_sampah"
    UNBALANCE = "unbalance"
    UNDERVOLTAGE = "undervoltage"
    OVERVOLTAGE = "overvoltage"
    DRY_RUN = "dry_run"
    PANEL_OVERHEAT = "panel_overheat"
    NORMAL = "normal"

    # backward compat: LOW_WATER_MENYALA alias -> dry_run
    LOW_WATER_MENYALA = "dry_run"


class SensorReading(BaseModel):
    timestamp: datetime = Field(alias="Start Time (WIB)")
    vsd_fault: bool = Field(default=False, alias="VSD Fault")
    vsd_standby: bool = Field(default=False, alias="VSD Standby")
    voltage_fault: bool = Field(default=False, alias="Voltage Fault")
    pump_fault: bool = Field(default=False, alias="Pump Fault")
    low_water: bool = Field(default=False, alias="Low Water")
    emergency: bool = Field(default=False, alias="Emergency")
    motor_speed: float | None = Field(default=None, alias="Motor Speed used")
    output_frequency: float | None = Field(default=None, alias="Output Frekuensi")
    motor_current: float | None = Field(default=None, alias="Motor current")
    motor_torque: float | None = Field(
        default=None, alias="Motor torque", description="persentase 0-100% (unit %)"
    )
    output_power: float | None = Field(default=None, alias="Output power")
    hours_run: float | None = Field(default=None, alias="Hours run")
    output_voltage: float | None = Field(default=None, alias="Output voltage")
    ambient_temperature: float | None = Field(default=None, alias="Ambient temperature")
    control_board_temperature: float | None = Field(default=None, alias="Control board temperature")
    inverter_temperature: float | None = Field(default=None, alias="Inverter temperature")
    input_voltage: float | None = None
    flux_actual: float | None = None
    active_fault_1: str = Field(default="", alias="Active fault 1")
    active_fault_2: str = Field(default="", alias="Active fault 2")
    active_fault_3: str = Field(default="", alias="Active fault 3")
    active_warning_1: str = Field(default="", alias="Active warning 1")
    active_warning_2: str = Field(default="", alias="Active warning 2")
    active_warning_3: str = Field(default="", alias="Active warning 3")
    motor_estimated_temperature: float | None = Field(default=None, alias="Motor Estimated Temperature")

    # Optional three-phase RMS currents used by
    # the UNBALANCE classification capability.
    arus_rms_u: float | None = Field(
        default=None,
        alias="Arus RMS U",
    )
    arus_rms_v: float | None = Field(
        default=None,
        alias="Arus RMS V",
    )
    arus_rms_w: float | None = Field(
        default=None,
        alias="Arus RMS W",
    )

    model_config = {"populate_by_name": True, "extra": "ignore"}


class PumpConfig(BaseModel):
    pump_id: int
    flowhead_id: Optional[int] = None
    type_flowhead: str = ""
    capacity_lps: int = 0
    setpoint_freq: list[float] = Field(default_factory=list)
    setpoint_kw: float = 0.0
    setpoint_ampere: float = 0.0
    setpoint_rpm: float = 0.0
    setpoint_torque: float = 0.0


class MatchedRule(BaseModel):
    trouble_type: TroubleType
    matched_conditions: list[str]
    total_conditions: int


RuleCapabilityStatus = Literal[
    "READY",
    "SKIPPED",
    "UNSUPPORTED",
]

RuleMatchStatus = Literal[
    "MATCH",
    "NO_MATCH",
]

ClassificationEvaluationStatus = Literal[
    "FULL",
    "PARTIAL",
    "INSUFFICIENT_DATA",
]


class RuleEvaluation(BaseModel):
    trouble_type: TroubleType

    capability_status: RuleCapabilityStatus

    evaluation: RuleMatchStatus | None = None

    missing_requirements: list[str] = Field(
        default_factory=list
    )

    matched_conditions: list[str] = Field(
        default_factory=list
    )

    total_conditions: int = Field(
        default=0,
        ge=0,
    )


class ClassificationResult(BaseModel):
    pump_id: int
    timestamp: datetime
    trouble_type: TroubleType
    matched_rules: list[MatchedRule]
    sensor_snapshot: dict
    readings_count: int = 0
    limitations: list[str] = Field(default_factory=list)

    evaluation_status: ClassificationEvaluationStatus = "FULL"

    rule_evaluations: list[RuleEvaluation] = Field(
        default_factory=list
    )


class OperatingSetpoint(BaseModel):
    """Active operating values supplied by Admin/configuration."""

    frequency: float | None = None
    rpm: float | None = None
    torque: float | None = Field(
        default=None, description="persentase 0-100% (unit %)"
    )

