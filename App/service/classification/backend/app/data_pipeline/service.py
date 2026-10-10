from __future__ import annotations

from app.data_pipeline.document_storage import (
    delete_document as _delete_document,
    list_documents as _list_documents,
    read_document as _read_document,
    read_document_metadata,
    read_normalized_document,
    read_raw_document,
    store_document,
    store_normalized_document,
    store_telemetry_dataset,
    read_telemetry_dataset,
)
from app.data_pipeline.models import (
    NormalizedDocument,
    TelemetryDataset,
    StoredDocumentMetadata,
    StoredDocumentPreview,
)
from app.data_pipeline.normalization import (
    build_telemetry_dataset,
    normalize_document as _normalize_raw_document,
)


class SourceDocumentNotReadyError(
    ValueError
):
    pass


def ingest_document(
    filename: str,
    content: bytes,
    preview_limit: int = 20,
) -> StoredDocumentPreview:
    return store_document(
        filename=filename,
        content=content,
        preview_limit=preview_limit,
    )


def get_document(
    document_id: str,
    preview_limit: int = 20,
) -> StoredDocumentPreview:
    return _read_document(
        document_id=document_id,
        preview_limit=preview_limit,
    )


def list_documents() -> list[
    StoredDocumentPreview
]:
    return _list_documents()


def delete_document(
    document_id: str,
) -> StoredDocumentMetadata:
    return _delete_document(
        document_id
    )


def normalize_document(
    document_id: str,
) -> NormalizedDocument:
    metadata = read_document_metadata(
        document_id
    )

    if metadata.status != "LOADED":
        raise SourceDocumentNotReadyError(
            "Source document is not ready "
            "for normalization: "
            f"{metadata.status}"
        )

    raw_document = read_raw_document(
        document_id
    )

    result = _normalize_raw_document(
        document_id,
        raw_document,
    )

    store_normalized_document(
        result
    )

    return result


def get_normalized_document(
    document_id: str,
) -> NormalizedDocument:
    return read_normalized_document(
        document_id
    )



def create_telemetry_dataset(
    document_id: str,
) -> TelemetryDataset:
    metadata = read_document_metadata(
        document_id
    )

    if metadata.status != "LOADED":
        raise SourceDocumentNotReadyError(
            "Source document is not ready "
            "for telemetry conversion: "
            f"{metadata.status}"
        )

    raw_document = read_raw_document(
        document_id
    )

    dataset = build_telemetry_dataset(
        document_id,
        raw_document,
    )

    store_telemetry_dataset(
        dataset
    )

    return dataset


def get_telemetry_dataset(
    document_id: str,
) -> TelemetryDataset:
    return read_telemetry_dataset(
        document_id
    )
