from __future__ import annotations

import math
from collections import Counter
from datetime import datetime

from app.data_pipeline.models import (
    NormalizationSchemaInspection,
    NormalizedDocument,
    NormalizedRow,
    RawDocument,
)


SCHEMA_NAME = "PUMP_TELEMETRY"

SOURCE_TO_CANONICAL = {
    "Start Time (WIB)": "timestamp",
    "Output Frekuensi": "frequency_hz",
    "Output power": "power_kw",
    "Motor current": "current_a",
    "Motor torque": "torque",
    "Motor Speed used": "rpm",
    "Ambient temperature": "ambient_temp_c",
    "Control board temperature": (
        "control_board_temp_c"
    ),
    "Inverter temperature": "inverter_temp_c",
}

OPTIONAL_SOURCE_TO_CANONICAL = {
    "Arus RMS U": "phase_current_u_a",
    "Arus RMS V": "phase_current_v_a",
    "Arus RMS W": "phase_current_w_a",
}

REQUIRED_SOURCE_COLUMNS = tuple(
    SOURCE_TO_CANONICAL.keys()
)

# 5R/Rapi: skema lite 5 kolom (file harian, mis. "pucang tgl27.csv").
# Torque lite = persen, sama seperti Motor torque skema penuh.
LITE_SOURCE_TO_CANONICAL = {
    "Timestamp WIB": "timestamp",
    "Frequency (Hz)": "frequency_hz",
    "Power (kW)": "power_kw",
    "Motor Current (A)": "current_a",
    "Torque": "torque",
}

SCHEMA_NAME_LITE = "PUMP_TELEMETRY_LITE"

NORMALIZATION_SCHEMA_VARIANTS: tuple[
    tuple[str, dict[str, str]],
    ...,
] = (
    (SCHEMA_NAME, SOURCE_TO_CANONICAL),
    (SCHEMA_NAME_LITE, LITE_SOURCE_TO_CANONICAL),
)

NULL_VALUES = {
    "",
    "null",
    "na",
    "n/a",
    "nan",
    "none",
    "-",
    "--",
}


def _inspect_columns(
    columns: list[str],
    variant_map: dict[str, str],
) -> tuple[list[str], list[str]]:
    column_counts = Counter(
        columns
    )

    missing_columns = [
        column
        for column in variant_map
        if column_counts[column] == 0
    ]

    duplicate_required_columns = [
        column
        for column in variant_map
        if column_counts[column] > 1
    ]

    return (
        missing_columns,
        duplicate_required_columns,
    )


def inspect_schema(
    document: RawDocument,
) -> NormalizationSchemaInspection:
    for schema_name, variant_map in NORMALIZATION_SCHEMA_VARIANTS:
        (
            missing_columns,
            duplicate_required_columns,
        ) = _inspect_columns(
            document.columns,
            variant_map,
        )

        if (
            not missing_columns
            and not duplicate_required_columns
        ):
            return NormalizationSchemaInspection(
                schema_name=schema_name,
                supported=True,
                missing_columns=[],
                duplicate_required_columns=[],
            )

    # Tak ada varian cocok: laporkan kolom hilang vs skema penuh
    # (perilaku lama, pesan galat tidak berubah).
    (
        missing_columns,
        duplicate_required_columns,
    ) = _inspect_columns(
        document.columns,
        SOURCE_TO_CANONICAL,
    )

    return NormalizationSchemaInspection(
        schema_name=None,
        supported=False,
        missing_columns=missing_columns,
        duplicate_required_columns=(
            duplicate_required_columns
        ),
    )


def _normalization_variant_map(
    schema_name: str | None,
) -> dict[str, str]:
    for name, variant_map in NORMALIZATION_SCHEMA_VARIANTS:
        if name == schema_name:
            return variant_map
    return SOURCE_TO_CANONICAL


def _absent_canonical_fields(
    full_map: dict[str, str],
    variant_map: dict[str, str],
) -> list[str]:
    """Kolom kanonikal yang tak ada di varian skema (mis. LITE).

    Dikembalikan sebagai `absent_schema_fields` — bukan `missing_fields` —
    agar file LITE yang valid tidak selalu PARTIAL (FMEA F4).
    """
    variant_canonical = set(
        variant_map.values()
    )
    return [
        canonical
        for canonical in full_map.values()
        if canonical not in variant_canonical
    ]


_TIMESTAMP_FALLBACK_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
)


def _parse_timestamp(
    raw_value: str,
) -> datetime | None:
    value = raw_value.strip()

    if value.lower() in NULL_VALUES:
        return None

    candidate = value

    if candidate.endswith("Z"):
        candidate = (
            candidate[:-1]
            + "+00:00"
        )

    try:
        return datetime.fromisoformat(
            candidate
        )
    except ValueError:
        pass

    # Fallback: format longgar (mis. jam 1-digit "2026-09-24 9:12:30").
    for format_string in _TIMESTAMP_FALLBACK_FORMATS:
        try:
            return datetime.strptime(
                value,
                format_string,
            )
        except ValueError:
            continue

    return None


def _normalize_decimal_comma(
    value: str,
) -> str | None:
    """Ubah koma-desimal Indonesia menjadi titik-desimal.

    "2,25" -> "2.25"; "1.234,56" -> "1234.56".
    None bila pola tak dikenali (koma ganda, spasi, dsb).
    """
    if "," not in value:
        return None

    if " " in value:
        return None

    if value.count(",") > 1:
        return None

    if "." in value:
        # Campuran: titik = ribuan, koma = desimal.
        integer_part, _, fraction = value.rpartition(",")
        if (
            not fraction
            or "." in fraction
            or "," in integer_part
        ):
            return None
        digits = integer_part.replace(".", "")
        if (
            not digits.lstrip("+-").isdigit()
            or not fraction.isdigit()
        ):
            return None
        sign = ""
        if digits[:1] in ("+", "-"):
            sign, digits = digits[0], digits[1:]
        return f"{sign}{digits}.{fraction}"

    head, _, tail = value.partition(",")
    if (
        not head
        or not tail
        or not head.lstrip("+-").isdigit()
        or not tail.isdigit()
    ):
        return None
    return f"{head}.{tail}"


def _parse_number(
    raw_value: str,
) -> float | None:
    value = raw_value.strip()

    if value.lower() in NULL_VALUES:
        return None

    try:
        parsed = float(
            value
        )
    except ValueError:
        normalized = _normalize_decimal_comma(
            value
        )
        if normalized is None:
            return None
        try:
            parsed = float(
                normalized
            )
        except ValueError:
            return None

    if not math.isfinite(
        parsed
    ):
        return None

    return parsed


def normalize_document(
    document_id: str,
    document: RawDocument,
) -> NormalizedDocument:
    schema = inspect_schema(
        document
    )

    if not schema.supported:
        return NormalizedDocument(
            document_id=document_id,
            filename=document.filename,
            schema_inspection=schema,
            raw_row_count=document.row_count,
            complete_row_count=0,
            partial_row_count=0,
            status="UNSUPPORTED_SCHEMA",
            rows=[],
        )

    source_indexes = {
        source_name: document.columns.index(
            source_name
        )
        for source_name
        in _normalization_variant_map(
            schema.schema_name
        )
    }

    absent_canonical = _absent_canonical_fields(
        SOURCE_TO_CANONICAL,
        _normalization_variant_map(
            schema.schema_name
        ),
    )

    optional_source_indexes = {
        source_name: document.columns.index(
            source_name
        )
        for source_name
        in OPTIONAL_SOURCE_TO_CANONICAL
        if document.columns.count(
            source_name
        ) == 1
    }

    normalized_rows: list[
        NormalizedRow
    ] = []

    complete_row_count = 0
    partial_row_count = 0

    for source_row, raw_row in enumerate(
        document.rows,
        start=2,
    ):
        values: dict[
            str,
            datetime | float | None,
        ] = {}

        missing_fields: list[str] = []
        invalid_fields: list[str] = []

        for (
            source_name,
            canonical_name,
        ) in _normalization_variant_map(
            schema.schema_name
        ).items():
            raw_value = raw_row[
                source_indexes[source_name]
            ]

            raw_is_missing = (
                raw_value.strip().lower()
                in NULL_VALUES
            )

            if canonical_name == "timestamp":
                parsed_value = (
                    _parse_timestamp(
                        raw_value
                    )
                )
            else:
                parsed_value = (
                    _parse_number(
                        raw_value
                    )
                )

            values[
                canonical_name
            ] = parsed_value

            if parsed_value is None:
                if raw_is_missing:
                    missing_fields.append(
                        canonical_name
                    )
                else:
                    invalid_fields.append(
                        canonical_name
                    )

        # Kolom kanonikal di luar varian = absent_schema (bukan missing per baris).
        absent_schema_fields = list(
            absent_canonical
        )

        for (
            source_name,
            canonical_name,
        ) in OPTIONAL_SOURCE_TO_CANONICAL.items():
            source_index = (
                optional_source_indexes.get(
                    source_name
                )
            )

            if source_index is None:
                parsed_value = None
            else:
                parsed_value = (
                    _parse_number(
                        raw_row[source_index]
                    )
                )

            values[
                canonical_name
            ] = parsed_value

        if (
            missing_fields
            or invalid_fields
        ):
            normalization_status = (
                "PARTIAL"
            )
            partial_row_count += 1
        else:
            normalization_status = (
                "COMPLETE"
            )
            complete_row_count += 1

        normalized_rows.append(
            NormalizedRow(
                document_id=document_id,
                source_row=source_row,
                normalization_status=(
                    normalization_status
                ),
                missing_fields=missing_fields,
                invalid_fields=invalid_fields,
                absent_schema_fields=absent_schema_fields,
                **values,
            )
        )

    document_status = (
        "NORMALIZED"
        if partial_row_count == 0
        else "PARTIAL"
    )

    return NormalizedDocument(
        document_id=document_id,
        filename=document.filename,
        schema_inspection=schema,
        raw_row_count=document.row_count,
        complete_row_count=(
            complete_row_count
        ),
        partial_row_count=(
            partial_row_count
        ),
        status=document_status,
        rows=normalized_rows,
    )


# ---------------------------------------------------------------------------
# Telemetry Dataset Contract
# ---------------------------------------------------------------------------

from app.data_pipeline.models import (
    TelemetryDataset,
    TelemetrySample,
)


TELEMETRY_SOURCE_TO_CANONICAL = {
    "Start Time (WIB)": "timestamp",
    "Motor Speed used": "motor_speed",
    "Output Frekuensi": "output_frequency",
    "Motor current": "motor_current",
    "Motor torque": "motor_torque",
    "Output power": "output_power",
    "Hours run": "hours_run",
    "Output voltage": "output_voltage",
    "Ambient temperature": "ambient_temperature",
    "Control board temperature": "control_board_temperature",
    "Inverter temperature": "inverter_temperature",
    "DC Voltage": "input_voltage",
    "Flux Actual": "flux_actual",
    "Motor Estimated Temperature": "motor_estimated_temperature",
    "Arus RMS U": "arus_rms_u",
    "Arus RMS V": "arus_rms_v",
    "Arus RMS W": "arus_rms_w",
}


TELEMETRY_REQUIRED_SOURCE_COLUMNS = tuple(
    TELEMETRY_SOURCE_TO_CANONICAL.keys()
)

# 5R/Rapi: varian lite skema telemetry (kolom kanonikal di luar varian
# menjadi data hilang per baris — lihat _absent_canonical_fields).
LITE_TELEMETRY_SOURCE_TO_CANONICAL = {
    "Timestamp WIB": "timestamp",
    "Frequency (Hz)": "output_frequency",
    "Motor Current (A)": "motor_current",
    "Power (kW)": "output_power",
    "Torque": "motor_torque",
}

TELEMETRY_SCHEMA_VARIANTS: tuple[
    tuple[str, dict[str, str]],
    ...,
] = (
    (SCHEMA_NAME, TELEMETRY_SOURCE_TO_CANONICAL),
    (SCHEMA_NAME_LITE, LITE_TELEMETRY_SOURCE_TO_CANONICAL),
)


def inspect_telemetry_schema(
    document: RawDocument,
) -> NormalizationSchemaInspection:
    for schema_name, variant_map in TELEMETRY_SCHEMA_VARIANTS:
        (
            missing_columns,
            duplicate_required_columns,
        ) = _inspect_columns(
            document.columns,
            variant_map,
        )

        if (
            not missing_columns
            and not duplicate_required_columns
        ):
            return NormalizationSchemaInspection(
                schema_name=schema_name,
                supported=True,
                missing_columns=[],
                duplicate_required_columns=[],
            )

    (
        missing_columns,
        duplicate_required_columns,
    ) = _inspect_columns(
        document.columns,
        TELEMETRY_SOURCE_TO_CANONICAL,
    )

    return NormalizationSchemaInspection(
        schema_name=None,
        supported=False,
        missing_columns=missing_columns,
        duplicate_required_columns=(
            duplicate_required_columns
        ),
    )


def _telemetry_variant_map(
    schema_name: str | None,
) -> dict[str, str]:
    for name, variant_map in TELEMETRY_SCHEMA_VARIANTS:
        if name == schema_name:
            return variant_map
    return TELEMETRY_SOURCE_TO_CANONICAL


def build_telemetry_dataset(
    document_id: str,
    document: RawDocument,
) -> TelemetryDataset:
    schema = inspect_telemetry_schema(
        document
    )

    if not schema.supported:
        return TelemetryDataset(
            document_id=document_id,
            filename=document.filename,
            schema_inspection=schema,
            raw_row_count=document.row_count,
            complete_row_count=0,
            partial_row_count=0,
            status="UNSUPPORTED_SCHEMA",
            samples=[],
        )

    source_indexes = {
        source_name: document.columns.index(
            source_name
        )
        for source_name
        in _telemetry_variant_map(
            schema.schema_name
        )
    }

    absent_canonical = _absent_canonical_fields(
        TELEMETRY_SOURCE_TO_CANONICAL,
        _telemetry_variant_map(
            schema.schema_name
        ),
    )

    samples: list[TelemetrySample] = []

    complete_row_count = 0
    partial_row_count = 0

    for source_row, raw_row in enumerate(
        document.rows,
        start=2,
    ):
        values: dict[
            str,
            datetime | float | None,
        ] = {}

        missing_fields: list[str] = []
        invalid_fields: list[str] = []

        for (
            source_name,
            canonical_name,
        ) in _telemetry_variant_map(
            schema.schema_name
        ).items():
            raw_value = raw_row[
                source_indexes[source_name]
            ]

            raw_is_missing = (
                raw_value.strip().lower()
                in NULL_VALUES
            )

            if canonical_name == "timestamp":
                parsed_value = _parse_timestamp(
                    raw_value
                )
            else:
                parsed_value = _parse_number(
                    raw_value
                )

            values[
                canonical_name
            ] = parsed_value

            if parsed_value is None:
                if raw_is_missing:
                    missing_fields.append(
                        canonical_name
                    )
                else:
                    invalid_fields.append(
                        canonical_name
                    )

        # Kolom kanonikal di luar varian = absent_schema (bukan missing per baris).
        absent_schema_fields = list(
            absent_canonical
        )

        if missing_fields or invalid_fields:
            normalization_status = "PARTIAL"
            partial_row_count += 1
        else:
            normalization_status = "COMPLETE"
            complete_row_count += 1

        samples.append(
            TelemetrySample(
                document_id=document_id,
                source_row=source_row,
                normalization_status=(
                    normalization_status
                ),
                missing_fields=missing_fields,
                invalid_fields=invalid_fields,
                absent_schema_fields=absent_schema_fields,
                **values,
            )
        )

    dataset_status = (
        "NORMALIZED"
        if partial_row_count == 0
        else "PARTIAL"
    )

    return TelemetryDataset(
        document_id=document_id,
        filename=document.filename,
        schema_inspection=schema,
        raw_row_count=document.row_count,
        complete_row_count=complete_row_count,
        partial_row_count=partial_row_count,
        status=dataset_status,
        samples=samples,
    )

