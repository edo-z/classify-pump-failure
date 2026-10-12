from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from app.data_pipeline.document_loader import (
    UnsupportedDocumentFormatError,
    load_document,
    preview_document,
    resolve_document_error,
)
from app.data_pipeline.models import (
    NormalizedDocument,
    RawDocument,
    TelemetryDataset,
    StoredDocumentMetadata,
    StoredDocumentPreview,
)


def _default_data_dir(name: str) -> Path:
    """Portable default: $XDG_DATA_HOME/agent-maintenance/<name>, else ~/Documents.

    Menggantikan hardcoded /home/aldo/... agar deploy di mesin lain tidak
    menulis ke lokasi salah (FMEA F10). Env tetap menang bila di-set.
    """
    import os

    xdg = os.getenv("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / "agent-maintenance" / name
    return Path.home() / "Documents" / "Agent-Maintenance" / "Data" / name


STORAGE_ROOT = Path(
    os.getenv(
        "CLASSIFICATION_INPUT_DIR",
        str(_default_data_dir("classification-input")),
    )
)

NORMALIZED_STORAGE_ROOT = Path(
    os.getenv(
        "CLASSIFICATION_NORMALIZED_DIR",
        str(_default_data_dir("classification-normalized")),
    )
)


class DocumentStorageError(ValueError):
    pass


class InvalidDocumentNameError(
    DocumentStorageError
):
    pass


class DocumentNotFoundError(
    DocumentStorageError
):
    pass


class DocumentAlreadyExistsError(
    DocumentStorageError
):
    pass


class NormalizationStorageError(ValueError):
    pass


class InvalidNormalizedDocumentIdError(
    NormalizationStorageError
):
    pass


class NormalizedDocumentNotFoundError(
    NormalizationStorageError
):
    pass


logger = logging.getLogger(
    __name__
)


def _trash_dir(
    base: Path,
) -> Path:
    path = base / ".trash"
    path.mkdir(
        parents=True,
        exist_ok=True,
    )
    return path


def _move_to_trash(
    path: Path,
    trash_base: Path,
) -> str | None:
    """Pindah file ke .trash (bisa dikembalikan), bukan unlink langsung.

    Insiden 2026-10-12: hapus permanen tak teraudit. Return nama tujuan
    untuk log audit, atau None bila file memang tidak ada.
    """
    if not path.exists():
        return None
    stamp = datetime.now(
        timezone.utc
    ).strftime(
        "%Y%m%dT%H%M%S"
    )
    dest = (
        _trash_dir(
            trash_base
        )
        / f"{stamp}_{path.name}"
    )
    path.rename(
        dest
    )
    return dest.name


def validate_document_id(
    document_id: str,
) -> str:
    document_id = document_id.strip()

    if not document_id:
        raise ValueError(
            "Document ID is required"
        )

    if Path(document_id).name != document_id:
        raise ValueError(
            "Document ID must not contain a path"
        )

    if (
        Path(document_id).suffix.lower()
        != ".csv"
    ):
        raise ValueError(
            "Document ID must be a CSV filename"
        )

    return document_id


def _validate_filename(
    filename: str,
) -> str:
    filename = filename.strip()

    if not filename:
        raise InvalidDocumentNameError(
            "Filename is required"
        )

    if Path(filename).name != filename:
        raise InvalidDocumentNameError(
            "Filename must not contain a path"
        )

    if Path(filename).suffix.lower() != ".csv":
        raise UnsupportedDocumentFormatError(
            "Only CSV documents are supported"
        )

    return filename


def _validate_source_document_id(
    document_id: str,
) -> str:
    try:
        return validate_document_id(
            document_id
        )
    except ValueError as exc:
        raise InvalidDocumentNameError(
            str(exc)
        ) from exc


def _validate_normalized_document_id(
    document_id: str,
) -> str:
    try:
        return validate_document_id(
            document_id
        )
    except ValueError as exc:
        raise InvalidNormalizedDocumentIdError(
            str(exc)
        ) from exc


def _raw_dir() -> Path:
    return STORAGE_ROOT / "raw"


def _metadata_dir() -> Path:
    return STORAGE_ROOT / "metadata"


def _ensure_source_storage() -> None:
    _raw_dir().mkdir(
        parents=True,
        exist_ok=True,
    )

    _metadata_dir().mkdir(
        parents=True,
        exist_ok=True,
    )


def _ensure_normalized_storage() -> None:
    NORMALIZED_STORAGE_ROOT.mkdir(
        parents=True,
        exist_ok=True,
    )


def _raw_path(
    document_id: str,
) -> Path:
    return (
        _raw_dir()
        / _validate_source_document_id(
            document_id
        )
    )


def _metadata_path(
    document_id: str,
) -> Path:
    return (
        _metadata_dir()
        / (
            f"{_validate_source_document_id(document_id)}"
            ".json"
        )
    )


def _normalized_path(
    document_id: str,
) -> Path:
    document_id = (
        _validate_normalized_document_id(
            document_id
        )
    )

    return (
        NORMALIZED_STORAGE_ROOT
        / f"{document_id}.json"
    )


def store_document(
    filename: str,
    content: bytes,
    preview_limit: int = 20,
) -> StoredDocumentPreview:
    filename = _validate_filename(
        filename
    )

    _ensure_source_storage()

    document_id = filename

    raw_path = _raw_path(
        document_id
    )

    metadata_path = _metadata_path(
        document_id
    )

    if (
        raw_path.exists()
        or metadata_path.exists()
    ):
        raise DocumentAlreadyExistsError(
            "Document already exists: "
            f"{document_id}"
        )

    raw_path.write_bytes(
        content
    )

    preview = preview_document(
        raw_path,
        preview_limit=preview_limit,
    )

    error_code = None
    error_title = None
    user_message = None
    technical_detail = None

    if preview.error:
        error_info = resolve_document_error(
            preview.error
        )

        error_code = error_info.code
        error_title = error_info.title
        user_message = error_info.user_message
        technical_detail = (
            error_info.technical_detail
        )

    metadata = StoredDocumentMetadata(
        document_id=document_id,
        filename=filename,
        file_type="csv",
        size_bytes=len(content),
        created_at=datetime.now(
            timezone.utc
        ).isoformat(),
        row_count=preview.row_count,
        column_count=preview.column_count,
        columns=preview.columns,
        status=preview.status,
        error_code=error_code,
        error_title=error_title,
        user_message=user_message,
        technical_detail=technical_detail,
        next_stage=preview.next_stage,
    )

    metadata_path.write_text(
        json.dumps(
            metadata.model_dump(
                mode="json"
            ),
            indent=2,
        ),
        encoding="utf-8",
    )

    return StoredDocumentPreview(
        **metadata.model_dump(),
        preview_rows=preview.preview_rows,
    )


def read_document_metadata(
    document_id: str,
) -> StoredDocumentMetadata:
    metadata_path = _metadata_path(
        document_id
    )

    if not metadata_path.exists():
        raise DocumentNotFoundError(
            f"Document not found: {document_id}"
        )

    payload = json.loads(
        metadata_path.read_text(
            encoding="utf-8"
        )
    )

    return StoredDocumentMetadata.model_validate(
        payload
    )


def read_document(
    document_id: str,
    preview_limit: int = 20,
) -> StoredDocumentPreview:
    metadata = read_document_metadata(
        document_id
    )

    raw_path = _raw_path(
        document_id
    )

    if not raw_path.exists():
        raise DocumentNotFoundError(
            f"Raw document not found: {document_id}"
        )

    preview = preview_document(
        raw_path,
        preview_limit=preview_limit,
    )

    return StoredDocumentPreview(
        **metadata.model_dump(),
        preview_rows=preview.preview_rows,
    )


def read_raw_document(
    document_id: str,
) -> RawDocument:
    read_document_metadata(
        document_id
    )

    raw_path = _raw_path(
        document_id
    )

    if not raw_path.exists():
        raise DocumentNotFoundError(
            f"Raw document not found: {document_id}"
        )

    return load_document(
        raw_path
    )


def list_documents() -> list[
    StoredDocumentPreview
]:
    _ensure_source_storage()

    documents: list[
        StoredDocumentPreview
    ] = []

    for path in _metadata_dir().glob(
        "*.json"
    ):
        payload = json.loads(
            path.read_text(
                encoding="utf-8"
            )
        )

        metadata = (
            StoredDocumentMetadata.model_validate(
                payload
            )
        )

        documents.append(
            StoredDocumentPreview(
                **metadata.model_dump(),
                preview_rows=[],
            )
        )

    documents.sort(
        key=lambda item: item.created_at,
        reverse=True,
    )

    return documents


def delete_document(
    document_id: str,
) -> StoredDocumentMetadata:
    metadata = read_document_metadata(
        document_id
    )

    raw_path = _raw_path(
        document_id
    )

    metadata_path = _metadata_path(
        document_id
    )

    # Pindah ke .trash (bisa dikembalikan), bukan unlink permanen.
    trashed_raw = _move_to_trash(
        raw_path,
        STORAGE_ROOT,
    )

    trashed_metadata = _move_to_trash(
        metadata_path,
        STORAGE_ROOT,
    )

    # Cleanup derived artifacts (telemetry & normalized) if present
    try:
        telemetry_path = _telemetry_path(document_id)
        trashed_telemetry = _move_to_trash(
            telemetry_path,
            NORMALIZED_STORAGE_ROOT,
        )
    except Exception:
        trashed_telemetry = None

    try:
        normalized_path = _normalized_path(document_id)
        trashed_normalized = _move_to_trash(
            normalized_path,
            NORMALIZED_STORAGE_ROOT,
        )
    except Exception:
        trashed_normalized = None

    logger.info(
        "DELETE document_id=%s raw=%s metadata=%s "
        "telemetry=%s normalized=%s",
        document_id,
        trashed_raw,
        trashed_metadata,
        trashed_telemetry,
        trashed_normalized,
    )

    return metadata


def store_normalized_document(
    document: NormalizedDocument,
) -> NormalizedDocument:
    _ensure_normalized_storage()

    path = _normalized_path(
        document.document_id
    )

    path.write_text(
        document.model_dump_json(
            indent=2
        ),
        encoding="utf-8",
    )

    return document


def read_normalized_document(
    document_id: str,
) -> NormalizedDocument:
    path = _normalized_path(
        document_id
    )

    if not path.exists():
        raise NormalizedDocumentNotFoundError(
            "Normalized document not found: "
            f"{document_id}"
        )

    return (
        NormalizedDocument.model_validate_json(
            path.read_text(
                encoding="utf-8"
            )
        )
    )


def normalized_document_exists(
    document_id: str,
) -> bool:
    return _normalized_path(
        document_id
    ).exists()



# ---------------------------------------------------------------------------
# Telemetry Dataset Storage
# ---------------------------------------------------------------------------


class TelemetryDatasetNotFoundError(ValueError):
    pass


def _telemetry_dir() -> Path:
    return NORMALIZED_STORAGE_ROOT / "telemetry"


def _ensure_telemetry_storage() -> None:
    _telemetry_dir().mkdir(
        parents=True,
        exist_ok=True,
    )


def _telemetry_path(
    document_id: str,
) -> Path:
    document_id = validate_document_id(
        document_id
    )

    return (
        _telemetry_dir()
        / f"{document_id}.json"
    )


def store_telemetry_dataset(
    dataset: TelemetryDataset,
) -> TelemetryDataset:
    _ensure_telemetry_storage()

    path = _telemetry_path(
        dataset.document_id
    )

    path.write_text(
        dataset.model_dump_json(
            indent=2
        ),
        encoding="utf-8",
    )

    return dataset


def read_telemetry_dataset(
    document_id: str,
) -> TelemetryDataset:
    path = _telemetry_path(
        document_id
    )

    if not path.exists():
        raise TelemetryDatasetNotFoundError(
            "Telemetry dataset not found: "
            f"{document_id}"
        )

    return TelemetryDataset.model_validate_json(
        path.read_text(
            encoding="utf-8"
        )
    )
