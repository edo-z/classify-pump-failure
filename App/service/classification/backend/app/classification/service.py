from __future__ import annotations

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.classification.engine import (
    RULES_FILE,
    RulesEngine,
    UnsupportedPumpConfigurationError,
)
from app.classification.evidence import (
    LIVE_GAP_THRESHOLD_MS,
    build_trailing_evidence,
)
from app.classification.models import (
    ClassificationResult,
    OperatingSetpoint,
    PumpConfig,
    SensorReading,
)
from app.classification.profiles import (
    get_profile_capacity,
)
from app.classification.setpoints import (
    resolve_effective_setpoint,
)
from app.data_pipeline.models import (
    NormalizationDocumentStatus,
    TelemetryDataset,
    TelemetrySample,
)
from app.data_pipeline.service import (
    get_telemetry_dataset,
)

# Evidence tunggal: trailing max 31 pasca-gap (lihat evidence.py).
_EVIDENCE_MAXLEN = 31


_engine: RulesEngine | None = None


def get_engine() -> RulesEngine:
    global _engine

    if _engine is None:
        _engine = RulesEngine(
            RULES_FILE
        )

    return _engine


class UnsupportedTelemetryDatasetError(
    ValueError
):
    pass


class NoTimestampedRowsError(
    ValueError
):
    pass


class ClassificationPipelineResult(
    BaseModel
):
    document_id: str
    profile_id: str

    document_status: (
        NormalizationDocumentStatus
    )

    source_row_count: int
    timestamped_row_count: int

    excluded_source_rows: list[int]

    classification: ClassificationResult


def _resolve_setpoint(
    profile_id: str,
    setpoint_freq: float | None,
) -> OperatingSetpoint:
    """Setpoint dokumen via resolver tunggal: override > profil.

    Dokumen hanya membawa override per-analisis; selebihnya fallback profil.
    """
    return resolve_effective_setpoint(profile_id, override_freq=setpoint_freq)


def telemetry_sample_to_sensor_reading(
    sample: TelemetrySample,
) -> SensorReading:
    if sample.timestamp is None:
        raise ValueError(
            "Telemetry sample has no timestamp: "
            f"source_row={sample.source_row}"
        )

    return SensorReading.model_validate(
        sample.model_dump()
    )


def _evidence_trail(
    sorted_readings: list[SensorReading],
    idx: int,
) -> list[SensorReading]:
    """Evidensi trailing via modul tunggal (fixed 10s untuk dokumen)."""
    return build_trailing_evidence(sorted_readings, idx, LIVE_GAP_THRESHOLD_MS, _EVIDENCE_MAXLEN)


def _select_latest_evidence(
    readings: list[SensorReading],
) -> list[SensorReading]:
    # Disamakan live: terurut event-time (live menolak out-of-order),
    # lalu evidensi trailing 31 pasca-gap terakhir.
    # Murni per-sampel: pembacaan terakhir + evidensinya (untuk T_A).
    if not readings:
        return []
    ordered = sorted(readings, key=lambda r: r.timestamp)
    return _evidence_trail(ordered, len(ordered) - 1)


def classify_telemetry_dataset(
    dataset: TelemetryDataset,
    profile_id: str,
    engine: RulesEngine,
    setpoint_freq: float | None = None,
) -> ClassificationPipelineResult:
    if dataset.status == "UNSUPPORTED_SCHEMA":
        raise UnsupportedTelemetryDatasetError(
            "Telemetry dataset has "
            "unsupported schema"
        )

    excluded_source_rows = [
        sample.source_row
        for sample in dataset.samples
        if sample.timestamp is None
    ]

    readings = [
        telemetry_sample_to_sensor_reading(
            sample
        )
        for sample in dataset.samples
        if sample.timestamp is not None
    ]

    if not readings:
        raise NoTimestampedRowsError(
            "Telemetry dataset has no "
            "timestamped samples available "
            "for classification"
        )

    # Murni per-sampel ala live: pembacaan terakhir + evidensinya.
    evidence_readings = _select_latest_evidence(
        readings,
    )

    if not evidence_readings:
        raise NoTimestampedRowsError(
            "No telemetry readings available "
            "for classification"
        )

    capacity_lps = get_profile_capacity(
        profile_id
    )

    pump_config = PumpConfig(
        pump_id=capacity_lps,
        capacity_lps=capacity_lps,
    )

    # Setpoint ala live-tanpa-sp (lihat komentar yang sama di scan di bawah).
    operating_setpoint = _resolve_setpoint(profile_id, setpoint_freq)

    classification = engine.classify(
        readings=evidence_readings,
        pump_config=pump_config,
        operating_setpoint=operating_setpoint,
        trigger_namespace=f"doc:{dataset.document_id}:{profile_id}",
    )

    if excluded_source_rows:
        classification.limitations.append(
            (
                f"{len(excluded_source_rows)} "
                "telemetry sample(s) excluded: "
                "timestamp unavailable"
            )
        )

    return ClassificationPipelineResult(
        document_id=dataset.document_id,
        profile_id=profile_id,
        document_status=dataset.status,
        source_row_count=len(
            dataset.samples
        ),
        timestamped_row_count=len(
            readings
        ),
        excluded_source_rows=(
            excluded_source_rows
        ),
        classification=classification,
    )


def scan_classification_points(
    dataset: TelemetryDataset,
    profile_id: str,
    setpoint_freq: float | None = None,
) -> list[dict]:
    # Murni per-sampel ala live: tiap sampel dinilai dengan evidensinya,
    # selalu full-resolution.
    if dataset.status == "UNSUPPORTED_SCHEMA":
        raise UnsupportedTelemetryDatasetError(
            "Telemetry dataset has unsupported schema"
        )

    readings_with_src: list[tuple[SensorReading, int, object]] = []
    for sample in dataset.samples:
        if sample.timestamp is None:
            continue
        try:
            reading = telemetry_sample_to_sensor_reading(sample)
        except ValueError as exc:
            logger.debug(
                "telemetry sample skipped source_row=%s: %s",
                sample.source_row,
                exc,
            )
            continue
        readings_with_src.append((reading, sample.source_row, sample.timestamp))

    if not readings_with_src:
        raise NoTimestampedRowsError(
            "Telemetry dataset has no timestamped samples"
        )

    readings_with_src.sort(key=lambda x: x[0].timestamp)

    capacity_lps = get_profile_capacity(profile_id)
    pump_config = PumpConfig(
        pump_id=capacity_lps,
        capacity_lps=capacity_lps,
    )
    # Setpoint dokumen: override per-analisis bila valid, else profil.
    operating_setpoint = _resolve_setpoint(profile_id, setpoint_freq)
    engine = get_engine()
    results: list[dict] = []
    # Namespace isolasi antar-scan agar counter tidak bocor antar dokumen (FMEA F2).
    import uuid

    _scan_ns = f"scan:{profile_id}:{uuid.uuid4().hex[:8]}"

    # 5R/Rapi: susun daftar readings sekali — dulu dibangun ulang per
    # indeks (O(n²) untuk file besar). Isi & urutan identik, semantik sama.
    ordered_readings = [r for r, _, _ in readings_with_src]

    for idx, (reading, src_row, ts) in enumerate(readings_with_src):
        # Sama seperti live: evidensi trailing 31 pasca-gap (T_A butuh 30
        # histori kontigu; evidensi pendek -> T_A insufficient -> NO_MATCH).
        evidence = _evidence_trail(ordered_readings, idx)
        try:
            result = engine.classify(
                readings=evidence,
                pump_config=pump_config,
                operating_setpoint=operating_setpoint,
                trigger_namespace=_scan_ns,
            )
        except UnsupportedPumpConfigurationError as exc:
            logger.warning(
                "scan classification unsupported config cursor=%s profile=%s: %s",
                idx,
                profile_id,
                exc,
            )
            continue
        except ValueError as exc:
            logger.debug(
                "scan sample skipped cursor=%s: %s",
                idx,
                exc,
            )
            continue
        except Exception:
            logger.exception(
                "scan unexpected error cursor=%s profile=%s",
                idx,
                profile_id,
            )
            continue

        is_failure = result.trouble_type.value != "normal"
        ts_iso = reading.timestamp.isoformat() if hasattr(reading.timestamp, "isoformat") else str(reading.timestamp)
        results.append(
            {
                "source_row": src_row,
                "timestamp": ts_iso,
                "cursor": idx,
                "trouble_type": result.trouble_type.value,
                "is_failure": is_failure,
            "evaluation_status": result.evaluation_status,
            "readings_count": result.readings_count,
            "evidence_size": len(evidence),
                "matched_rules": [r.model_dump(mode="json") for r in result.matched_rules],
                "sensor_snapshot": result.sensor_snapshot,
                "limitations": result.limitations[:3],
            }
        )

    return results


def classify_document(
    document_id: str,
    profile_id: str,
    setpoint_freq: float | None = None,
) -> ClassificationPipelineResult:
    dataset = get_telemetry_dataset(
        document_id
    )

    return classify_telemetry_dataset(
        dataset=dataset,
        profile_id=profile_id,
        engine=get_engine(),
        setpoint_freq=setpoint_freq,
    )
