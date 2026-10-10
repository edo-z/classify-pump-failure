from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from app.data_pipeline.models import (
    DocumentPreview,
    RawDocument,
)


class DocumentLoadError(ValueError):
    pass


class DocumentParseError(DocumentLoadError):
    pass


class UnsupportedDocumentFormatError(
    DocumentLoadError
):
    pass


@dataclass(frozen=True)
class DocumentErrorInfo:
    code: str
    title: str
    user_message: str
    technical_detail: str


def resolve_document_error(
    error: str,
) -> DocumentErrorInfo:
    lowered = error.lower()

    if "column count mismatch" in lowered:
        return DocumentErrorInfo(
            code="CSV_COLUMN_MISMATCH",
            title="Document Format Error",
            user_message=(
                "The CSV structure is inconsistent. "
                "Check that every row has the same "
                "number of columns as the header."
            ),
            technical_detail=error,
        )

    if "document is empty" in lowered:
        return DocumentErrorInfo(
            code="EMPTY_DOCUMENT",
            title="Empty Document",
            user_message=(
                "The CSV document is empty. "
                "Upload a document containing a valid "
                "header and data."
            ),
            technical_detail=error,
        )

    if "no header" in lowered:
        return DocumentErrorInfo(
            code="CSV_HEADER_MISSING",
            title="Header Not Found",
            user_message=(
                "The CSV document does not contain "
                "a valid header."
            ),
            technical_detail=error,
        )

    if "decode csv as utf-8" in lowered:
        return DocumentErrorInfo(
            code="CSV_ENCODING_UNSUPPORTED",
            title="Document Encoding Error",
            user_message=(
                "The document encoding is not supported. "
                "Please provide a UTF-8 CSV document."
            ),
            technical_detail=error,
        )

    if "document not found" in lowered:
        return DocumentErrorInfo(
            code="DOCUMENT_NOT_FOUND",
            title="Document Not Found",
            user_message=(
                "The requested document could not be found."
            ),
            technical_detail=error,
        )

    return DocumentErrorInfo(
        code="DOCUMENT_PARSE_ERROR",
        title="Document Processing Error",
        user_message=(
            "The document could not be processed. "
            "Check the CSV structure and try again."
        ),
        technical_detail=error,
    )


def load_csv_document(
    path: Path,
) -> RawDocument:
    if path.suffix.lower() != ".csv":
        raise UnsupportedDocumentFormatError(
            "Unsupported document format: "
            f"{path.suffix or 'none'}"
        )

    if not path.exists():
        raise DocumentParseError(
            f"Document not found: {path}"
        )

    try:
        with path.open(
            "r",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            reader = csv.reader(handle)
            raw_rows = list(reader)

    except UnicodeDecodeError as exc:
        raise DocumentParseError(
            f"Unable to decode CSV as UTF-8: {exc}"
        ) from exc

    except csv.Error as exc:
        raise DocumentParseError(
            f"CSV parse error: {exc}"
        ) from exc

    except OSError as exc:
        raise DocumentParseError(
            f"Unable to read document: {exc}"
        ) from exc

    if not raw_rows:
        raise DocumentParseError(
            "CSV document is empty"
        )

    columns = raw_rows[0]

    if not columns:
        raise DocumentParseError(
            "CSV document has no header"
        )

    expected_columns = len(columns)
    rows: list[list[str]] = []

    for line_number, row in enumerate(
        raw_rows[1:],
        start=2,
    ):
        if not row or all(
            value == ""
            for value in row
        ):
            continue

        if len(row) != expected_columns:
            raise DocumentParseError(
                "CSV column count mismatch "
                f"at line {line_number}: "
                f"expected {expected_columns}, "
                f"got {len(row)}"
            )

        rows.append(row)

    return RawDocument(
        filename=path.name,
        file_type="csv",
        row_count=len(rows),
        column_count=expected_columns,
        columns=columns,
        rows=rows,
    )


def load_document(
    path: Path,
) -> RawDocument:
    suffix = path.suffix.lower()

    if suffix == ".csv":
        return load_csv_document(path)

    raise UnsupportedDocumentFormatError(
        f"Unsupported document format: "
        f"{suffix or 'none'}"
    )


def preview_document(
    path: Path,
    preview_limit: int = 20,
) -> DocumentPreview:
    if preview_limit < 0:
        raise ValueError(
            "preview_limit must be >= 0"
        )

    try:
        document = load_document(path)

    except UnsupportedDocumentFormatError as exc:
        return DocumentPreview(
            filename=path.name,
            file_type=(
                path.suffix.lower().lstrip(".")
                or "unknown"
            ),
            row_count=0,
            column_count=0,
            columns=[],
            preview_rows=[],
            status="UNSUPPORTED_FORMAT",
            error=str(exc),
            next_stage=None,
        )

    except DocumentParseError as exc:
        return DocumentPreview(
            filename=path.name,
            file_type=(
                path.suffix.lower().lstrip(".")
                or "unknown"
            ),
            row_count=0,
            column_count=0,
            columns=[],
            preview_rows=[],
            status="PARSE_ERROR",
            error=str(exc),
            next_stage=None,
        )

    return DocumentPreview(
        filename=document.filename,
        file_type=document.file_type,
        row_count=document.row_count,
        column_count=document.column_count,
        columns=document.columns,
        preview_rows=document.rows[
            :preview_limit
        ],
        status="LOADED",
        error=None,
        next_stage="NORMALIZATION",
    )
