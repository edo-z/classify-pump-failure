from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
)

from app.data_pipeline.service import (
    delete_document as delete_document_from_pipeline,
    get_document as get_document_from_pipeline,
    ingest_document,
    list_documents,
)
from app.data_pipeline.document_loader import (
    UnsupportedDocumentFormatError,
)
from app.data_pipeline.models import (
    StoredDocumentPreview,
)
from app.data_pipeline.document_storage import (
    DocumentAlreadyExistsError,
    DocumentNotFoundError,
    InvalidDocumentNameError,
)


router = APIRouter(
    prefix="/documents",
    tags=["documents"],
)

# 5R/Rawat + FMEA F5: batasi upload agar CSV raksasa tidak OOM/disk penuh.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


@router.post(
    "/upload",
    response_model=StoredDocumentPreview,
    status_code=201,
)
async def upload_document(
    request: Request,
    filename: str = Query(
        min_length=1,
    ),
) -> StoredDocumentPreview:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload too large: {content_length} bytes > {MAX_UPLOAD_BYTES} bytes (50MB)",
                )
        except ValueError:
            pass
    content = await request.body()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Upload too large: {len(content)} bytes > {MAX_UPLOAD_BYTES} bytes (50MB)",
        )

    try:
        return ingest_document(
            filename=filename,
            content=content,
            preview_limit=20,
        )

    except UnsupportedDocumentFormatError as exc:
        raise HTTPException(
            status_code=415,
            detail=str(exc),
        ) from exc

    except DocumentAlreadyExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    except InvalidDocumentNameError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc


@router.get(
    "",
    response_model=list[
        StoredDocumentPreview
    ],
)
def get_documents() -> list[
    StoredDocumentPreview
]:
    return list_documents()


@router.get(
    "/{document_id}",
    response_model=StoredDocumentPreview,
)
def get_document(
    document_id: str,
    preview_limit: int = Query(
        default=20,
        ge=0,
        le=100,
    ),
) -> StoredDocumentPreview:
    try:
        return get_document_from_pipeline(
            document_id=document_id,
            preview_limit=preview_limit,
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


@router.delete(
    "/{document_id}",
    response_model=StoredDocumentPreview,
)
def delete_document(
    document_id: str,
) -> StoredDocumentPreview:
    try:
        metadata = (
            delete_document_from_pipeline(
                document_id
            )
        )

        return StoredDocumentPreview(
            **metadata.model_dump(),
            preview_rows=[],
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
