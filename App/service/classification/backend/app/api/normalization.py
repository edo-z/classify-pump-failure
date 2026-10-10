from __future__ import annotations

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
)
from pydantic import BaseModel, Field

from app.data_pipeline.service import (
    SourceDocumentNotReadyError,
    get_normalized_document as get_normalized_document_from_pipeline,
    normalize_document,
)
from app.data_pipeline.document_storage import (
    DocumentNotFoundError,
    InvalidDocumentNameError,
)
from app.data_pipeline.models import (
    NormalizationDocumentStatus,
    NormalizationSchemaInspection,
    NormalizedDocument,
    NormalizedRow,
)
from app.data_pipeline.document_storage import (
    InvalidNormalizedDocumentIdError,
    NormalizedDocumentNotFoundError,
)


router = APIRouter(
    prefix="/normalization",
    tags=["normalization"],
)


RESEARCH_FIELDS = (
    "frequency_hz",
    "power_kw",
    "current_a",
    "torque",
    "rpm",
    "ambient_temp_c",
    "control_board_temp_c",
    "inverter_temp_c",
)


class ResearchFieldSummary(BaseModel):
    available_count: int = Field(ge=0)
    missing_count: int = Field(ge=0)
    invalid_count: int = Field(ge=0)
    min: float | None
    max: float | None
    mean: float | None


class ResearchSummary(BaseModel):
    fields: dict[
        str,
        ResearchFieldSummary,
    ]

    missing_field_counts: dict[
        str,
        int,
    ]

    invalid_field_counts: dict[
        str,
        int,
    ]

    partial_source_rows: list[int]


class ResearchSampling(BaseModel):
    method: str

    source_rows: int = Field(
        ge=0
    )

    returned_rows: int = Field(
        ge=0
    )


class NormalizedDocumentResponse(BaseModel):
    document_id: str
    filename: str

    schema_inspection: (
        NormalizationSchemaInspection
    )

    raw_row_count: int = Field(
        ge=0
    )

    complete_row_count: int = Field(
        ge=0
    )

    partial_row_count: int = Field(
        ge=0
    )

    status: NormalizationDocumentStatus

    preview_rows: list[
        NormalizedRow
    ] = Field(
        default_factory=list
    )

    research_rows: list[
        NormalizedRow
    ] = Field(
        default_factory=list
    )

    research_summary: ResearchSummary

    research_sampling: ResearchSampling


def _sample_research_rows(
    rows: list[NormalizedRow],
    research_limit: int,
) -> list[NormalizedRow]:
    if (
        research_limit <= 0
        or not rows
    ):
        return []

    if len(rows) <= research_limit:
        return list(rows)

    if research_limit == 1:
        return [
            rows[0]
        ]

    last_index = (
        len(rows) - 1
    )

    indexes = [
        round(
            index
            * last_index
            / (
                research_limit
                - 1
            )
        )
        for index in range(
            research_limit
        )
    ]

    return [
        rows[index]
        for index in indexes
    ]


def _build_research_summary(
    rows: list[NormalizedRow],
) -> ResearchSummary:
    fields: dict[
        str,
        ResearchFieldSummary,
    ] = {}

    for field in RESEARCH_FIELDS:
        available = [
            getattr(row, field)
            for row in rows
            if getattr(row, field)
            is not None
        ]

        missing_count = sum(
            field in row.missing_fields
            for row in rows
        )

        invalid_count = sum(
            field in row.invalid_fields
            for row in rows
        )

        fields[field] = (
            ResearchFieldSummary(
                available_count=(
                    len(available)
                ),
                missing_count=(
                    missing_count
                ),
                invalid_count=(
                    invalid_count
                ),
                min=(
                    min(available)
                    if available
                    else None
                ),
                max=(
                    max(available)
                    if available
                    else None
                ),
                mean=(
                    sum(available)
                    / len(available)
                    if available
                    else None
                ),
            )
        )

    missing_field_counts: dict[
        str,
        int,
    ] = {}

    invalid_field_counts: dict[
        str,
        int,
    ] = {}

    partial_source_rows: list[int] = []

    for row in rows:
        if (
            row.normalization_status
            == "PARTIAL"
        ):
            partial_source_rows.append(
                row.source_row
            )

        for field in row.missing_fields:
            missing_field_counts[field] = (
                missing_field_counts.get(
                    field,
                    0,
                )
                + 1
            )

        for field in row.invalid_fields:
            invalid_field_counts[field] = (
                invalid_field_counts.get(
                    field,
                    0,
                )
                + 1
            )

    return ResearchSummary(
        fields=fields,
        missing_field_counts=(
            missing_field_counts
        ),
        invalid_field_counts=(
            invalid_field_counts
        ),
        partial_source_rows=(
            partial_source_rows
        ),
    )



def _to_response(
    document: NormalizedDocument,
    preview_limit: int,
    research_limit: int,
) -> NormalizedDocumentResponse:
    research_rows = (
        _sample_research_rows(
            document.rows,
            research_limit,
        )
    )

    return NormalizedDocumentResponse(
        document_id=(
            document.document_id
        ),
        filename=document.filename,
        schema_inspection=(
            document.schema_inspection
        ),
        raw_row_count=(
            document.raw_row_count
        ),
        complete_row_count=(
            document.complete_row_count
        ),
        partial_row_count=(
            document.partial_row_count
        ),
        status=document.status,
        preview_rows=(
            document.rows[
                :preview_limit
            ]
        ),
        research_rows=(
            research_rows
        ),
        research_summary=(
            _build_research_summary(
                document.rows
            )
        ),
        research_sampling=(
            ResearchSampling(
                method=(
                    "EVENLY_SPACED"
                ),
                source_rows=(
                    len(
                        document.rows
                    )
                ),
                returned_rows=(
                    len(
                        research_rows
                    )
                ),
            )
        ),
    )


@router.post(
    "/{document_id}",
    response_model=NormalizedDocumentResponse,
)
def normalize_document_api(
    document_id: str,
    preview_limit: int = Query(
        default=20,
        ge=0,
        le=100,
    ),
    research_limit: int = Query(
        default=1000,
        ge=0,
        le=2000,
    ),
) -> NormalizedDocumentResponse:
    try:
        result = normalize_document(
            document_id
        )

        return _to_response(
            result,
            preview_limit,
            research_limit,
        )

    except InvalidDocumentNameError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except DocumentNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except SourceDocumentNotReadyError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc


@router.get(
    "/{document_id}",
    response_model=NormalizedDocumentResponse,
)
def get_normalized_document(
    document_id: str,
    preview_limit: int = Query(
        default=20,
        ge=0,
        le=100,
    ),
    research_limit: int = Query(
        default=1000,
        ge=0,
        le=2000,
    ),
) -> NormalizedDocumentResponse:
    try:
        result = get_normalized_document_from_pipeline(
            document_id
        )

        return _to_response(
            result,
            preview_limit,
            research_limit,
        )

    except InvalidNormalizedDocumentIdError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except NormalizedDocumentNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc
