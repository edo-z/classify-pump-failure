from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


DocumentStatus = Literal[
    "LOADED",
    "PARSE_ERROR",
    "UNSUPPORTED_FORMAT",
]

DocumentNextStage = Literal[
    "NORMALIZATION",
]

NormalizationRowStatus = Literal[
    "COMPLETE",
    "PARTIAL",
]

NormalizationDocumentStatus = Literal[
    "NORMALIZED",
    "PARTIAL",
    "UNSUPPORTED_SCHEMA",
]


class RawDocument(BaseModel):
    filename: str
    file_type: Literal["csv"]
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    columns: list[str]
    rows: list[list[str]]


class DocumentPreview(BaseModel):
    filename: str
    file_type: str
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    columns: list[str]
    preview_rows: list[list[str]]
    status: DocumentStatus
    error: str | None = None
    next_stage: DocumentNextStage | None = None


class StoredDocumentMetadata(BaseModel):
    document_id: str
    filename: str
    file_type: Literal["csv"]
    size_bytes: int = Field(ge=0)
    created_at: str
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    columns: list[str]
    status: DocumentStatus
    error_code: str | None = None
    error_title: str | None = None
    user_message: str | None = None
    technical_detail: str | None = None
    next_stage: DocumentNextStage | None = None


class StoredDocumentPreview(
    StoredDocumentMetadata
):
    preview_rows: list[list[str]] = Field(
        default_factory=list
    )


class NormalizationSchemaInspection(BaseModel):
    schema_name: Literal[
        "PUMP_TELEMETRY",
        "PUMP_TELEMETRY_LITE",
    ] | None = None
    supported: bool
    missing_columns: list[str] = Field(
        default_factory=list
    )
    duplicate_required_columns: list[str] = Field(
        default_factory=list
    )


class NormalizedRow(BaseModel):
    document_id: str
    source_row: int = Field(ge=2)
    timestamp: datetime | None = None
    frequency_hz: float | None = None
    power_kw: float | None = None
    current_a: float | None = None
    torque: float | None = None
    rpm: float | None = None

    phase_current_u_a: float | None = None
    phase_current_v_a: float | None = None
    phase_current_w_a: float | None = None

    ambient_temp_c: float | None = None
    control_board_temp_c: float | None = None
    inverter_temp_c: float | None = None

    normalization_status: NormalizationRowStatus

    missing_fields: list[str] = Field(
        default_factory=list
    )
    invalid_fields: list[str] = Field(
        default_factory=list
    )
    # 5R/Rawat + FMEA F4: kolom kanonikal yang memang tidak ada di varian
    # skema (mis. LITE 5 kolom) — bukan data hilang per baris.
    absent_schema_fields: list[str] = Field(
        default_factory=list
    )


class NormalizedDocument(BaseModel):
    document_id: str
    filename: str
    schema_inspection: NormalizationSchemaInspection

    raw_row_count: int = Field(ge=0)
    complete_row_count: int = Field(ge=0)
    partial_row_count: int = Field(ge=0)

    status: NormalizationDocumentStatus

    rows: list[NormalizedRow] = Field(
        default_factory=list
    )


# ---------------------------------------------------------------------------
# Telemetry Dataset Contract
# ---------------------------------------------------------------------------


class TelemetrySample(BaseModel):
    document_id: str
    source_row: int = Field(ge=2)

    timestamp: datetime | None = None

    motor_speed: float | None = None
    output_frequency: float | None = None
    motor_current: float | None = None
    motor_torque: float | None = None
    output_power: float | None = None
    hours_run: float | None = None
    output_voltage: float | None = None
    ambient_temperature: float | None = None
    control_board_temperature: float | None = None
    inverter_temperature: float | None = None
    input_voltage: float | None = None
    flux_actual: float | None = None
    motor_estimated_temperature: float | None = None
    arus_rms_u: float | None = None
    arus_rms_v: float | None = None
    arus_rms_w: float | None = None

    normalization_status: NormalizationRowStatus

    missing_fields: list[str] = Field(
        default_factory=list
    )
    invalid_fields: list[str] = Field(
        default_factory=list
    )
    # 5R/Rawat + FMEA F4: kolom kanonikal yang memang tidak ada di varian
    # skema (mis. LITE 5 kolom) — bukan data hilang per baris.
    absent_schema_fields: list[str] = Field(
        default_factory=list
    )


class TelemetryDataset(BaseModel):
    document_id: str
    filename: str

    schema_inspection: NormalizationSchemaInspection

    raw_row_count: int = Field(ge=0)
    complete_row_count: int = Field(ge=0)
    partial_row_count: int = Field(ge=0)

    status: NormalizationDocumentStatus

    samples: list[TelemetrySample] = Field(
        default_factory=list
    )

