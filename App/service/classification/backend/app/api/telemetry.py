from __future__ import annotations

from fastapi import (
    APIRouter,
    HTTPException,
)

from app.data_pipeline.document_storage import (
    DocumentNotFoundError,
    InvalidDocumentNameError,
    TelemetryDatasetNotFoundError,
)
from app.data_pipeline.models import (
    TelemetryDataset,
)
from app.data_pipeline.service import (
    SourceDocumentNotReadyError,
    create_telemetry_dataset,
    get_telemetry_dataset,
)


router = APIRouter(
    prefix="/telemetry",
    tags=["telemetry"],
)


@router.post(
    "/{document_id}",
    response_model=TelemetryDataset,
)
def create_telemetry(
    document_id: str,
) -> TelemetryDataset:
    try:
        return create_telemetry_dataset(
            document_id
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
    response_model=TelemetryDataset,
)
def get_telemetry(
    document_id: str,
) -> TelemetryDataset:
    try:
        return get_telemetry_dataset(
            document_id
        )

    except TelemetryDatasetNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
