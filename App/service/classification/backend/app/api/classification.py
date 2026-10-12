from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.classification.engine import (
    UnsupportedPumpConfigurationError,
)
from app.classification.service import (
    ClassificationPipelineResult,
    NoTimestampedRowsError,
    UnsupportedTelemetryDatasetError,
    classify_document,
    scan_classification_points,
)
from app.classification.tier_refs import TierRefsResponse, load_tier_refs
from app.data_pipeline.document_storage import (
    TelemetryDatasetNotFoundError,
)
from app.data_pipeline.service import (
    get_telemetry_dataset,
    mark_document_in_progress,
    unmark_document_in_progress,
)


router = APIRouter(
    prefix="/classification",
    tags=["classification"],
)


class ClassificationRunRequest(BaseModel):
    document_id: str
    profile_id: str
    setpoint_freq: float | None = None


@router.post(
    "/run",
    response_model=ClassificationPipelineResult,
)
def run_classification(
    req: ClassificationRunRequest,
) -> ClassificationPipelineResult:
    """Nilai murni per-sampel ala live: pembacaan terakhir + evidensi trailing."""
    mark_document_in_progress(
        req.document_id
    )
    try:
        return classify_document(
            document_id=req.document_id,
            profile_id=req.profile_id,
            setpoint_freq=req.setpoint_freq,
        )

    except TelemetryDatasetNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail=(
                "Unknown pump profile: "
                f"{req.profile_id}"
            ),
        ) from exc

    except UnsupportedTelemetryDatasetError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except NoTimestampedRowsError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except UnsupportedPumpConfigurationError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

    finally:
        unmark_document_in_progress(
            req.document_id
        )


@router.get(
    "/tier-refs",
    response_model=TierRefsResponse,
)
def get_tier_refs() -> TierRefsResponse:
    """Ambang per-tier dari rules.json untuk layer threshold visual (keputusan produk #3)."""
    try:
        return load_tier_refs()
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/scan/{document_id}",
)
def scan_classification(
    document_id: str,
    profile_id: str = "5000_lps",
    setpoint_freq: float | None = None,
):
    """
    Pindai seluruh file per-sampel ala live (full-resolution, tiap sampel
    dinilai dengan evidensi trailingnya).
    """
    mark_document_in_progress(
        document_id
    )
    try:
        dataset = get_telemetry_dataset(document_id)
        points = scan_classification_points(
            dataset=dataset,
            profile_id=profile_id,
            setpoint_freq=setpoint_freq,
        )
        return {
            "document_id": document_id,
            "profile_id": profile_id,
            "total_points": len(points),
            "failure_count": sum(1 for p in points if p["is_failure"]),
            "points": points,
        }
    except TelemetryDatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"Unknown pump profile: {profile_id}"
        ) from exc
    except UnsupportedTelemetryDatasetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except NoTimestampedRowsError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        unmark_document_in_progress(
            document_id
        )
